import { addDaysISO, adminUsersMenuKeyForCategory, bkkDateOf, permissionCategoryOfRole, resolvePermissionCeilings, type LoginPermissionCategory } from '@seedoffice/core'
import { companyConfig, createDb, docMembers, docs, projectMembers, projects, tasks, users, TASK_STATUSES } from '@seedoffice/db'
import { and, eq, gte, inArray, isNull, like, lt, lte, ne, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types'

/** owner เห็นทุกโปรเจกต์ (null = ไม่กรอง) · role อื่นเห็นเฉพาะโปรเจกต์ตัวเองเป็นสมาชิก — pattern เดียวกับ chat.ts myProjectIds() */
async function myProjectIds(db: ReturnType<typeof createDb>, me: { id: string; role: string }): Promise<string[] | null> {
  if (me.role === 'owner') return null
  return (await db.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, me.id))).map((r) => r.id)
}

const categoryOfUserRole = (role: 'owner' | 'member' | 'vendor' | 'guest'): LoginPermissionCategory =>
  role === 'owner' || role === 'member' ? 'staff' : role === 'vendor' ? 'outsource' : 'customer'

/** pattern เดียวกับ resolveUsersAccess ใน routes/admin.ts — คืน 'owner' = เห็นหมด, category = เห็นเฉพาะหมวดตัวเอง (ถ้าเพดานเมนูอนุญาต), null = ไม่มีสิทธิ์ค้นคนเลย */
async function myUsersAccess(db: ReturnType<typeof createDb>, me: { id: string; role: 'owner' | 'member' | 'vendor' | 'guest' }): Promise<'owner' | LoginPermissionCategory | null> {
  if (me.role === 'owner') return 'owner'
  const category = permissionCategoryOfRole(me.role)
  if (!category) return null
  const cfg = (await db.select({ permissionCeilings: companyConfig.permissionCeilings }).from(companyConfig).limit(1))[0]
  const menuKey = adminUsersMenuKeyForCategory(category)
  return resolvePermissionCeilings(cfg?.permissionCeilings)[category].menus[menuKey] ? category : null
}

const searchQuery = z.object({
  q: z.string(),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: z.string().optional(),
  due: z.enum(['today', 'week', 'overdue']).optional(),
})

/**
 * Pronista §Navbar enrichment (2026-08-27) — ค้นหาด่วนข้ามระบบ (โปรเจกต์ + งาน + เอกสาร + คน) จาก Topbar
 * ขอบเขตสิทธิ์แยกตามประเภท: โปรเจกต์/งาน = โปรเจกต์ที่ตัวเองเป็นสมาชิก (เหมือน chat.ts) · เอกสาร = กติกาเดียวกับเมนู "เอกสาร" (doc-acl.ts) · คน = กติกาเดียวกับ /api/admin/users (เห็นเฉพาะหมวดตัวเอง ถ้าเพดานอนุญาต)
 * filter เพิ่มเติม (status/assigneeId/due) ใช้กับ "งาน" เท่านั้น — ความหมายเดียวกับตัวกรองในหน้า "งานของฉัน"
 */
export const searchRoutes = new Hono<AppEnv>()
  .get('/search', async (c) => {
    const parsed = searchQuery.safeParse(c.req.query())
    const q = parsed.success ? parsed.data.q.trim() : ''
    if (q.length < 2) return c.json({ projects: [], tasks: [], docs: [], people: [] })
    const { status, assigneeId, due } = parsed.success ? parsed.data : {}
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const like_ = `%${q}%`

    // โปรเจกต์ + งาน — ขอบเขตโปรเจกต์ที่เป็นสมาชิก
    const pIds = await myProjectIds(db, me)
    const scopeFilter = pIds ? inArray(projects.id, pIds.length ? pIds : ['__none__']) : undefined
    const taskScopeFilter = pIds ? inArray(tasks.projectId, pIds.length ? pIds : ['__none__']) : undefined

    const projectRows = await db
      .select({ id: projects.id, name: projects.name, code: projects.code, status: projects.status, type: projects.type })
      .from(projects)
      .where(and(isNull(projects.deletedAt), or(like(projects.name, like_), like(projects.code, like_)), scopeFilter))
      .limit(8)

    const today = bkkDateOf(Date.now())
    const taskConditions = [or(like(tasks.title, like_), like(tasks.code, like_)), taskScopeFilter]
    if (status) taskConditions.push(eq(tasks.status, status))
    if (assigneeId) taskConditions.push(eq(tasks.assigneeId, assigneeId))
    if (due === 'today') taskConditions.push(eq(tasks.dueDate, today))
    else if (due === 'overdue') taskConditions.push(lt(tasks.dueDate, today), ne(tasks.status, 'done'))
    else if (due === 'week') taskConditions.push(gte(tasks.dueDate, today), lte(tasks.dueDate, addDaysISO(today, 6)))
    const taskRows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        code: tasks.code,
        projectId: tasks.projectId,
        projectName: projects.name,
        status: tasks.status,
        dueDate: tasks.dueDate,
        assigneeId: tasks.assigneeId,
        assigneeName: users.name,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .where(and(...taskConditions))
      .limit(8)

    // เอกสาร — กติกาเดียวกับเมนู "เอกสาร" (vendor/guest ไม่เห็นเลย, private ต้องเป็นสมาชิก, team เห็นได้ทุกคน owner/member)
    let docRows: { id: string; title: string; docNumber: string | null; docType: string | null; kind: string }[] = []
    if (me.role === 'owner' || me.role === 'member') {
      const rows = await db
        .select({ id: docs.id, title: docs.title, docNumber: docs.docNumber, docType: docs.docType, kind: docs.kind, ownerId: docs.ownerId, visibility: docs.visibility })
        .from(docs)
        .where(and(isNull(docs.deletedAt), ne(docs.kind, 'folder'), or(like(docs.title, like_), like(docs.docNumber, like_))))
        .limit(20)
      const myMemberships = await db.select({ docId: docMembers.docId, role: docMembers.role }).from(docMembers).where(eq(docMembers.userId, me.id))
      docRows = rows
        .filter((r) => {
          if (me.role === 'owner' || r.ownerId === me.id) return true
          const mine = myMemberships.filter((m) => m.docId === r.id)
          if (r.visibility === 'team') return true
          return mine.length > 0
        })
        .slice(0, 8)
        .map((r) => ({ id: r.id, title: r.title, docNumber: r.docNumber, docType: r.docType, kind: r.kind }))
    }

    // คน (พนักงาน/พาร์ทเนอร์/ลูกค้า) — กติกาเดียวกับ /api/admin/users: เห็นเฉพาะหมวดตัวเอง เว้นแต่เป็น owner
    const usersAccess = await myUsersAccess(db, me)
    let peopleRows: { id: string; name: string; role: string; email: string; phone: string | null; jobTitle: string | null }[] = []
    if (usersAccess) {
      const rows = await db
        .select({ id: users.id, name: users.name, role: users.role, email: users.email, phone: users.phone, jobTitle: users.jobTitle })
        .from(users)
        .where(or(like(users.name, like_), like(users.email, like_), like(users.phone, like_)))
        .limit(20)
      peopleRows = (usersAccess === 'owner' ? rows : rows.filter((u) => categoryOfUserRole(u.role) === usersAccess)).slice(0, 8)
    }

    return c.json({ projects: projectRows, tasks: taskRows, docs: docRows, people: peopleRows })
  })
