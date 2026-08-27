import { createDb, meetingActionItems, meetingParticipants, meetings, notifications, projectMembers, projects, users } from '@seedoffice/db'
import { and, asc, eq, gte, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { getProjectPermissions } from '../lib/project-role'
import { createQuickTask } from '../lib/quick-task'
import { teamOrMenu } from '../middleware/roles'
import type { AppEnv } from '../types'

export const meetingRoutes = new Hono<AppEnv>()

const MEETING_TYPES = ['team', 'project', 'sprint_planning', 'sprint_review', 'daily_standup', 'client', 'other'] as const

/** ดู/แก้ agenda-notes-action items ร่วมกันได้ทุกคนที่เกี่ยวข้องกับประชุมนี้ (ผู้จัด + ผู้เข้าร่วม + สมาชิกโปรเจกต์ที่ผูกไว้) — owner เห็น/แก้ได้ทุกอัน */
async function canAccessMeeting(db: ReturnType<typeof createDb>, meeting: { id: string; organizerId: string; projectId: string | null }, me: { id: string; role: string }): Promise<boolean> {
  if (me.role === 'owner' || meeting.organizerId === me.id) return true
  const participant = (await db.select().from(meetingParticipants).where(and(eq(meetingParticipants.meetingId, meeting.id), eq(meetingParticipants.userId, me.id))).limit(1))[0]
  if (participant) return true
  if (!meeting.projectId) return false
  return !!(await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, meeting.projectId), eq(projectMembers.userId, me.id))).limit(1))[0]
}

async function visibleMeetingIds(db: ReturnType<typeof createDb>, me: { id: string; role: string }): Promise<string[] | null> {
  if (me.role === 'owner') return null // null = ไม่กรอง เห็นหมด
  const organized = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.organizerId, me.id))
  const asParticipant = await db.select({ id: meetingParticipants.meetingId }).from(meetingParticipants).where(eq(meetingParticipants.userId, me.id))
  const myProjectIds = (await db.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, me.id))).map((r) => r.id)
  const byProject = myProjectIds.length ? await db.select({ id: meetings.id }).from(meetings).where(inArray(meetings.projectId, myProjectIds)) : []
  return [...new Set([...organized.map((r) => r.id), ...asParticipant.map((r) => r.id), ...byProject.map((r) => r.id)])]
}

meetingRoutes
  // scope=upcoming (ค่าเริ่มต้น): เรียงจากใกล้สุด รวมของวันนี้ · scope=all: ประวัติทั้งหมด เรียงล่าสุดก่อน
  .get('/meetings', teamOrMenu('team'), async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const scope = c.req.query('scope') === 'all' ? 'all' : 'upcoming'
    const ids = await visibleMeetingIds(db, me)
    if (ids && ids.length === 0) return c.json([]) // ไม่ใช่ owner และไม่เกี่ยวข้องกับประชุมไหนเลย
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const conditions = [...(ids ? [inArray(meetings.id, ids)] : []), ...(scope === 'upcoming' ? [gte(meetings.startAt, startOfToday)] : [])]
    const rows = await db
      .select({ meeting: meetings, projectName: projects.name })
      .from(meetings)
      .leftJoin(projects, eq(meetings.projectId, projects.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(meetings.startAt))
    const sorted = scope === 'all' ? rows.reverse() : rows
    return c.json(sorted.map((r) => ({ ...r.meeting, projectName: r.projectName })))
  })

  .post('/meetings', teamOrMenu('team'), async (c) => {
    const body = z
      .object({
        title: z.string().min(1),
        meetingType: z.enum(MEETING_TYPES).default('other'),
        projectId: z.string().nullable().optional(),
        sprintId: z.string().nullable().optional(),
        startAt: z.number(),
        endAt: z.number(),
        externalMeetingUrl: z.string().url().nullable().optional(),
        agenda: z.string().nullable().optional(),
        participantIds: z.array(z.string()).default([]),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    if (body.data.endAt <= body.data.startAt) return c.json({ error: 'invalid_time_range', message: 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const created = (
      await db
        .insert(meetings)
        .values({
          title: body.data.title,
          meetingType: body.data.meetingType,
          projectId: body.data.projectId ?? null,
          sprintId: body.data.sprintId ?? null,
          organizerId: me.id,
          startAt: new Date(body.data.startAt),
          endAt: new Date(body.data.endAt),
          externalMeetingUrl: body.data.externalMeetingUrl ?? null,
          agenda: body.data.agenda ?? null,
        })
        .returning()
    )[0]!
    const participantIds = new Set([me.id, ...body.data.participantIds])
    await db.insert(meetingParticipants).values([...participantIds].map((userId) => ({ meetingId: created.id, userId })))
    for (const userId of participantIds) {
      if (userId === me.id) continue
      await db.insert(notifications).values({ userId, type: 'meeting_scheduled', message: `${me.name} นัดประชุม "${created.title}"` })
    }
    await writeAudit(c.env, { actorId: me.id, action: 'meeting.create', entity: 'meeting', entityId: created.id, meta: { title: created.title } })
    return c.json(created, 201)
  })

  .get('/meetings/:id', teamOrMenu('team'), async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const meeting = (await db.select().from(meetings).where(eq(meetings.id, c.req.param('id'))).limit(1))[0]
    if (!meeting) return c.json({ error: 'not_found' }, 404)
    if (!(await canAccessMeeting(db, meeting, me))) return c.json({ error: 'forbidden' }, 403)
    const participantRows = await db.select({ userId: meetingParticipants.userId, name: users.name }).from(meetingParticipants).innerJoin(users, eq(meetingParticipants.userId, users.id)).where(eq(meetingParticipants.meetingId, meeting.id))
    const actionItems = await db.select().from(meetingActionItems).where(eq(meetingActionItems.meetingId, meeting.id)).orderBy(asc(meetingActionItems.createdAt))
    const project = meeting.projectId ? (await db.select({ name: projects.name }).from(projects).where(eq(projects.id, meeting.projectId)).limit(1))[0] : null
    return c.json({ ...meeting, projectName: project?.name ?? null, participants: participantRows, actionItems })
  })

  .patch('/meetings/:id', teamOrMenu('team'), async (c) => {
    const body = z
      .object({
        title: z.string().min(1).optional(),
        startAt: z.number().optional(),
        endAt: z.number().optional(),
        externalMeetingUrl: z.string().url().nullable().optional(),
        agenda: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(meetings).where(eq(meetings.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    // Pronista §Team Meeting — agenda/notes แก้ร่วมกันได้ทุกคนที่เกี่ยวข้อง (เหมือนเอกสารประชุมร่วม) แต่แก้หัวข้อ/เวลา/ลิงก์ (ข้อมูลนัดหมาย) ต้องเป็นผู้จัดหรือ owner เท่านั้น
    const isOrganizerOrOwner = me.role === 'owner' || before.organizerId === me.id
    if (('title' in body.data || 'startAt' in body.data || 'endAt' in body.data || 'externalMeetingUrl' in body.data) && !isOrganizerOrOwner)
      return c.json({ error: 'forbidden', message: 'แก้ข้อมูลนัดหมายได้เฉพาะผู้จัดประชุมหรือ owner' }, 403)
    if (!(await canAccessMeeting(db, before, me))) return c.json({ error: 'forbidden' }, 403)
    const patch: Record<string, unknown> = {}
    if (body.data.title !== undefined) patch.title = body.data.title
    if (body.data.startAt !== undefined) patch.startAt = new Date(body.data.startAt)
    if (body.data.endAt !== undefined) patch.endAt = new Date(body.data.endAt)
    if (body.data.externalMeetingUrl !== undefined) patch.externalMeetingUrl = body.data.externalMeetingUrl
    if (body.data.agenda !== undefined) patch.agenda = body.data.agenda
    if (body.data.notes !== undefined) patch.notes = body.data.notes
    const updated = (await db.update(meetings).set(patch).where(eq(meetings.id, before.id)).returning())[0]!
    return c.json(updated)
  })

  .delete('/meetings/:id', teamOrMenu('team'), async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(meetings).where(eq(meetings.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    if (me.role !== 'owner' && before.organizerId !== me.id) return c.json({ error: 'forbidden' }, 403)
    await db.delete(meetingActionItems).where(eq(meetingActionItems.meetingId, before.id))
    await db.delete(meetingParticipants).where(eq(meetingParticipants.meetingId, before.id))
    await db.delete(meetings).where(eq(meetings.id, before.id))
    await writeAudit(c.env, { actorId: me.id, action: 'meeting.delete', entity: 'meeting', entityId: before.id, meta: { title: before.title } })
    return c.json({ ok: true })
  })

  .post('/meetings/:id/action-items', teamOrMenu('team'), async (c) => {
    const body = z.object({ text: z.string().min(1).max(500) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const meeting = (await db.select().from(meetings).where(eq(meetings.id, c.req.param('id'))).limit(1))[0]
    if (!meeting) return c.json({ error: 'not_found' }, 404)
    if (!(await canAccessMeeting(db, meeting, me))) return c.json({ error: 'forbidden' }, 403)
    const created = (await db.insert(meetingActionItems).values({ meetingId: meeting.id, text: body.data.text }).returning())[0]!
    return c.json(created, 201)
  })

  .patch('/meetings/:id/action-items/:itemId', teamOrMenu('team'), async (c) => {
    const body = z.object({ text: z.string().min(1).max(500).optional(), done: z.boolean().optional() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const meeting = (await db.select().from(meetings).where(eq(meetings.id, c.req.param('id'))).limit(1))[0]
    if (!meeting) return c.json({ error: 'not_found' }, 404)
    if (!(await canAccessMeeting(db, meeting, me))) return c.json({ error: 'forbidden' }, 403)
    const item = (await db.select().from(meetingActionItems).where(and(eq(meetingActionItems.id, c.req.param('itemId')), eq(meetingActionItems.meetingId, meeting.id))).limit(1))[0]
    if (!item) return c.json({ error: 'not_found' }, 404)
    const updated = (await db.update(meetingActionItems).set(body.data).where(eq(meetingActionItems.id, item.id)).returning())[0]!
    return c.json(updated)
  })

  // Pronista §Meeting → Task — แปลง Action Item เป็น Task จริง (ใช้ helper เดียวกับ Message → Task)
  .post('/meetings/:id/action-items/:itemId/create-task', teamOrMenu('team'), async (c) => {
    const body = z.object({ projectId: z.string(), assigneeId: z.string().optional() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const meeting = (await db.select().from(meetings).where(eq(meetings.id, c.req.param('id'))).limit(1))[0]
    if (!meeting) return c.json({ error: 'not_found' }, 404)
    if (!(await canAccessMeeting(db, meeting, me))) return c.json({ error: 'forbidden' }, 403)
    const item = (await db.select().from(meetingActionItems).where(and(eq(meetingActionItems.id, c.req.param('itemId')), eq(meetingActionItems.meetingId, meeting.id))).limit(1))[0]
    if (!item) return c.json({ error: 'not_found' }, 404)
    const permissions = await getProjectPermissions(db, body.data.projectId, me.id, me.role)
    if (!permissions.actions.task.create) return c.json({ error: 'forbidden' }, 403)
    const created = await createQuickTask(db, { projectId: body.data.projectId, title: item.text, description: `Action item จากการประชุม "${meeting.title}"`, assigneeId: body.data.assigneeId, createdBy: me.id })
    if (!created) return c.json({ error: 'project_not_found' }, 404)
    await db.update(meetingActionItems).set({ taskId: created.id }).where(eq(meetingActionItems.id, item.id))
    await writeAudit(c.env, { actorId: me.id, action: 'task.create', entity: 'task', entityId: created.id, meta: { title: created.title, source: 'meeting_action_item', meetingId: meeting.id } })
    return c.json(created, 201)
  })
