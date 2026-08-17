/**
 * Pronista §Workspace Rooms — "ห้อง" ทำงานของทีม (ชื่อ + สมาชิก + โปรเจกต์ที่ดึงเข้าห้อง) คนละเรื่องกับ projects/`workspace.ts` (aggregate Backlog/Sprint)
 * กด "+ Create Workspace" ตั้งชื่อ+เพิ่มสมาชิก → ห้องใหม่เริ่มว่างเปล่า (ไม่มีโปรเจกต์ผูกไว้) จนกว่าจะเพิ่มโปรเจกต์เข้าห้องเอง (ดู workspace_projects)
 * เข้าห้องได้เฉพาะสมาชิก (หรือ owner บริษัทเห็นได้ทุกห้องเพื่อดูแลระบบ) · แก้ชื่อ/ลบห้อง/จัดการโปรเจกต์ในห้อง = ผู้สร้างห้องหรือ owner บริษัทเท่านั้น
 */
import { createDb, epics, projects, sprints, tasks, users, workspaceMembers, workspaceProjects, workspaces } from '@seedoffice/db'
import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { nextTaskCode, nextTypedEpicCode, nextTypedTaskCode } from '../lib/task-code'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

async function isMember(db: ReturnType<typeof createDb>, workspaceId: string, userId: string) {
  const row = (await db.select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))).limit(1))[0]
  return !!row
}

/** แก้ชื่อ/ลบห้อง/จัดการโปรเจกต์ในห้อง — เฉพาะผู้สร้างห้องหรือ owner บริษัท (กว้างกว่าสมาชิกทั่วไปที่แค่เพิ่ม/เอาคนออกได้) */
async function canManageRoom(db: ReturnType<typeof createDb>, workspaceId: string, me: { id: string; role: 'owner' | 'member' | 'vendor' | 'guest' }) {
  if (me.role === 'owner') return true
  const row = (await db.select({ createdBy: workspaces.createdBy }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0]
  return !!row && row.createdBy === me.id
}

export const workspaceRoomRoutes = new Hono<AppEnv>()

  // ห้องที่ฉันเป็นสมาชิก (owner บริษัทเห็นทุกห้อง เผื่อดูแลระบบ)
  .get('/workspaces', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const all = await db.select().from(workspaces).orderBy(asc(workspaces.createdAt))
    const memberRows = await db.select({ workspaceId: workspaceMembers.workspaceId, userId: workspaceMembers.userId }).from(workspaceMembers)
    const membersByWorkspace = new Map<string, string[]>()
    for (const r of memberRows) membersByWorkspace.set(r.workspaceId, [...(membersByWorkspace.get(r.workspaceId) ?? []), r.userId])
    const mine = me.role === 'owner' ? all : all.filter((w) => (membersByWorkspace.get(w.id) ?? []).includes(me.id))
    return c.json(mine.map((w) => ({ id: w.id, name: w.name, type: w.type, memberCount: (membersByWorkspace.get(w.id) ?? []).length, createdAt: w.createdAt })))
  })

  // สร้างห้องใหม่ — ผู้สร้างเป็นสมาชิกอัตโนมัติ + เพิ่มสมาชิกที่เลือกตอนสร้างได้เลย
  .post('/workspaces', teamOnly, async (c) => {
    const body = z
      .object({ name: z.string().min(1).max(80), type: z.enum(['business', 'developer']).default('developer'), memberIds: z.array(z.string()).default([]) })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const created = (await db.insert(workspaces).values({ name: body.data.name, type: body.data.type, createdBy: me.id }).returning())[0]
    if (!created) return c.json({ error: 'create_failed' }, 500)
    const memberIds = [...new Set([me.id, ...body.data.memberIds])]
    const validUsers = memberIds.length > 0 ? await db.select({ id: users.id }).from(users).where(inArray(users.id, memberIds)) : []
    const validIds = new Set(validUsers.map((u) => u.id))
    await db.insert(workspaceMembers).values([...validIds].map((userId) => ({ workspaceId: created.id, userId })))
    return c.json(created, 201)
  })

  // รายละเอียดห้อง + สมาชิก — เฉพาะสมาชิก (หรือ owner บริษัท)
  .get('/workspaces/:id', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const workspaceId = c.req.param('id')
    const workspace = (await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0]
    if (!workspace) return c.json({ error: 'not_found' }, 404)
    if (me.role !== 'owner' && !(await isMember(db, workspaceId, me.id))) return c.json({ error: 'forbidden' }, 403)
    const memberRows = await db
      .select({ userId: users.id, name: users.name, avatarUrl: users.avatarUrl, role: users.role })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
    const projectRows = await db
      .select({ id: projects.id, code: projects.code, name: projects.name })
      .from(workspaceProjects)
      .innerJoin(projects, eq(workspaceProjects.projectId, projects.id))
      .where(eq(workspaceProjects.workspaceId, workspaceId))
    return c.json({ ...workspace, members: memberRows, projects: projectRows, canManage: await canManageRoom(db, workspaceId, me) })
  })

  // แก้ชื่อห้อง — ผู้สร้างห้องหรือ owner บริษัทเท่านั้น
  .patch('/workspaces/:id', teamOnly, async (c) => {
    const body = z.object({ name: z.string().min(1).max(80) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const workspaceId = c.req.param('id')
    const workspace = (await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0]
    if (!workspace) return c.json({ error: 'not_found' }, 404)
    if (!(await canManageRoom(db, workspaceId, me))) return c.json({ error: 'forbidden' }, 403)
    const updated = (await db.update(workspaces).set({ name: body.data.name }).where(eq(workspaces.id, workspaceId)).returning())[0]
    await writeAudit(c.env, { actorId: me.id, action: 'workspace.rename', entity: 'workspace', entityId: workspaceId, meta: { name: body.data.name } })
    return c.json(updated)
  })

  // ลบห้อง — ผู้สร้างห้องหรือ owner บริษัทเท่านั้น (ไม่กระทบโปรเจกต์/task จริง — แค่เลิกใช้ห้องนี้)
  .delete('/workspaces/:id', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const workspaceId = c.req.param('id')
    const workspace = (await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0]
    if (!workspace) return c.json({ error: 'not_found' }, 404)
    if (!(await canManageRoom(db, workspaceId, me))) return c.json({ error: 'forbidden' }, 403)
    // Pronista §Workspace Sprint (ต่อยอด) — กันลบห้องที่ยังมี Sprint ที่ยังไม่ปิด (งานในนั้นจะกลายเป็นข้อมูลลอย หา sprint ไม่เจอ) ต้องปิด Sprint ให้หมดก่อน
    const openSprint = (await db.select({ id: sprints.id }).from(sprints).where(and(eq(sprints.workspaceId, workspaceId), ne(sprints.status, 'completed'))).limit(1))[0]
    if (openSprint) return c.json({ error: 'has_open_sprints', message: 'ห้องนี้ยังมี Sprint ที่ยังไม่ปิด ปิด Sprint ให้หมดก่อนถึงจะลบห้องได้' }, 409)
    // Sprint ที่ปิดแล้ว (completed) ยังมี FK ชี้มาที่ห้องนี้อยู่ — ปลดออก (เก็บประวัติ/snapshot ไว้เหมือนเดิม แค่ไม่มีห้องแล้ว) ก่อนลบห้องจริง
    await db.update(sprints).set({ workspaceId: null }).where(eq(sprints.workspaceId, workspaceId))
    // Pronista §bugfix — Backlog/Epic ที่คีย์ลอยในห้อง (workspace-native, ไม่ผูกโปรเจกต์) ก็มี FK ชี้มาที่ห้องนี้เหมือนกัน ลืมปลดจุดนี้ทำให้ลบห้องไม่ได้ (FOREIGN KEY constraint) ถ้ามีงานลอยค้างอยู่
    await db.update(tasks).set({ workspaceId: null }).where(eq(tasks.workspaceId, workspaceId))
    await db.update(epics).set({ workspaceId: null }).where(eq(epics.workspaceId, workspaceId))
    await db.delete(workspaceProjects).where(eq(workspaceProjects.workspaceId, workspaceId))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId))
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
    await writeAudit(c.env, { actorId: me.id, action: 'workspace.delete', entity: 'workspace', entityId: workspaceId, meta: {} })
    return c.json({ ok: true })
  })

  // เพิ่มโปรเจกต์เข้าห้อง — ผู้สร้างห้องหรือ owner บริษัทเท่านั้น (ห้องใหม่เริ่มว่างเปล่า จนกว่าจะเพิ่มตรงนี้)
  .post('/workspaces/:id/projects', teamOnly, async (c) => {
    const body = z.object({ projectId: z.string() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const workspaceId = c.req.param('id')
    const workspace = (await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0]
    if (!workspace) return c.json({ error: 'not_found' }, 404)
    if (!(await canManageRoom(db, workspaceId, me))) return c.json({ error: 'forbidden' }, 403)
    const project = (await db.select({ id: projects.id }).from(projects).where(eq(projects.id, body.data.projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'project_not_found' }, 404)
    await db.insert(workspaceProjects).values({ workspaceId, projectId: body.data.projectId }).onConflictDoNothing()
    return c.json({ ok: true }, 201)
  })

  // เอาโปรเจกต์ออกจากห้อง — ผู้สร้างห้องหรือ owner บริษัทเท่านั้น
  .delete('/workspaces/:id/projects/:projectId', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const workspaceId = c.req.param('id')
    if (!(await canManageRoom(db, workspaceId, me))) return c.json({ error: 'forbidden' }, 403)
    await db.delete(workspaceProjects).where(and(eq(workspaceProjects.workspaceId, workspaceId), eq(workspaceProjects.projectId, c.req.param('projectId'))))
    return c.json({ ok: true })
  })

  // Pronista §System Requirements Update — คีย์งาน "Backlog"/"Story" ตรงในห้องได้เลย ไม่ต้องผูกโปรเจกต์จริง (projectId ว่าง, workspaceId ผูกห้องนี้แทน)
  // สมาชิกห้องนี้ (หรือ owner บริษัท) คีย์ได้ — ต่างจากงาน Task/Subtask/Defect ที่ยังต้องเลือกโปรเจกต์จริงในห้องเหมือนเดิม (มี hierarchy ที่ผูกกับโปรเจกต์)
  .post('/workspaces/:id/backlog', teamOnly, async (c) => {
    const body = z.object({ title: z.string().min(1), kind: z.enum(['backlog', 'story']).default('backlog') }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const workspaceId = c.req.param('id')
    const workspace = (await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0]
    if (!workspace) return c.json({ error: 'not_found' }, 404)
    if (me.role !== 'owner' && !(await isMember(db, workspaceId, me.id))) return c.json({ error: 'forbidden' }, 403)
    const code = body.data.kind === 'story' ? await nextTypedTaskCode(db, 'WS', 'Story') : await nextTaskCode(db, 'WS')
    const created = (
      await db
        .insert(tasks)
        .values({ projectId: null, groupId: null, workspaceId, sortOrder: 0, createdBy: me.id, code, title: body.data.title, kind: body.data.kind === 'story' ? 'task' : 'backlog' })
        .returning()
    )[0]
    if (!created) return c.json({ error: 'insert_failed' }, 500)
    await writeAudit(c.env, { actorId: me.id, action: 'task.create', entity: 'task', entityId: created.id, meta: { title: created.title, workspaceBacklog: true } })
    return c.json(created, 201)
  })

  // Pronista §System Requirements Update — คีย์งาน "Epic" ตรงในห้องได้เลย ไม่ต้องผูกโปรเจกต์จริง (projectId ว่าง, workspaceId ผูกห้องนี้แทน) — เหมือน Backlog/Story ข้างบน
  .post('/workspaces/:id/epics', teamOnly, async (c) => {
    const body = z.object({ title: z.string().min(1) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const workspaceId = c.req.param('id')
    const workspace = (await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0]
    if (!workspace) return c.json({ error: 'not_found' }, 404)
    if (me.role !== 'owner' && !(await isMember(db, workspaceId, me.id))) return c.json({ error: 'forbidden' }, 403)
    const code = await nextTypedEpicCode(db, 'WS')
    const created = (
      await db.insert(epics).values({ projectId: null, workspaceId, sortOrder: 0, title: body.data.title, code }).returning()
    )[0]
    if (!created) return c.json({ error: 'insert_failed' }, 500)
    await writeAudit(c.env, { actorId: me.id, action: 'epic.create', entity: 'epic', entityId: created.id, meta: { title: created.title, workspaceBacklog: true } })
    return c.json(created, 201)
  })

  // เพิ่มสมาชิก — เฉพาะสมาชิกในห้องเดิม (หรือ owner บริษัท)
  .post('/workspaces/:id/members', teamOnly, async (c) => {
    const body = z.object({ userId: z.string() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const workspaceId = c.req.param('id')
    const workspace = (await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0]
    if (!workspace) return c.json({ error: 'not_found' }, 404)
    if (me.role !== 'owner' && !(await isMember(db, workspaceId, me.id))) return c.json({ error: 'forbidden' }, 403)
    const targetUser = (await db.select({ id: users.id }).from(users).where(eq(users.id, body.data.userId)).limit(1))[0]
    if (!targetUser) return c.json({ error: 'user_not_found' }, 404)
    if (await isMember(db, workspaceId, body.data.userId)) return c.json({ error: 'already_member' }, 409)
    await db.insert(workspaceMembers).values({ workspaceId, userId: body.data.userId })
    return c.json({ ok: true }, 201)
  })

  // เอาสมาชิกออก — เฉพาะสมาชิกในห้องเดิม (หรือ owner บริษัท) รวมถึงออกจากห้องเอง
  .delete('/workspaces/:id/members/:userId', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const workspaceId = c.req.param('id')
    const targetUserId = c.req.param('userId')
    if (me.role !== 'owner' && me.id !== targetUserId && !(await isMember(db, workspaceId, me.id))) return c.json({ error: 'forbidden' }, 403)
    await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)))
    return c.json({ ok: true })
  })
