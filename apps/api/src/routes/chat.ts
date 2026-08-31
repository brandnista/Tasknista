import { chatChannelMembers, chatChannels, chatMessageAttachments, chatMessages, createDb, notifications, projectMembers, projects, users } from '@seedoffice/db'
import { and, count, desc, eq, gt, inArray, isNull, lt, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { notifyUser } from '../lib/notify'
import { notifyChatChannel } from '../lib/presence-notify'
import { getProjectPermissions } from '../lib/project-role'
import { createQuickTask } from '../lib/quick-task'
import { teamOrMenu } from '../middleware/roles'
import type { AppEnv } from '../types'

const MAX_FILE_BYTES = 15 * 1024 * 1024 // เท่ากับ attachment ของ Task Detail

/**
 * Pronista §Team Chat (2026-08-26) — ห้อง project สร้างอัตโนมัติคู่กับโปรเจกต์ (ดู routes/projects.ts) สมาชิก = คนในโปรเจกต์นั้น (ไม่มีแถว chat_channel_members แยก)
 * ห้อง dm/group ตั้งสมาชิกเองผ่าน chat_channel_members — ใช้แถวนี้เก็บ lastReadAt ต่อคนด้วย (unread badge เอาไว้ทำต่อ)
 */
export const chatRoutes = new Hono<AppEnv>()

async function myProjectIds(db: ReturnType<typeof createDb>, me: { id: string; role: string }): Promise<string[]> {
  if (me.role === 'owner') return (await db.select({ id: projects.id }).from(projects)).map((p) => p.id)
  return (await db.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, me.id))).map((r) => r.id)
}

/** true ถ้าฉันมีสิทธิ์อ่าน/เขียนห้องนี้ */
async function canAccessChannel(db: ReturnType<typeof createDb>, channel: { kind: string; projectId: string | null; id: string }, me: { id: string; role: string }): Promise<boolean> {
  if (channel.kind === 'project') {
    if (me.role === 'owner') return true
    if (!channel.projectId) return false
    const row = (await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, channel.projectId), eq(projectMembers.userId, me.id))).limit(1))[0]
    return !!row
  }
  const row = (await db.select().from(chatChannelMembers).where(and(eq(chatChannelMembers.channelId, channel.id), eq(chatChannelMembers.userId, me.id))).limit(1))[0]
  return !!row
}

chatRoutes
  .get('/chat/channels', teamOrMenu('team'), async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const pIds = await myProjectIds(db, me)
    const projectChannels = pIds.length
      ? await db.select({ ch: chatChannels, projectName: projects.name }).from(chatChannels).innerJoin(projects, eq(chatChannels.projectId, projects.id)).where(and(eq(chatChannels.kind, 'project'), inArray(chatChannels.projectId, pIds)))
      : []
    const myMemberships = await db.select().from(chatChannelMembers).where(eq(chatChannelMembers.userId, me.id))
    const myLastReadByChannel = new Map(myMemberships.map((m) => [m.channelId, m.lastReadAt]))
    const otherChannelIds = myMemberships.map((m) => m.channelId)
    const otherChannels = otherChannelIds.length ? await db.select().from(chatChannels).where(inArray(chatChannels.id, otherChannelIds)) : []

    const all = [
      ...projectChannels.map((r) => ({ ...r.ch, projectName: r.projectName as string | null })),
      ...otherChannels.map((ch) => ({ ...ch, projectName: null as string | null })),
    ]
    const result = await Promise.all(
      all.map(async (ch) => {
        const last = (await db.select().from(chatMessages).where(and(eq(chatMessages.channelId, ch.id), isNull(chatMessages.deletedAt))).orderBy(desc(chatMessages.createdAt)).limit(1))[0]
        let displayName = ch.name
        if (!displayName && ch.kind === 'dm') {
          const other = (
            await db
              .select({ name: users.name })
              .from(chatChannelMembers)
              .innerJoin(users, eq(chatChannelMembers.userId, users.id))
              .where(and(eq(chatChannelMembers.channelId, ch.id), ne(chatChannelMembers.userId, me.id)))
              .limit(1)
          )[0]
          displayName = other?.name ?? null
        }
        // Pronista §Team Chat unread badge (2026-08-28) — นับข้อความที่ยังไม่อ่านต่อห้อง: ไม่นับข้อความตัวเอง + หลัง lastReadAt (ไม่เคยอ่านเลย = นับทุกข้อความที่มี)
        const myLastReadAt = myLastReadByChannel.get(ch.id) ?? null
        const unreadConditions = [eq(chatMessages.channelId, ch.id), isNull(chatMessages.deletedAt), ne(chatMessages.senderId, me.id)]
        if (myLastReadAt) unreadConditions.push(gt(chatMessages.createdAt, myLastReadAt))
        const unreadCount = (await db.select({ n: count() }).from(chatMessages).where(and(...unreadConditions)))[0]?.n ?? 0
        return { ...ch, displayName: displayName ?? ch.projectName ?? null, lastMessageAt: last?.createdAt ?? null, lastMessagePreview: last?.body?.slice(0, 120) ?? null, unreadCount }
      }),
    )
    return c.json(result)
  })

  // ลบห้อง dm/group ทิ้งทั้งห้อง (ข้อความ+ไฟล์แนบ+สมาชิก) — สมาชิกคนไหนก็ลบได้ ห้อง project ห้ามลบผ่านทางนี้ (ผูก 1:1 กับโปรเจกต์ ต้องลบที่โปรเจกต์)
  .delete('/chat/channels/:id', teamOrMenu('team'), async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const channel = (await db.select().from(chatChannels).where(eq(chatChannels.id, c.req.param('id'))).limit(1))[0]
    if (!channel) return c.json({ error: 'not_found' }, 404)
    if (channel.kind === 'project') return c.json({ error: 'cannot_delete_project_channel' }, 400)
    if (!(await canAccessChannel(db, channel, me))) return c.json({ error: 'forbidden' }, 403)
    await db.delete(notifications).where(eq(notifications.chatChannelId, channel.id))
    const messageIds = (await db.select({ id: chatMessages.id }).from(chatMessages).where(eq(chatMessages.channelId, channel.id))).map((r) => r.id)
    if (messageIds.length) {
      const attachments = await db.select().from(chatMessageAttachments).where(inArray(chatMessageAttachments.messageId, messageIds))
      for (const a of attachments) if (a.r2Key) await c.env.FILES.delete(a.r2Key)
      await db.delete(chatMessageAttachments).where(inArray(chatMessageAttachments.messageId, messageIds))
    }
    await db.delete(chatMessages).where(eq(chatMessages.channelId, channel.id))
    await db.delete(chatChannelMembers).where(eq(chatChannelMembers.channelId, channel.id))
    await db.delete(chatChannels).where(eq(chatChannels.id, channel.id))
    return c.json({ ok: true })
  })

  // สร้างห้อง DM (idempotent ต่อคู่ userId) หรือ group (ตั้งชื่อ+เลือกสมาชิกเอง) — ห้อง project สร้างอัตโนมัติตอนสร้างโปรเจกต์ ไม่ผ่าน endpoint นี้
  .post('/chat/channels', teamOrMenu('team'), async (c) => {
    const body = z
      .union([z.object({ kind: z.literal('dm'), userId: z.string() }), z.object({ kind: z.literal('group'), name: z.string().min(1), memberIds: z.array(z.string()).min(1) })])
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')

    if (body.data.kind === 'dm') {
      if (body.data.userId === me.id) return c.json({ error: 'cannot_dm_self' }, 400)
      const mine = await db.select({ channelId: chatChannelMembers.channelId }).from(chatChannelMembers).where(eq(chatChannelMembers.userId, me.id))
      const theirs = await db.select({ channelId: chatChannelMembers.channelId }).from(chatChannelMembers).where(eq(chatChannelMembers.userId, body.data.userId))
      const theirSet = new Set(theirs.map((r) => r.channelId))
      const sharedChannelId = mine.map((r) => r.channelId).find((id) => theirSet.has(id))
      if (sharedChannelId) {
        const existing = (await db.select().from(chatChannels).where(and(eq(chatChannels.id, sharedChannelId), eq(chatChannels.kind, 'dm'))).limit(1))[0]
        if (existing) return c.json(existing)
      }
      const created = (await db.insert(chatChannels).values({ kind: 'dm' }).returning())[0]!
      await db.insert(chatChannelMembers).values([{ channelId: created.id, userId: me.id }, { channelId: created.id, userId: body.data.userId }])
      return c.json(created, 201)
    }

    const created = (await db.insert(chatChannels).values({ kind: 'group', name: body.data.name }).returning())[0]!
    const memberIds = new Set([me.id, ...body.data.memberIds])
    await db.insert(chatChannelMembers).values([...memberIds].map((userId) => ({ channelId: created.id, userId })))
    return c.json(created, 201)
  })

  .get('/chat/channels/:id/messages', teamOrMenu('team'), async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const channel = (await db.select().from(chatChannels).where(eq(chatChannels.id, c.req.param('id'))).limit(1))[0]
    if (!channel) return c.json({ error: 'not_found' }, 404)
    if (!(await canAccessChannel(db, channel, me))) return c.json({ error: 'forbidden' }, 403)
    const before = c.req.query('before')
    const conditions = [eq(chatMessages.channelId, channel.id), isNull(chatMessages.deletedAt)]
    if (before) conditions.push(lt(chatMessages.createdAt, new Date(Number(before))))
    const rows = await db
      .select({ msg: chatMessages, senderName: users.name })
      .from(chatMessages)
      .innerJoin(users, eq(chatMessages.senderId, users.id))
      .where(and(...conditions))
      .orderBy(desc(chatMessages.createdAt))
      .limit(50)
    const messageIds = rows.map((r) => r.msg.id)
    const attachments = messageIds.length ? await db.select().from(chatMessageAttachments).where(inArray(chatMessageAttachments.messageId, messageIds)) : []
    const attachmentsByMessage = new Map<string, typeof attachments>()
    for (const a of attachments) attachmentsByMessage.set(a.messageId, [...(attachmentsByMessage.get(a.messageId) ?? []), a])
    return c.json(rows.map((r) => ({ ...r.msg, senderName: r.senderName, attachments: attachmentsByMessage.get(r.msg.id) ?? [] })).reverse())
  })

  .post('/chat/channels/:id/messages', teamOrMenu('team'), async (c) => {
    const body = z.object({ body: z.string().min(1).max(4000), mentionedUserIds: z.array(z.string()).optional() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const channel = (await db.select().from(chatChannels).where(eq(chatChannels.id, c.req.param('id'))).limit(1))[0]
    if (!channel) return c.json({ error: 'not_found' }, 404)
    if (!(await canAccessChannel(db, channel, me))) return c.json({ error: 'forbidden' }, 403)
    const created = (await db.insert(chatMessages).values({ channelId: channel.id, senderId: me.id, body: body.data.body }).returning())[0]!

    // Pronista §Team Chat mention — ไม่เชื่อ client parse ตรงๆ ต้องเป็นสมาชิกห้องนี้จริงถึง insert แจ้งเตือนให้
    const mentioned = [...new Set(body.data.mentionedUserIds ?? [])].filter((id) => id !== me.id)
    for (const userId of mentioned) {
      const isMember =
        channel.kind === 'project'
          ? me.role === 'owner' || !!(await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, channel.projectId!), eq(projectMembers.userId, userId))).limit(1))[0]
          : !!(await db.select().from(chatChannelMembers).where(and(eq(chatChannelMembers.channelId, channel.id), eq(chatChannelMembers.userId, userId))).limit(1))[0]
      if (!isMember) continue
      await notifyUser(db, { userId, type: 'chat_mention', chatChannelId: channel.id, message: `${me.name} กล่าวถึงคุณในแชท: "${body.data.body.slice(0, 80)}"` })
    }

    // Pronista §Team Chat (2026-08-27) — dm/group แจ้งเตือนสมาชิกทุกคนที่ยังไม่ถูก mention ด้านบนว่ามีข้อความใหม่ — ห้อง project ข้าม (คนเยอะ แจ้งทุกข้อความจะถี่เกินไป ดูจากห้องแชทเอาเอง)
    if (channel.kind !== 'project') {
      const members = await db.select({ userId: chatChannelMembers.userId }).from(chatChannelMembers).where(eq(chatChannelMembers.channelId, channel.id))
      const groupLabel = channel.kind === 'group' && channel.name ? ` ในกลุ่ม "${channel.name}"` : ''
      for (const { userId } of members) {
        if (userId === me.id || mentioned.includes(userId)) continue
        await notifyUser(db, { userId, type: 'chat_message', chatChannelId: channel.id, message: `${me.name} ส่งข้อความถึงคุณ${groupLabel}: "${body.data.body.slice(0, 80)}"` })
      }
    }

    await notifyChatChannel(c.env, channel.id, { type: 'chat_message', message: { ...created, senderName: me.name, attachments: [] } })
    return c.json(created, 201)
  })

  // แนบไฟล์/ลิงก์บนข้อความที่ส่งไปแล้ว — pattern เดียวกับ task-detail.ts (คู่ file/link, r2Key = chat/{channelId}/{uuid}-{filename})
  .post('/chat/messages/:id/attachments', teamOrMenu('team'), async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const msg = (await db.select().from(chatMessages).where(eq(chatMessages.id, c.req.param('id'))).limit(1))[0]
    if (!msg) return c.json({ error: 'not_found' }, 404)
    if (msg.senderId !== me.id) return c.json({ error: 'forbidden' }, 403)
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400)
    if (file.size > MAX_FILE_BYTES) return c.json({ error: 'file_too_large', message: 'ไฟล์ใหญ่เกิน 15MB' }, 400)
    const safeName = file.name.replaceAll('/', '_').slice(0, 120)
    const r2Key = `chat/${msg.channelId}/${crypto.randomUUID()}-${safeName}`
    await c.env.FILES.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } })
    const created = (await db.insert(chatMessageAttachments).values({ messageId: msg.id, r2Key, filename: safeName, mime: file.type || null, sizeBytes: file.size }).returning())[0]!
    await notifyChatChannel(c.env, msg.channelId, { type: 'chat_attachment', messageId: msg.id, attachment: created })
    return c.json(created, 201)
  })

  // โหลดไฟล์แนบในแชท — เดิม frontend ยิงไป /api/attachments/:id ซึ่งเป็น endpoint ของ Task attachment เท่านั้น หา chat attachment ไม่เจอเลย (404 ตลอด) จึงแยก path ของตัวเอง
  .get('/chat/attachments/:id', teamOrMenu('team'), async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const att = (await db.select().from(chatMessageAttachments).where(eq(chatMessageAttachments.id, c.req.param('id'))).limit(1))[0]
    if (!att || !att.r2Key) return c.json({ error: 'not_found' }, 404)
    const msg = (await db.select().from(chatMessages).where(eq(chatMessages.id, att.messageId)).limit(1))[0]
    if (!msg) return c.json({ error: 'not_found' }, 404)
    const channel = (await db.select().from(chatChannels).where(eq(chatChannels.id, msg.channelId)).limit(1))[0]
    if (!channel || !(await canAccessChannel(db, channel, me))) return c.json({ error: 'forbidden' }, 403)
    const obj = await c.env.FILES.get(att.r2Key)
    if (!obj) return c.json({ error: 'object_missing' }, 404)
    const inlineSafe = /^image\/(png|jpeg|gif|webp|avif)$/.test(att.mime ?? '')
    return new Response(obj.body, {
      headers: {
        'content-type': inlineSafe && att.mime ? att.mime : 'application/octet-stream',
        'content-disposition': `${inlineSafe ? 'inline' : 'attachment'}; filename="${encodeURIComponent(att.filename)}"`,
        'cache-control': 'private, max-age=3600',
      },
    })
  })

  .patch('/chat/messages/:id', teamOrMenu('team'), async (c) => {
    const body = z.object({ body: z.string().min(1).max(4000) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(chatMessages).where(eq(chatMessages.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    if (before.senderId !== me.id) return c.json({ error: 'forbidden' }, 403)
    const updated = (await db.update(chatMessages).set({ body: body.data.body, editedAt: new Date() }).where(eq(chatMessages.id, before.id)).returning())[0]!
    await notifyChatChannel(c.env, before.channelId, { type: 'chat_message_edited', message: { ...updated, senderName: me.name } })
    return c.json(updated)
  })

  .delete('/chat/messages/:id', teamOrMenu('team'), async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(chatMessages).where(eq(chatMessages.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    if (before.senderId !== me.id) return c.json({ error: 'forbidden' }, 403)
    await db.update(chatMessages).set({ deletedAt: new Date() }).where(eq(chatMessages.id, before.id))
    await notifyChatChannel(c.env, before.channelId, { type: 'chat_message_deleted', messageId: before.id })
    return c.json({ ok: true })
  })

  // ปักหมุด "อ่านแล้วถึงตรงนี้" ต่อคนต่อห้อง (upsert chat_channel_members — ห้อง project ไม่มีแถวสมาชิกมาก่อน สร้างให้ตอนเปิดอ่านครั้งแรก) + mark แจ้งเตือน chat_mention/chat_message ของห้องนี้เป็นอ่านแล้วทุกแบบ
  .post('/chat/channels/:id/read', teamOrMenu('team'), async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const channelId = c.req.param('id')
    const channel = (await db.select().from(chatChannels).where(eq(chatChannels.id, channelId)).limit(1))[0]
    if (!channel) return c.json({ error: 'not_found' }, 404)
    if (!(await canAccessChannel(db, channel, me))) return c.json({ error: 'forbidden' }, 403)
    await db
      .insert(chatChannelMembers)
      .values({ channelId, userId: me.id, lastReadAt: new Date() })
      .onConflictDoUpdate({ target: [chatChannelMembers.channelId, chatChannelMembers.userId], set: { lastReadAt: new Date() } })
    await db.update(notifications).set({ isRead: true }).where(and(eq(notifications.userId, me.id), eq(notifications.chatChannelId, channelId)))
    return c.json({ ok: true })
  })

  // Pronista §Message → Task — แปลงข้อความแชทเป็น Task จริง (ต้องระบุโปรเจกต์ปลายทางเสมอ แม้ข้อความจะมาจากห้อง project ก็ตาม กันแปลงผิดโปรเจกต์)
  .post('/chat/messages/:id/convert-to-task', teamOrMenu('team'), async (c) => {
    const body = z.object({ projectId: z.string(), title: z.string().min(1).optional(), assigneeId: z.string().optional() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const msg = (await db.select().from(chatMessages).where(eq(chatMessages.id, c.req.param('id'))).limit(1))[0]
    if (!msg) return c.json({ error: 'not_found' }, 404)
    const project = (await db.select().from(projects).where(eq(projects.id, body.data.projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'project_not_found' }, 404)
    // Pronista §Message → Task — ต้องมีสิทธิ์สร้าง Task ในโปรเจกต์ปลายทางจริง (เช็คเดียวกับ POST /projects/:id/tasks ปกติ กันสิทธิ์หลุดผ่านทางลัดแชท)
    const permissions = await getProjectPermissions(db, project.id, me.id, me.role)
    if (!permissions.actions.task.create) return c.json({ error: 'forbidden' }, 403)
    const created = await createQuickTask(db, { projectId: project.id, title: body.data.title ?? msg.body, description: msg.body, assigneeId: body.data.assigneeId, createdBy: me.id })
    if (!created) return c.json({ error: 'project_not_found' }, 404)
    await writeAudit(c.env, { actorId: me.id, action: 'task.create', entity: 'task', entityId: created.id, meta: { title: created.title, source: 'chat_message', messageId: msg.id } })
    return c.json(created, 201)
  })
