/**
 * Pronista §Workspace — Sprint/Backlog รวมทุกโปรเจกต์ที่ผู้ใช้มีสิทธิ์เห็น (endpoint อ่านอย่างเดียว)
 * ทุก mutation (สร้าง/เริ่ม/ปิด Sprint, ลากงานเข้า Sprint, สร้าง backlog task) ใช้ endpoint เดิมของ sprints.ts/tasks.ts ไม่ต้องมีของใหม่
 * เพราะแถวที่คืนจากที่นี่มี projectId/sprintId ติดมาครบอยู่แล้ว — ดูแผน "Workspace" ในไฟล์ plan
 */
import { createDb, projects, workspaceProjects } from '@seedoffice/db'
import { eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { getProjectPermissions, getProjectRole } from '../lib/project-role'
import { loadProjectAllBacklogItems, loadProjectBacklog, loadProjectSprintBoards } from '../lib/workspace-query'
import type { AppEnv } from '../types'

/** โปรเจกต์ (ไม่ถูกลบ) ที่ผู้ใช้คนนี้มีสิทธิ์เห็นแท็บ Sprint — กรองซ้ำที่ server เสมอ ไม่เชื่อ query param จาก client เป็น authorization */
async function accessibleProjects(db: ReturnType<typeof createDb>, me: { id: string; role: 'owner' | 'member' | 'vendor' | 'guest' }) {
  const all = await db.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects).where(isNull(projects.deletedAt))
  const flags = await Promise.all(all.map(async (p) => (await getProjectPermissions(db, p.id, me.id, me.role)).tabs.sprint === true))
  return all.filter((_p, i) => flags[i])
}

/** ตัดรายการที่ยิง ?projectIds= มาแคบลง — ใช้แค่ narrow ไม่ใช้ escalate (id ที่ไม่มีสิทธิ์ ถูกกรองทิ้งเงียบๆ) */
function narrowByQuery(list: { id: string; code: string | null; name: string }[], projectIdsParam: string | undefined) {
  if (!projectIdsParam) return list
  const wanted = new Set(projectIdsParam.split(',').filter(Boolean))
  return list.filter((p) => wanted.has(p.id))
}

/** Pronista §Workspace Rooms (ต่อยอด) — แคบรายการลงเหลือแค่โปรเจกต์ที่ถูกดึงเข้าห้องนี้แล้ว (ห้องใหม่ = ยังไม่ดึงอะไรเข้าเลย → ว่างเปล่า)
 * ต่างจาก narrowByQuery (ตัวกรองที่ผู้ใช้เลือกเอง) — อันนี้เป็นขอบเขตจริงของห้อง บังคับเสมอเมื่อมี ?workspaceId= */
async function narrowByWorkspace(
  db: ReturnType<typeof createDb>,
  list: { id: string; code: string | null; name: string }[],
  workspaceId: string | undefined,
) {
  if (!workspaceId) return list
  const links = await db.select({ projectId: workspaceProjects.projectId }).from(workspaceProjects).where(eq(workspaceProjects.workspaceId, workspaceId))
  const linked = new Set(links.map((l) => l.projectId))
  return list.filter((p) => linked.has(p.id))
}

export const workspaceRoutes = new Hono<AppEnv>()

  .get('/workspace/accessible-projects', async (c) => {
    const db = createDb(c.env.DB)
    const list = await narrowByWorkspace(db, await accessibleProjects(db, c.get('user')), c.req.query('workspaceId'))
    return c.json(list)
  })

  // Sprint/Backlog ที่ยังไม่ completed ของทุกโปรเจกต์ที่เข้าถึงได้ (หรือเฉพาะที่ระบุใน ?projectIds=) — ติด projectId/projectCode/projectName ทุกแถว
  .get('/workspace/board', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const scoped = await narrowByWorkspace(db, await accessibleProjects(db, me), c.req.query('workspaceId'))
    const list = narrowByQuery(scoped, c.req.query('projectIds'))
    const perProject = await Promise.all(
      list.map(async (p) => {
        const items = await loadProjectSprintBoards(db, p.id)
        return items.map((it) => ({ ...it, projectId: p.id, projectCode: p.code, projectName: p.name }))
      }),
    )
    const sprints = perProject.flat().sort((a, b) => {
      if (a.sprint.status === 'active' && b.sprint.status !== 'active') return -1
      if (a.sprint.status !== 'active' && b.sprint.status === 'active') return 1
      return a.sprint.createdAt.getTime() - b.sprint.createdAt.getTime()
    })
    return c.json({ sprints })
  })

  // Backlog ของทุกโปรเจกต์ที่เข้าถึงได้ (หรือเฉพาะที่ระบุใน ?projectIds=) — group ต่อโปรเจกต์ ให้ frontend render เป็น section พับได้
  // Pronista §Workspace Backlog Grid — ไม่ถูกเรียกจากหน้าไหนแล้ว (Workspace.tsx เปลี่ยนไปใช้ /workspace/backlog-items ที่เป็น flat grid แทน) เก็บไว้เผื่อใช้ทีหลัง
  .get('/workspace/backlog', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const list = narrowByQuery(await accessibleProjects(db, me), c.req.query('projectIds'))
    const tasksByProject = await Promise.all(
      list.map(async (p) => {
        const myRole = await getProjectRole(db, p.id, me.id, me.role)
        const { tasks, epics } = await loadProjectBacklog(db, p.id, myRole, me.id)
        return { projectId: p.id, projectCode: p.code, projectName: p.name, tasks, epics }
      }),
    )
    return c.json({ tasksByProject })
  })

  // Pronista §Workspace Backlog Grid — flat array ของทุก work item (Epic/Story/Task/Subtask/ทั่วไป) ที่ยังไม่เข้า Sprint ข้ามทุกโปรเจกต์ที่เข้าถึงได้ ติด projectId/projectCode/projectName ทุกแถว
  .get('/workspace/backlog-items', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const scoped = await narrowByWorkspace(db, await accessibleProjects(db, me), c.req.query('workspaceId'))
    const list = narrowByQuery(scoped, c.req.query('projectIds'))
    const perProject = await Promise.all(
      list.map(async (p) => {
        const items = await loadProjectAllBacklogItems(db, p.id)
        return items.map((it) => ({ ...it, projectId: p.id, projectCode: p.code, projectName: p.name }))
      }),
    )
    return c.json({ items: perProject.flat() })
  })
