import { bkkDateOf, presetById, resolvePresets } from '@seedoffice/core'
import {
  companyConfig,
  createDb,
  DEFECT_STATUSES,
  docLinks,
  epics,
  notifications,
  projectMembers,
  projects,
  sprints,
  taskAttachments,
  taskChecklistItems,
  taskComments,
  taskCustomFields,
  taskGroups,
  tasks,
  taskStars,
  TASK_STATUSES,
  timeEntries,
  timerSessions,
  users,
} from '@seedoffice/db'
import { and, asc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { canEditProject, canEditTask, getProjectRole } from '../lib/project-role'
import { nextSubTaskCode, nextTaskCode, nextTypedEpicCode, nextTypedTaskCode, sanitizeCodePrefix } from '../lib/task-code'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const taskPatchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  // Tasknista §SOW Task/Subtask — Reference Code แก้ไขได้ (เดิมตั้งได้แค่ตอนแตกเอกสาร)
  originCode: z.string().nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  estimateMinutes: z.number().int().nonnegative().nullable().optional(),
  // Tasknista §Project Estimate — กี่นาที/วันที่ assignee แบ่งเวลามาทำ task นี้ (null = ใช้ company_config.workHourCapMinutes)
  costWorkMinutesPerDay: z.number().int().positive().nullable().optional(),
  // Tasknista §Project Estimate — % buffer เฉพาะ task นี้ (null = ใช้ company_config.costBufferPercent)
  costBufferPercent: z.number().int().min(0).max(100).nullable().optional(),
  startDate: isoDate.nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  groupId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(), // Tasknista §F2 — assign backlog → project ย้อนหลัง
  parentId: z.string().optional(), // Tasknista §2.6 — ย้าย backlog เป็น sub-task ของ task ที่มีอยู่
  epicId: z.string().nullable().optional(), // Tasknista §Back to Basic — เมนู "..." ใน Tab Epic/Story: ผูก Story เข้า/ออกจาก Epic โดยตรง
  kind: z.enum(['task', 'defect', 'cr']).optional(), // Tasknista §2.6 — ย้าย backlog เป็น Defect/CR
  reporterType: z.enum(['customer', 'self']).nullable().optional(),
  sortOrder: z.number().int().optional(),
  locked: z.boolean().optional(), // Tasknista §4 — ล็อค task ใน Company Backlog (owner เท่านั้นที่ตั้งได้)
  defectStatus: z.enum(DEFECT_STATUSES).optional(), // Tasknista §5 — สถานะเฉพาะ Defect
  sprintStatus: z.string().nullable().optional(), // Tasknista §Sprint & Board — ลากข้ามคอลัมน์บอร์ด (อ้าง id คอลัมน์ใน preset ของ sprint ที่ผูกอยู่)
})

/** board ของโปรเจกต์ + CRUD group/task — vendor อ่านได้ แก้ไม่ได้ (teamOnly เฉพาะ mutation) */
export const taskRoutes = new Hono<AppEnv>()

  // board เต็มของโปรเจกต์ (groups + tasks + ชื่อผู้รับผิดชอบ + ดาววันนี้ของฉัน)
  .get('/projects/:id/board', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const me = c.get('user')
    const today = bkkDateOf(Date.now())
    const groups = await db
      .select()
      .from(taskGroups)
      .where(eq(taskGroups.projectId, projectId))
      .orderBy(asc(taskGroups.sortOrder))
    // sub-task (parentId ไม่ว่าง) ไม่โชว์เป็นการ์ดแยกบนบอร์ด — จะไปอยู่ใต้หน้า Task Detail ของ parent (ยังไม่ได้ทำหน้านั้น)
    const rows = await db
      .select({ task: tasks, assigneeName: users.name, assigneeAvatarUrl: users.avatarUrl })
      .from(tasks)
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.parentId)))
      .orderBy(asc(tasks.sortOrder))
    const myStars = await db
      .select({ taskId: taskStars.taskId })
      .from(taskStars)
      .where(and(eq(taskStars.userId, me.id), eq(taskStars.forDate, today)))
    const starred = new Set(myStars.map((s) => s.taskId))
    return c.json({
      groups: groups.map((g) => ({
        ...g,
        tasks: rows
          .filter((r) => r.task.groupId === g.id)
          .map((r) => ({ ...r.task, assigneeName: r.assigneeName, assigneeAvatarUrl: r.assigneeAvatarUrl, starredToday: starred.has(r.task.id) })),
      })),
    })
  })

  // สร้าง/แก้/ลบ "กลุ่มงาน" = จัดโครงสร้างโปรเจกต์ (owner หรือ member ที่เป็น editor ของโปรเจกต์นี้ — Tasknista §permission)
  .post('/projects/:id/groups', teamOnly, async (c) => {
    const body = z.object({ name: z.string().min(1) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const exists = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
    if (!exists) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    const role = await getProjectRole(db, projectId, me.id, me.role)
    if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)
    const siblings = await db.select().from(taskGroups).where(eq(taskGroups.projectId, projectId))
    const g = await db
      .insert(taskGroups)
      .values({ projectId, name: body.data.name, sortOrder: siblings.length })
      .returning()
    return c.json(g[0], 201)
  })

  .patch('/groups/:id', teamOnly, async (c) => {
    const body = z
      .object({ name: z.string().min(1).optional(), sortOrder: z.number().int().optional() })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const before = (await db.select().from(taskGroups).where(eq(taskGroups.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    const role = await getProjectRole(db, before.projectId, me.id, me.role)
    if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)
    const updated = await db
      .update(taskGroups)
      .set(body.data)
      .where(eq(taskGroups.id, before.id))
      .returning()
    return c.json(updated[0])
  })

  .delete('/groups/:id', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const before = (await db.select().from(taskGroups).where(eq(taskGroups.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    const role = await getProjectRole(db, before.projectId, me.id, me.role)
    if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)
    const groupTasks = await db.select().from(tasks).where(eq(tasks.groupId, before.id))
    if (groupTasks.length > 0) return c.json({ error: 'group_not_empty' }, 409)
    await db.delete(taskGroups).where(eq(taskGroups.id, before.id))
    return c.json({ ok: true })
  })

  .post('/groups/:id/tasks', teamOnly, async (c) => {
    const body = z
      .object({
        title: z.string().min(1),
        assigneeId: z.string().optional(),
        estimateMinutes: z.number().int().nonnegative().optional(),
        startDate: isoDate.optional(),
        dueDate: isoDate.optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const group = (
      await db.select().from(taskGroups).where(eq(taskGroups.id, c.req.param('id'))).limit(1)
    )[0]
    if (!group) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    const memberRole = await getProjectRole(db, group.projectId, me.id, me.role)
    if (!canEditProject(memberRole)) return c.json({ error: 'forbidden' }, 403)
    const siblings = await db.select().from(tasks).where(eq(tasks.groupId, group.id))
    const project = (await db.select().from(projects).where(eq(projects.id, group.projectId)).limit(1))[0]
    const code = await nextTypedTaskCode(db, sanitizeCodePrefix(project?.code, 'TASK'), 'Task')
    const t = await db
      .insert(tasks)
      .values({
        projectId: group.projectId,
        groupId: group.id,
        sortOrder: siblings.length,
        createdBy: me.id,
        code,
        ...body.data,
      })
      .returning()
    const created = t[0]
    if (!created) return c.json({ error: 'insert_failed' }, 500)
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'task.create',
      entity: 'task',
      entityId: created.id,
      meta: { title: created.title, groupId: group.id },
    })
    return c.json(created, 201)
  })

  // Tasknista §2.12 — เพิ่มงานตรงจากปุ่ม "+เพิ่มงาน" ในมุมมอง Kanban (เลือกสถานะเองได้เลย) · เข้ากลุ่มแรกของโปรเจกต์ (สร้าง "ทั่วไป" ให้ถ้ายังไม่มีกลุ่มเลย)
  .post('/projects/:id/tasks', teamOnly, async (c) => {
    const body = z
      .object({
        title: z.string().min(1),
        description: z.string().max(2000).optional(),
        status: z.enum(TASK_STATUSES).optional(),
        priority: z.enum(['low', 'normal', 'high']).optional(),
        assigneeId: z.string().optional(),
        startDate: isoDate.optional(),
        dueDate: isoDate.optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    const role = await getProjectRole(db, projectId, me.id, me.role)
    if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)
    let group = (await db.select().from(taskGroups).where(eq(taskGroups.projectId, projectId)).orderBy(asc(taskGroups.sortOrder)).limit(1))[0]
    if (!group) {
      group = (await db.insert(taskGroups).values({ projectId, name: 'ทั่วไป', sortOrder: 0 }).returning())[0]!
    }
    const siblings = await db.select().from(tasks).where(eq(tasks.groupId, group.id))
    const code = await nextTypedTaskCode(db, sanitizeCodePrefix(project.code, 'TASK'), 'Task')
    const created = (
      await db
        .insert(tasks)
        .values({ projectId, groupId: group.id, sortOrder: siblings.length, createdBy: me.id, code, ...body.data })
        .returning()
    )[0]
    if (!created) return c.json({ error: 'insert_failed' }, 500)
    await writeAudit(c.env, { actorId: me.id, action: 'task.create', entity: 'task', entityId: created.id, meta: { title: created.title, groupId: group.id } })
    return c.json(created, 201)
  })

  // Tasknista §5 (2026-07-03) — Backlog ของโปรเจกต์ (แยกจาก Company Backlog): task ที่ projectId=นี้ แต่ยังไม่ได้ "ย้ายเข้ากระดาน" (groupId ว่าง)
  // Tasknista §Sprint & Board — pool เดียวกับ Sprint Backlog (แค่เปลี่ยนชื่อฝั่ง UI) → ตัด task ที่อยู่ใน sprint แล้วออก (sprintId ไม่ว่าง)
  // Tasknista §SOW Task/Subtask — Subtask ของ SOW (parentId ไม่ว่าง) ต้องโผล่ใน Backlog ด้วย (ต่างจาก subtask ทั่วไปที่ยังซ่อนเหมือนเดิม) เพราะต้องลากเข้า Sprint ได้
  .get('/projects/:id/backlog', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const me = c.get('user')
    const myRole = await getProjectRole(db, projectId, me.id, me.role)
    const rowsAll = await db
      .select({ task: tasks, assigneeName: users.name, epicTitle: epics.title, epicCode: epics.code })
      .from(tasks)
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .leftJoin(epics, eq(tasks.epicId, epics.id))
      .where(
        and(
          eq(tasks.projectId, projectId),
          isNull(tasks.groupId),
          isNull(tasks.sprintId),
          // Tasknista §Back to Basic (ต่อยอด) — ตัด Story/Task-ลอย/Defect/CR ออกจากลิสต์นี้ (ไปโผล่เฉพาะแท็บของตัวเองผ่าน /tasks/all): เหลือแค่งานทั่วไปแท้ (kind='backlog'), งานที่มาจากเอกสาร (originDocType ใดๆ, ระดับบนสุด), และลูกของ SOW (ทุกระดับ)
          or(
            and(isNull(tasks.parentId), or(eq(tasks.kind, 'backlog'), isNotNull(tasks.originDocType))),
            eq(tasks.originDocType, 'SOW'),
          ),
        ),
      )
      .orderBy(asc(tasks.createdAt))
    // Tasknista §Backlog ownership — แท็บ "ทั่วไป" (kind='backlog') เป็นของส่วนตัวคนคีย์ · Owner/Editor เห็นของทุกคน ส่วน Member เห็นแค่ของตัวเอง (แท็บเอกสาร/SOW ไม่ใช่ของส่วนตัว ไม่กรอง)
    const rows = canEditProject(myRole) ? rowsAll : rowsAll.filter((r) => r.task.kind !== 'backlog' || r.task.createdBy === me.id)

    // Tasknista §Sprint & Board fix — ซ่อน Task พ่อของ SOW ที่ subtask ทั้งหมดย้ายออกจาก Backlog ไปหมดแล้ว (เข้า Sprint แล้วหรือถูกลบ) — parent ที่ไม่เคยมี subtask เลย (parse ไม่เจอ) ยังโชว์ไว้เหมือนเดิม
    const sowParentIds = rows.filter((r) => r.task.originDocType === 'SOW' && r.task.parentId === null).map((r) => r.task.id)
    let hiddenParentIds = new Set<string>()
    if (sowParentIds.length > 0) {
      const totalChildren = await db.select({ parentId: tasks.parentId }).from(tasks).where(inArray(tasks.parentId, sowParentIds))
      const totalByParent = new Map<string, number>()
      for (const row of totalChildren) totalByParent.set(row.parentId!, (totalByParent.get(row.parentId!) ?? 0) + 1)
      const remainingByParent = new Map<string, number>()
      for (const r of rows) if (r.task.parentId) remainingByParent.set(r.task.parentId, (remainingByParent.get(r.task.parentId) ?? 0) + 1)
      hiddenParentIds = new Set(sowParentIds.filter((id) => (totalByParent.get(id) ?? 0) > 0 && (remainingByParent.get(id) ?? 0) === 0))
    }

    // Tasknista §Epic Layer — % ความคืบหน้ารวมของ Epic นับจากงานทั้งหมดในเอกสาร (รวมที่ย้ายเข้า Sprint ไปแล้วด้วย) ไม่ใช่แค่ที่เหลือใน Backlog
    const epicIds = [...new Set(rows.map((r) => r.task.epicId).filter((id): id is string => id !== null))]
    let epicList: { id: string; title: string; code: string | null; doneCount: number; totalCount: number }[] = []
    if (epicIds.length > 0) {
      const epicRows = await db.select().from(epics).where(inArray(epics.id, epicIds))
      const epicTasks = await db
        .select({ id: tasks.id, parentId: tasks.parentId, epicId: tasks.epicId, status: tasks.status })
        .from(tasks)
        .where(inArray(tasks.epicId, epicIds))
      const parentIdSet = new Set(epicTasks.map((t) => t.parentId).filter((id): id is string => id !== null))
      const progressByEpic = new Map<string, { done: number; total: number }>()
      for (const t of epicTasks) {
        if (parentIdSet.has(t.id)) continue // Task พ่อที่มี subtask ของตัวเอง ไม่นับเป็นหน่วยงานจริง (นับที่ subtask/leaf แทน)
        const cur = progressByEpic.get(t.epicId!) ?? { done: 0, total: 0 }
        cur.total += 1
        if (t.status === 'done') cur.done += 1
        progressByEpic.set(t.epicId!, cur)
      }
      epicList = epicRows.map((e) => ({
        id: e.id,
        title: e.title,
        code: e.code,
        doneCount: progressByEpic.get(e.id)?.done ?? 0,
        totalCount: progressByEpic.get(e.id)?.total ?? 0,
      }))
    }

    return c.json({
      tasks: rows
        .filter((r) => !hiddenParentIds.has(r.task.id))
        .map((r) => ({ ...r.task, assigneeName: r.assigneeName, epicTitle: r.epicTitle, epicCode: r.epicCode })),
      epics: epicList,
    })
  })

  // Tasknista §Project Refactor — task ทั้งหมดของโปรเจกต์ (ไม่กรอง sprint/group) แบบเบาๆ ใช้กับ TaskPickerModal (เลือก parent ตอน "จัดการ"→ย้ายประเภท) และแท็บ EPIC/Story/Task/CR
  .get('/projects/:id/tasks/all', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db
      .select({
        id: tasks.id,
        code: tasks.code,
        title: tasks.title,
        kind: tasks.kind,
        parentId: tasks.parentId,
        epicId: tasks.epicId,
        status: tasks.status,
        defectStatus: tasks.defectStatus,
        assigneeName: users.name,
      })
      .from(tasks)
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .where(eq(tasks.projectId, c.req.param('id')))
      .orderBy(asc(tasks.createdAt))
    const titleOf = new Map(rows.map((r) => [r.id, r.title]))
    return c.json(rows.map((r) => ({ ...r, parentTitle: r.parentId ? (titleOf.get(r.parentId) ?? null) : null })))
  })

  // Tasknista §Project Refactor — แท็บ EPIC: list ทุก Epic ของโปรเจกต์ (ไม่ใช่แค่ที่มี parent เหลือใน backlog เหมือน /backlog เดิม) + % ความคืบหน้ารวม
  .get('/projects/:id/epics', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const epicRows = await db.select().from(epics).where(eq(epics.projectId, projectId)).orderBy(asc(epics.createdAt))
    const epicIds = epicRows.map((e) => e.id)
    const progressByEpic = new Map<string, { done: number; total: number }>()
    if (epicIds.length > 0) {
      const epicTasks = await db
        .select({ id: tasks.id, parentId: tasks.parentId, epicId: tasks.epicId, status: tasks.status })
        .from(tasks)
        .where(inArray(tasks.epicId, epicIds))
      const parentIdSet = new Set(epicTasks.map((t) => t.parentId).filter((id): id is string => id !== null))
      for (const t of epicTasks) {
        if (parentIdSet.has(t.id)) continue // นับที่ leaf เท่านั้น (เหมือน /backlog)
        const cur = progressByEpic.get(t.epicId!) ?? { done: 0, total: 0 }
        cur.total += 1
        if (t.status === 'done') cur.done += 1
        progressByEpic.set(t.epicId!, cur)
      }
    }
    return c.json(
      epicRows.map((e) => ({ ...e, doneCount: progressByEpic.get(e.id)?.done ?? 0, totalCount: progressByEpic.get(e.id)?.total ?? 0 })),
    )
  })

  // Tasknista §Project Refactor — สร้าง Epic ใหม่ตรงๆ จากแท็บ EPIC (ต่างจาก convert 'epic' ที่ยกระดับจาก task ที่มีอยู่แล้ว)
  .post('/projects/:id/epics', teamOnly, async (c) => {
    const body = z.object({ title: z.string().min(1) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const me = c.get('user')
    const role = await getProjectRole(db, projectId, me.id, me.role)
    if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)
    const code = await nextTypedEpicCode(db, sanitizeCodePrefix(project.code, 'TASK'))
    const created = (await db.insert(epics).values({ projectId, title: body.data.title, code, sortOrder: 0 }).returning())[0]
    return c.json(created, 201)
  })

  // สร้าง task ตรงใน Backlog ของโปรเจกต์นี้ (ไม่ผูกกลุ่มงาน) — เฉพาะ owner/editor ของโปรเจกต์ (Tasknista §5: "คนที่ถูก Assign เข้าร่วมโปรเจคนั้นเท่านั้น")
  .post('/projects/:id/backlog', teamOnly, async (c) => {
    // Tasknista §Sprint & Board fix — ตั้งรหัสงานเองได้ตอนสร้าง (ไม่บังคับ) — เว้นว่างยังออกเลขอัตโนมัติเหมือนเดิม
    // Tasknista §Back to Basic (ต่อยอด) — สร้าง Task ตรงในแท็บ SOW/MOM/ฯลฯ ได้ ระบุ originDocType เองได้ (เดิมมาจาก breakout เอกสารเท่านั้น)
    // Tasknista §Back to Basic (ต่อยอด) — เพิ่ม kind: 'backlog' สำหรับแท็บ "ทั่วไป" โดยเฉพาะ (ไม่ระบุ = 'task' เดิม ไม่กระทบ Story/CR tab ที่เรียก endpoint นี้เหมือนกัน)
    const body = z
      .object({
        title: z.string().min(1),
        code: z.string().trim().max(40).optional(),
        originDocType: z.enum(['MOM', 'BRD', 'SOW', 'SRS', 'PEP', 'UIR']).optional(),
        kind: z.enum(['backlog', 'task']).optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    const role = await getProjectRole(db, projectId, me.id, me.role)
    if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)
    const kind = body.data.kind ?? 'task'
    const code = body.data.code || (await nextTypedTaskCode(db, sanitizeCodePrefix(project.code, 'TASK'), kind === 'backlog' ? 'Backlog' : 'Task'))
    const created = (
      await db
        .insert(tasks)
        .values({ projectId, groupId: null, sortOrder: 0, createdBy: me.id, code, title: body.data.title, originDocType: body.data.originDocType ?? null, kind })
        .returning()
    )[0]
    if (!created) return c.json({ error: 'insert_failed' }, 500)
    await writeAudit(c.env, { actorId: me.id, action: 'task.create', entity: 'task', entityId: created.id, meta: { title: created.title, projectBacklog: true } })
    return c.json(created, 201)
  })

  // Tasknista §F2 — Backlog: สร้าง task ลอย (ยังไม่ผูกโปรเจค) → assign ย้อนหลังได้
  .post('/tasks/backlog', teamOnly, async (c) => {
    const body = z
      .object({
        title: z.string().min(1),
        assigneeId: z.string().optional(),
        priority: z.enum(['low', 'normal', 'high']).optional(),
        dueDate: isoDate.optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const code = await nextTaskCode(db, 'BL')
    const t = await db
      .insert(tasks)
      .values({ projectId: null, groupId: null, sortOrder: 0, createdBy: me.id, code, ...body.data })
      .returning()
    const created = t[0]
    if (!created) return c.json({ error: 'insert_failed' }, 500)
    await writeAudit(c.env, { actorId: me.id, action: 'task.create', entity: 'task', entityId: created.id, meta: { title: created.title, backlog: true } })
    return c.json(created, 201)
  })

  // Backlog: ลิสต์ task ที่ยังไม่ผูกโปรเจค (เรียงตามวันที่สร้าง)
  .get('/tasks/backlog', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db
      .select({ task: tasks, assigneeName: users.name })
      .from(tasks)
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .where(isNull(tasks.projectId))
      .orderBy(asc(tasks.createdAt))
    return c.json(rows.map((r) => ({ ...r.task, assigneeName: r.assigneeName })))
  })

  // Tasknista §"งานของฉัน" — งานทั้งหมดที่ฉันรับผิดชอบ ข้ามทุกโปรเจกต์ (คนละมิติกับเมนู โปรเจกต์ ที่มองทีละโปรเจกต์)
  // Tasknista §permission (Jira-style project role) — สิทธิ์แก้ไขต่องานแตกต่างกันไปตาม role ของฉันในแต่ละโปรเจกต์ (ไม่ใช่ "เป็นเจ้าของงาน = แก้ได้เสมอ" อีกต่อไป)
  .get('/tasks/mine', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const rows = await db
      .select({ task: tasks, projectName: projects.name })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      // Tasknista §Back to Basic (ต่อยอด) — เกตจ่ายงาน: งานที่ยังไม่ถูกจ่าย (dispatchedAt ว่าง) ไม่โผล่ในหน้า "งานของฉัน"
      .where(and(eq(tasks.assigneeId, me.id), isNotNull(tasks.dispatchedAt)))
      .orderBy(asc(tasks.dueDate))
    const myMemberships = await db
      .select({ projectId: projectMembers.projectId, role: projectMembers.role })
      .from(projectMembers)
      .where(eq(projectMembers.userId, me.id))
    const roleOf = (projectId: string): 'owner' | 'editor' | 'viewer' => {
      if (me.role === 'owner') return 'owner'
      if (me.role === 'vendor') return 'viewer'
      return myMemberships.find((m) => m.projectId === projectId)?.role === 'editor' ? 'editor' : 'viewer'
    }
    // Tasknista §Back to Basic (ต่อยอด) — ความคืบหน้าเกณฑ์ว่าเสร็จ (checklist) ต่องาน ให้หน้า "งานของฉัน" โชว์ได้โดยไม่ต้องเปิดเข้าไปทีละงาน
    const taskIds = rows.map((r) => r.task.id)
    const checklistRows =
      taskIds.length > 0
        ? await db.select({ taskId: taskChecklistItems.taskId, done: taskChecklistItems.done }).from(taskChecklistItems).where(inArray(taskChecklistItems.taskId, taskIds))
        : []
    const checklistOf = (taskId: string) => {
      const mine = checklistRows.filter((i) => i.taskId === taskId)
      return { checklistDone: mine.filter((i) => i.done).length, checklistTotal: mine.length }
    }
    return c.json(
      rows.map((r) => ({ ...r.task, projectName: r.projectName, myRole: roleOf(r.task.projectId!), ...checklistOf(r.task.id) })),
    )
  })

  // Tasknista §My Tasks dispatcher view — งานที่ฉันเป็นคนกด assign ล่าสุด (assignedBy) ข้ามทุกโปรเจกต์ ดูสถานะรวมของงานที่จ่ายออกไป
  .get('/tasks/dispatched-by-me', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const rows = await db
      .select({ task: tasks, projectName: projects.name, assigneeName: users.name })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .where(eq(tasks.assignedBy, me.id))
      .orderBy(asc(tasks.dueDate))
    return c.json(rows.map((r) => ({ ...r.task, projectName: r.projectName, assigneeName: r.assigneeName })))
  })

  .patch('/tasks/:id', teamOnly, async (c) => {
    const body = taskPatchSchema.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const before = (await db.select().from(tasks).where(eq(tasks.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)

    // Tasknista §permission (Jira-style project role) — งานที่อยู่ในโปรเจกต์แล้ว (ไม่ใช่ backlog):
    // พนักงานต้องเป็น editor ของโปรเจกต์นั้นถึงจะแก้ไขได้ · หรือเป็น assignee ของงานนี้เอง (§Task Detail permission fix — แก้งานตัวเองได้เสมอ)
    // backlog (before.projectId เป็น null) ยังเปิดให้ทุกคนย้าย/แปลง/ตั้งเป็นโปรเจกต์ได้ตามเดิม ไม่ผ่านเช็คนี้
    const me = c.get('user')
    if (!(await canEditTask(db, before, me))) return c.json({ error: 'forbidden' }, 403)
    // Tasknista §Task Detail permission fix — assignee ที่ผ่านมาได้เพราะเป็นเจ้าของงาน (ไม่ใช่ editor ของโปรเจกต์) ห้ามเปลี่ยนผู้รับผิดชอบเอง (ให้ editor/PM เป็นคนเปลี่ยนแทน กันโยนงานหนีเอง)
    if ('assigneeId' in body.data && before.projectId && me.role === 'member' && before.assigneeId === me.id) {
      const role = await getProjectRole(db, before.projectId, me.id, me.role)
      if (!canEditProject(role)) return c.json({ error: 'forbidden', message: 'เปลี่ยนผู้รับผิดชอบเองไม่ได้ ให้ผู้จัดการโปรเจกต์เปลี่ยนแทน' }, 403)
    }
    // Tasknista §4 — Company Backlog: เฉพาะ owner ล็อค/ปลดล็อคได้ · ล็อคแล้ว member แก้ไข/ย้าย/แปลง task นี้ไม่ได้เลย
    if (before.projectId === null && me.role !== 'owner') {
      if (body.data.locked !== undefined) return c.json({ error: 'forbidden' }, 403)
      if (before.locked) return c.json({ error: 'locked' }, 403)
    }

    const patch: Record<string, unknown> = { ...body.data }
    if (body.data.status === 'done' && before.status !== 'done') patch.completedAt = new Date()
    if (body.data.status && body.data.status !== 'done') patch.completedAt = null
    // Tasknista §My Work/Notification — จำคนที่กด assign ล่าสุด (ผู้มอบหมาย) ใช้แจ้งเตือนกลับตอน subtask เสร็จ
    if ('assigneeId' in body.data && body.data.assigneeId && body.data.assigneeId !== before.assigneeId) patch.assignedBy = me.id
    // Tasknista §Back to Basic (ต่อยอด) — เปลี่ยนผู้รับผิดชอบ (รวมถึงเคลียร์เป็น null) ต้องเคลียร์เกตจ่ายงานเดิมด้วยเสมอ กันคนใหม่เห็นงานที่ยังไม่ได้จ่ายให้ตัวเอง
    if ('assigneeId' in body.data && body.data.assigneeId !== before.assigneeId) patch.dispatchedAt = null
    // Tasknista §2.6 — ย้าย backlog เป็น sub-task ของ task ที่มีอยู่ → ผูก project/group ตาม parent + code = <parentCode>.N
    if (body.data.parentId) {
      const parent = (await db.select().from(tasks).where(eq(tasks.id, body.data.parentId)).limit(1))[0]
      if (!parent) return c.json({ error: 'parent_not_found' }, 404)
      patch.projectId = parent.projectId
      patch.groupId = parent.groupId
      patch.code = await nextSubTaskCode(db, parent.id, parent.code ?? sanitizeCodePrefix(null, 'TASK'))
    } else if (body.data.projectId && before.projectId === null) {
      // Tasknista §2.5 — ย้าย backlog (BL-N) เข้าโปรเจกต์ → ออกโค้ดใหม่ตามคำนำหน้าโปรเจกต์
      const project = (await db.select().from(projects).where(eq(projects.id, body.data.projectId)).limit(1))[0]
      patch.code = await nextTypedTaskCode(db, sanitizeCodePrefix(project?.code, 'TASK'), 'Task')
      // Tasknista §5 (2026-07-03) — ย้ายจาก Company Backlog เข้าโปรเจกต์ → ลง "Backlog ของโปรเจกต์" (groupId ยังว่าง ไม่ขึ้นกระดานทันที)
      // แทนที่พฤติกรรมเดิมที่ auto-หา/สร้างกลุ่มแรกให้ (ทำให้โผล่ Non Start บนกระดานทันที) — ผู้ใช้ต้อง "ย้ายเข้ากระดาน" เองอีกที
    }
    // Tasknista §5 — ตั้ง defectStatus เริ่มต้นเมื่อ task เพิ่งกลายเป็น Defect (ยังไม่ได้ระบุ defectStatus มาเอง)
    if (body.data.kind === 'defect' && before.kind !== 'defect' && body.data.defectStatus === undefined) {
      patch.defectStatus = 'reported'
    }
    // Tasknista §Sprint & Board — ลากข้ามคอลัมน์บอร์ด: ต้องอยู่ใน sprint อยู่แล้ว + คอลัมน์ต้องมีจริงใน preset ของ sprint นั้น
    if (body.data.sprintStatus !== undefined && body.data.sprintStatus !== null) {
      if (!before.sprintId) return c.json({ error: 'not_in_sprint' }, 400)
      const sprint = (await db.select().from(sprints).where(eq(sprints.id, before.sprintId)).limit(1))[0]
      const cfg = (await db.select({ boardPresets: companyConfig.boardPresets }).from(companyConfig).limit(1))[0]
      const preset = sprint?.boardPresetId ? presetById(resolvePresets(cfg?.boardPresets), sprint.boardPresetId) : undefined
      if (!preset || !preset.columns.some((col) => col.id === body.data.sprintStatus))
        return c.json({ error: 'invalid_sprint_status' }, 400)
    }

    const updated = await db.update(tasks).set(patch).where(eq(tasks.id, before.id)).returning()

    const action =
      body.data.status && body.data.status !== before.status
        ? 'task.status'
        : 'assigneeId' in body.data && body.data.assigneeId !== before.assigneeId
          ? 'task.assign'
          : 'task.update'
    await writeAudit(c.env, {
      actorId: me.id,
      action,
      entity: 'task',
      entityId: before.id,
      meta: {
        title: before.title,
        before: { status: before.status, assigneeId: before.assigneeId },
        after: body.data,
      },
    })

    // Tasknista §My Work/Notification — เฉพาะ Subtask (parentId ไม่ว่าง) เท่านั้นที่แจ้งเตือน ไม่ส่งอีเมล/แจ้งเตือนออกนอกระบบ
    if (before.parentId !== null) {
      if ('assigneeId' in body.data && body.data.assigneeId && body.data.assigneeId !== before.assigneeId) {
        await db.insert(notifications).values({
          userId: body.data.assigneeId,
          type: 'subtask_assigned',
          taskId: before.id,
          projectId: before.projectId,
          message: `คุณได้รับมอบหมายงานย่อย "${before.title}"`,
        })
      }
      if (body.data.status === 'done' && before.status !== 'done' && before.assignedBy) {
        await db.insert(notifications).values({
          userId: before.assignedBy,
          type: 'subtask_completed',
          taskId: before.id,
          projectId: before.projectId,
          message: `งานย่อย "${before.title}" ที่คุณมอบหมายเสร็จแล้ว`,
        })
      }
    }
    // Tasknista §Task lifecycle notifications — ครบ flow ส่งงาน/อนุมัติ/ตีกลับ ทุก level (ไม่ใช่แค่ subtask เหมือน 2 อันบน)
    if (body.data.status === 'waiting_for_test' && before.status !== 'waiting_for_test' && before.assignedBy) {
      await db.insert(notifications).values({
        userId: before.assignedBy,
        type: 'task_submitted',
        taskId: before.id,
        projectId: before.projectId,
        message: `งาน "${before.title}" ส่งมารอตรวจแล้ว`,
      })
    }
    if (body.data.status === 'done' && before.status === 'waiting_for_test' && before.assigneeId) {
      await db.insert(notifications).values({
        userId: before.assigneeId,
        type: 'task_approved',
        taskId: before.id,
        projectId: before.projectId,
        message: `งาน "${before.title}" ได้รับการอนุมัติแล้ว`,
      })
    }
    if (body.data.status === 'on_processing' && before.status === 'waiting_for_test' && before.assigneeId) {
      await db.insert(notifications).values({
        userId: before.assigneeId,
        type: 'task_bounced',
        taskId: before.id,
        projectId: before.projectId,
        message: `งาน "${before.title}" ถูกตีกลับให้แก้ไข`,
      })
    }
    return c.json(updated[0])
  })

  // Tasknista §Back to Basic (ต่อยอด) — เกตจ่ายงาน: เฉพาะผู้จ่ายงาน (ไม่ใช่ assignee เอง) กดได้ ต้องมีผู้รับผิดชอบตั้งไว้แล้ว
  .post('/tasks/:id/dispatch', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const before = (await db.select().from(tasks).where(eq(tasks.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    if (!before.assigneeId) return c.json({ error: 'assignee_required', message: 'ต้องเลือกผู้รับผิดชอบก่อนถึงจะจ่ายงานได้' }, 400)
    if (before.projectId) {
      const role = await getProjectRole(db, before.projectId, me.id, me.role)
      if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)
    } else if (me.role !== 'owner') {
      return c.json({ error: 'forbidden' }, 403)
    }
    // Tasknista §Task lifecycle accept step — dispatch ตั้งแค่ dispatchedAt เท่านั้น ไม่แตะ status (ต้องรอ assignee กด "รับงาน" เองก่อนถึงจะเป็น on_processing)
    const updated = await db.update(tasks).set({ dispatchedAt: new Date() }).where(eq(tasks.id, before.id)).returning()
    await writeAudit(c.env, { actorId: me.id, action: 'task.dispatch', entity: 'task', entityId: before.id, meta: { title: before.title, assigneeId: before.assigneeId } })
    await db.insert(notifications).values({
      userId: before.assigneeId,
      type: 'task_dispatched',
      taskId: before.id,
      projectId: before.projectId,
      message: `คุณได้รับงานใหม่ "${before.title}" — กดรับงานได้เลย`,
    })
    return c.json(updated[0])
  })

  // Tasknista §Task lifecycle accept step — เฉพาะ assignee เอง กดรับงานที่ถูกจ่ายมาแล้ว (dispatchedAt ไม่ว่าง) ให้ status ขยับเป็น on_processing
  .post('/tasks/:id/accept', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const before = (await db.select().from(tasks).where(eq(tasks.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    if (before.assigneeId !== me.id) return c.json({ error: 'forbidden' }, 403)
    if (!before.dispatchedAt) return c.json({ error: 'not_dispatched', message: 'งานนี้ยังไม่ถูกจ่ายอย่างเป็นทางการ' }, 400)
    if (before.status !== 'non_start') return c.json({ error: 'already_accepted' }, 400)
    const updated = await db.update(tasks).set({ status: 'on_processing' }).where(eq(tasks.id, before.id)).returning()
    await writeAudit(c.env, { actorId: me.id, action: 'task.accept', entity: 'task', entityId: before.id, meta: { title: before.title } })
    return c.json(updated[0])
  })

  // Tasknista §Project Refactor — เมนู "จัดการ" ใน Backlog: แปลงประเภทงาน Epic/Story/Task/Subtask/Defect
  // ต่างจาก PATCH ทั่วไปตรงที่ 'epic' สร้างแถว epics ใหม่ให้ (epics เป็นคนละตารางกับ tasks) ส่วนที่เหลือคือย้ายตำแหน่งใน hierarchy เดิม
  .post('/tasks/:id/convert', teamOnly, async (c) => {
    const body = z
      .object({
        to: z.enum(['epic', 'story', 'task', 'subtask', 'defect', 'cr']),
        targetParentId: z.string().optional(), // ต้องมีสำหรับ 'task'/'subtask'/'defect' (เลือก parent จาก TaskPickerModal)
        // Tasknista §Backlog cross-project convert — โปรเจกต์ปลายทาง (ไม่ระบุ = คงโปรเจกต์เดิม) ใช้กับ epic/story/cr/defect
        targetProjectId: z.string().optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const before = (await db.select().from(tasks).where(eq(tasks.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    if (!(await canEditTask(db, before, me))) return c.json({ error: 'forbidden' }, 403)
    if (before.projectId === null && me.role !== 'owner' && before.locked) return c.json({ error: 'locked' }, 403)
    if (body.data.targetProjectId && body.data.targetProjectId !== before.projectId) {
      const targetRole = await getProjectRole(db, body.data.targetProjectId, me.id, me.role)
      if (!canEditProject(targetRole)) return c.json({ error: 'forbidden', message: 'ไม่มีสิทธิ์แก้ไขโปรเจกต์ปลายทาง' }, 403)
    }

    // Tasknista §Project Refactor — Epic/Story/Task/Subtask คือ "ประเภทงานปกติ" เดียวกัน ต่างแค่ตำแหน่งใน hierarchy · Defect/CR เป็นคนละ kind
    const patch: Record<string, unknown> = { kind: body.data.to === 'defect' || body.data.to === 'cr' ? body.data.to : 'task' }
    // Tasknista §Back to Basic — regenerate เลขรหัสให้ตรงประเภทใหม่ทุกครั้งที่ convert (Epic/Story/Defect/CR ใช้ scheme ใหม่ · Task/Subtask ที่มี parent ยังใช้ dotted code เดิม) เก็บ oldCode ไว้ log เป็นประวัติ
    const codePrefix = sanitizeCodePrefix(null, 'TASK')
    // Tasknista §Backlog cross-project convert — โปรเจกต์ปลายทางจริง (ไม่ระบุ = คงโปรเจกต์เดิม)
    const effectiveProjectId = body.data.targetProjectId ?? before.projectId
    if (body.data.to === 'epic') {
      if (!effectiveProjectId) return c.json({ error: 'project_required', message: 'ต้องผูกโปรเจกต์ก่อนถึงจะยกระดับเป็น Epic ได้' }, 400)
      const project = (await db.select().from(projects).where(eq(projects.id, effectiveProjectId)).limit(1))[0]
      const prefix = sanitizeCodePrefix(project?.code, 'TASK')
      const newEpic = (
        await db.insert(epics).values({ projectId: effectiveProjectId, title: before.title, code: await nextTypedEpicCode(db, prefix), sortOrder: 0 }).returning()
      )[0]
      patch.projectId = effectiveProjectId
      patch.epicId = newEpic!.id
      patch.parentId = null
      // ตัว task เดิมกลายเป็น Story ตัวแรกใต้ Epic ใหม่นี้ — regenerate code ให้ตรง
      patch.code = await nextTypedTaskCode(db, prefix, 'Story')
    } else if (body.data.to === 'story' || body.data.to === 'cr' || body.data.to === 'defect') {
      // Tasknista §Back to Basic (ต่อยอด) — Defect ผูกกับ Epic/Story/Task แบบอ้างอิง (task_references) ไม่ใช่ลูก-แม่ เหมือน CR จึงไม่บังคับเลือก parent (เดิมพลาดไปรวมกับ task/subtask ที่ต้องมี parent จริง)
      patch.parentId = null
      patch.projectId = effectiveProjectId
      const project = effectiveProjectId ? (await db.select().from(projects).where(eq(projects.id, effectiveProjectId)).limit(1))[0] : null
      const prefix = sanitizeCodePrefix(project?.code, 'TASK')
      if (body.data.to === 'defect' && before.kind !== 'defect') patch.defectStatus = 'reported'
      patch.code = await nextTypedTaskCode(db, prefix, body.data.to === 'cr' ? 'CR' : body.data.to === 'defect' ? 'Defect' : 'Story')
    } else {
      // task | subtask — ต้องเลือก parent จาก picker (โปรเจกต์ปลายทางตามที่ parent สังกัดอยู่จริง)
      if (!body.data.targetParentId) return c.json({ error: 'target_parent_required' }, 400)
      const parent = (await db.select().from(tasks).where(eq(tasks.id, body.data.targetParentId)).limit(1))[0]
      if (!parent) return c.json({ error: 'parent_not_found' }, 404)
      if (parent.projectId && parent.projectId !== before.projectId) {
        const parentRole = await getProjectRole(db, parent.projectId, me.id, me.role)
        if (!canEditProject(parentRole)) return c.json({ error: 'forbidden', message: 'ไม่มีสิทธิ์แก้ไขโปรเจกต์ปลายทาง' }, 403)
      }
      patch.parentId = parent.id
      patch.projectId = parent.projectId
      patch.groupId = parent.groupId
      patch.epicId = parent.epicId
      patch.code = await nextSubTaskCode(db, parent.id, parent.code ?? codePrefix)
    }

    const updated = await db.update(tasks).set(patch).where(eq(tasks.id, before.id)).returning()
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'task.convert',
      entity: 'task',
      entityId: before.id,
      meta: { title: before.title, to: body.data.to, targetParentId: body.data.targetParentId ?? null, targetProjectId: body.data.targetProjectId ?? null, oldCode: before.code, newCode: patch.code ?? before.code },
    })
    return c.json(updated[0])
  })

  .delete('/tasks/:id', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const before = (await db.select().from(tasks).where(eq(tasks.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    // Tasknista §permission (Jira-style project role): งาน backlog (ไม่มีโปรเจกต์) — กฎเดิม ลบได้เฉพาะคนที่สร้าง
    // งานที่อยู่ในโปรเจกต์แล้ว — ต้องเป็น editor ของโปรเจกต์นั้น (แทนที่กฎเดิม "ลบได้เฉพาะคนที่สร้าง" — editor ลบงานคนอื่นได้ด้วย)
    const me = c.get('user')
    if (me.role === 'member') {
      if (before.projectId === null) {
        // Tasknista §4 — Company Backlog: ล็อคแล้ว member ลบไม่ได้เลย (แม้จะเป็นคนสร้างเอง)
        if (before.locked) return c.json({ error: 'locked' }, 403)
        if (before.createdBy !== me.id) return c.json({ error: 'forbidden' }, 403)
      } else {
        const role = await getProjectRole(db, before.projectId, me.id, me.role)
        if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)
      }
    }
    // T12 — กันลบ task ที่มี time entries (ข้อมูลเงิน, soft-delete only ตาม SPEC §11) หรือมีงานย่อยอยู่ ก่อนจะไปแตะ FK ใดๆ
    const [hasTime, hasSubtasks] = await Promise.all([
      db.select({ id: timeEntries.id }).from(timeEntries).where(eq(timeEntries.taskId, before.id)).limit(1),
      db.select({ id: tasks.id }).from(tasks).where(eq(tasks.parentId, before.id)).limit(1),
    ])
    if (hasTime.length > 0)
      return c.json({ error: 'has_time_entries', message: 'ลบไม่ได้ เพราะมีการลงเวลาในงานนี้แล้ว (ข้อมูลการเงิน ลบไม่ได้ตามกฎ) — ย้ายเวลาไปงานอื่นก่อน หรือเก็บงานนี้ไว้เฉยๆ' }, 409)
    if (hasSubtasks.length > 0)
      return c.json({ error: 'has_subtasks', message: 'ลบไม่ได้ เพราะยังมีงานย่อยอยู่ — ลบหรือย้ายงานย่อยออกก่อน' }, 409)

    // เมทาดาต้า (ไม่ใช่ข้อมูลการเงิน) — ลบทิ้งได้จริงก่อนลบ task ตัวเอง กัน FK constraint failed
    const attachments = await db.select().from(taskAttachments).where(eq(taskAttachments.taskId, before.id))
    for (const att of attachments) {
      if (att.r2Key) await c.env.FILES.delete(att.r2Key)
    }
    await db.delete(taskAttachments).where(eq(taskAttachments.taskId, before.id))
    await db.delete(taskComments).where(eq(taskComments.taskId, before.id))
    await db.delete(taskCustomFields).where(eq(taskCustomFields.taskId, before.id))
    await db.delete(taskStars).where(eq(taskStars.taskId, before.id))
    await db.delete(docLinks).where(eq(docLinks.taskId, before.id))
    await db.delete(timerSessions).where(eq(timerSessions.taskId, before.id))
    await db.delete(notifications).where(eq(notifications.taskId, before.id))

    await db.delete(tasks).where(eq(tasks.id, before.id))
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'task.delete',
      entity: 'task',
      entityId: before.id,
      meta: { title: before.title },
    })
    return c.json({ ok: true })
  })

  // จัดเรียง group + task ทั้งกระดานในครั้งเดียว (โหมดจัดเรียง — จัดโครงสร้างโปรเจกต์ = owner หรือ editor ของโปรเจกต์นี้)
  .post('/projects/:id/reorder', teamOnly, async (c) => {
    const body = z
      .object({
        groups: z.array(z.object({ id: z.string(), sortOrder: z.number().int() })).default([]),
        tasks: z
          .array(z.object({ id: z.string(), groupId: z.string(), sortOrder: z.number().int() }))
          .default([]),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const me = c.get('user')
    const role = await getProjectRole(db, projectId, me.id, me.role)
    if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)
    for (const g of body.data.groups)
      await db
        .update(taskGroups)
        .set({ sortOrder: g.sortOrder })
        .where(and(eq(taskGroups.id, g.id), eq(taskGroups.projectId, projectId)))
    for (const t of body.data.tasks)
      await db
        .update(tasks)
        .set({ sortOrder: t.sortOrder, groupId: t.groupId })
        .where(and(eq(tasks.id, t.id), eq(tasks.projectId, projectId)))
    return c.json({ ok: true })
  })
