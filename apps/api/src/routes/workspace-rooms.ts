/**
 * Pronista §Workspace Rooms — "ห้อง" ทำงานของทีม (ชื่อ + สมาชิก) คนละเรื่องกับ projects/`workspace.ts` (aggregate Backlog/Sprint)
 * กด "+ Create Workspace" ตั้งชื่อ+เพิ่มสมาชิก → เข้าไปในห้องแล้วเจอหน้า Workspace (Backlog/Sprint) เดิมทั้งดุ้น (ยังไม่กรองโปรเจกต์ตามห้อง — ดูฟีดแบ็กที่ตกลงกันไว้)
 * เข้าห้องได้เฉพาะสมาชิก (หรือ owner บริษัทเห็นได้ทุกห้องเพื่อดูแลระบบ)
 */
import { createDb, users, workspaceMembers, workspaces } from '@seedoffice/db'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

async function isMember(db: ReturnType<typeof createDb>, workspaceId: string, userId: string) {
  const row = (await db.select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))).limit(1))[0]
  return !!row
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
    return c.json(mine.map((w) => ({ id: w.id, name: w.name, memberCount: (membersByWorkspace.get(w.id) ?? []).length, createdAt: w.createdAt })))
  })

  // สร้างห้องใหม่ — ผู้สร้างเป็นสมาชิกอัตโนมัติ + เพิ่มสมาชิกที่เลือกตอนสร้างได้เลย
  .post('/workspaces', teamOnly, async (c) => {
    const body = z.object({ name: z.string().min(1).max(80), memberIds: z.array(z.string()).default([]) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const created = (await db.insert(workspaces).values({ name: body.data.name, createdBy: me.id }).returning())[0]
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
    return c.json({ ...workspace, members: memberRows })
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
