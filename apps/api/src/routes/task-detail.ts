import {
  auditLogs,
  createDb,
  docLinks,
  docs,
  epics,
  projects,
  sprints,
  taskAttachments,
  taskChecklistItems,
  taskComments,
  taskCustomFields,
  taskGroups,
  taskReferences,
  tasks,
  users,
} from '@seedoffice/db'
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { canEditTask, getProjectRole, isAssigneeOnlyEditor } from '../lib/project-role'
import { nextSubTaskCode } from '../lib/task-code'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15MB ต่อไฟล์

/** task detail: meta + comments + attachments + activity (จาก audit_logs) */
export const taskDetailRoutes = new Hono<AppEnv>()

  .get('/tasks/:id/detail', async (c) => {
    const db = createDb(c.env.DB)
    const taskId = c.req.param('id')
    const row = (
      await db
        .select({ task: tasks, groupName: taskGroups.name, projectName: projects.name, assigneeName: users.name })
        .from(tasks)
        // Pronista §5 (2026-07-03) — leftJoin: task ใน "Backlog ของโปรเจกต์" (groupId ยังว่าง) ต้องเปิด detail ได้ด้วย
        .leftJoin(taskGroups, eq(tasks.groupId, taskGroups.id))
        .leftJoin(projects, eq(tasks.projectId, projects.id))
        .leftJoin(users, eq(tasks.assigneeId, users.id))
        .where(eq(tasks.id, taskId))
        .limit(1)
    )[0]
    if (!row) return c.json({ error: 'not_found' }, 404)

    const comments = await db
      .select({ comment: taskComments, userName: users.name, userAvatarUrl: users.avatarUrl })
      .from(taskComments)
      .innerJoin(users, eq(taskComments.userId, users.id))
      .where(eq(taskComments.taskId, taskId))
      .orderBy(asc(taskComments.createdAt))
    const attachments = await db
      .select()
      .from(taskAttachments)
      .where(eq(taskAttachments.taskId, taskId))
      .orderBy(asc(taskAttachments.createdAt))
    const activity = await db
      .select({ log: auditLogs, actorName: users.name, actorAvatarUrl: users.avatarUrl })
      .from(auditLogs)
      .innerJoin(users, eq(auditLogs.actorId, users.id))
      .where(eq(auditLogs.entityId, taskId))
      .orderBy(desc(auditLogs.at))
      .limit(50)
    // Pronista §2.12 — งานย่อยของ task นี้ (ไม่รวมของ sub-task ตัวเอง — ไม่ทำ nested ลึกกว่า 1 ชั้น)
    const subtasks = await db
      .select({ task: tasks, assigneeName: users.name })
      .from(tasks)
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .where(eq(tasks.parentId, taskId))
      .orderBy(asc(tasks.createdAt))
    const parent = row.task.parentId
      ? (await db.select({ id: tasks.id, title: tasks.title, code: tasks.code }).from(tasks).where(eq(tasks.id, row.task.parentId)).limit(1))[0]
      : null
    // Pronista §Epic Layer — Epic ที่ task/subtask นี้สังกัด (subtask สืบ epicId จาก parent ตอนสร้างเหมือน originDocType) ใช้ทำ chip ใน breadcrumb
    const epic = row.task.epicId
      ? (await db.select({ id: epics.id, title: epics.title, code: epics.code }).from(epics).where(eq(epics.id, row.task.epicId)).limit(1))[0]
      : null
    // Pronista §Task Detail redesign — งานย่อยพี่น้องใน Task พ่อเดียวกัน (ไม่รวมตัวเอง) ใช้ทำ progress pill ในหน้าใหม่ (เฉพาะตอนมี parent เท่านั้น)
    const siblings = row.task.parentId
      ? await db
          .select({ id: tasks.id, code: tasks.code, title: tasks.title, status: tasks.status })
          .from(tasks)
          .where(and(eq(tasks.parentId, row.task.parentId), ne(tasks.id, taskId)))
      : []
    const checklist = await db
      .select()
      .from(taskChecklistItems)
      .where(eq(taskChecklistItems.taskId, taskId))
      .orderBy(asc(taskChecklistItems.sortOrder))
    const customFields = await db
      .select()
      .from(taskCustomFields)
      .where(eq(taskCustomFields.taskId, taskId))
      .orderBy(asc(taskCustomFields.sortOrder))
    // Pronista §merge (2026-07-03) — เอกสาร (ทุก kind รวมหน้าวิกิ) ที่ผูกไว้กับ task นี้
    const linkedDocuments = await db
      .select({ linkId: docLinks.id, doc: docs })
      .from(docLinks)
      .innerJoin(docs, eq(docLinks.docId, docs.id))
      .where(and(eq(docLinks.taskId, taskId), isNull(docs.deletedAt)))
      .orderBy(asc(docLinks.createdAt))

    // Pronista §permission (Jira-style project role) — สิทธิ์ของฉันในโปรเจกต์ของ task นี้ ให้ FE คุม UI โดยไม่ต้อง fetch แยก
    const me = c.get('user')
    // Pronista §permission — งาน workspace-native (projectId=null) แก้ไขได้ทุกคนอยู่แล้วตาม canEditTask ฝั่ง backend เลยให้ FE เห็นเป็น editor ตรงๆ
    const myRole = row.task.projectId ? await getProjectRole(db, row.task.projectId, me.id, me.role) : 'editor'

    // Pronista §time-tracking — จับเวลาได้เฉพาะ task ที่อยู่ใน sprint ที่ "เริ่ม" แล้วจริงๆ (status active) — Backlog/sprint ที่ยังไม่เริ่มยังไม่ถูก assign งานจริง
    const sprintActive = row.task.sprintId
      ? (await db.select({ status: sprints.status }).from(sprints).where(eq(sprints.id, row.task.sprintId)).limit(1))[0]?.status === 'active'
      : false

    return c.json({
      sprintActive,
      ...row.task,
      groupName: row.groupName,
      projectName: row.projectName,
      assigneeName: row.assigneeName,
      myRole,
      parent,
      epic,
      siblings,
      subtasks: subtasks.map((x) => ({ ...x.task, assigneeName: x.assigneeName })),
      checklist,
      customFields,
      comments: comments.map((x) => ({ ...x.comment, userName: x.userName, userAvatarUrl: x.userAvatarUrl })),
      attachments,
      linkedDocuments: linkedDocuments.map((x) => ({ linkId: x.linkId, ...x.doc })),
      activity: activity.map((x) => ({
        id: x.log.id,
        action: x.log.action,
        actorName: x.actorName,
        actorAvatarUrl: x.actorAvatarUrl,
        meta: x.log.meta,
        at: x.log.at,
      })),
    })
  })

  // Pronista §2.12 — เพิ่มงานย่อยตรงจากหน้า Task Detail (สืบ project/group จาก parent, code = <parentCode>.N)
  .post('/tasks/:id/subtasks', teamOnly, async (c) => {
    // Pronista §Sprint & Board fix — ตั้งรหัสงานย่อยเองได้ตอนสร้าง (ไม่บังคับ) — เว้นว่างยังออกเลขอัตโนมัติเหมือนเดิม
    const body = z.object({ title: z.string().min(1), code: z.string().trim().max(40).optional() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const parent = (await db.select().from(tasks).where(eq(tasks.id, c.req.param('id'))).limit(1))[0]
    if (!parent) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    if (!(await canEditTask(db, parent, me))) return c.json({ error: 'forbidden' }, 403)
    const code = body.data.code || (await nextSubTaskCode(db, parent.id, parent.code ?? 'TASK'))
    const created = await db
      .insert(tasks)
      .values({
        projectId: parent.projectId,
        groupId: parent.groupId,
        parentId: parent.id,
        sortOrder: 0,
        createdBy: me.id,
        code,
        title: body.data.title,
        // Pronista §SOW Task/Subtask — สืบ originDocType/originDocId จาก parent เสมอ ไม่งั้น subtask ที่เพิ่มเองใต้ Task SOW (เช่นตอน auto-parse ไม่เจออะไรเลย) จะติด guard sprint ใหม่ ลาก sprint ไม่ได้ตลอดกาล
        originDocType: parent.originDocType,
        originDocId: parent.originDocId,
      })
      .returning()
    await writeAudit(c.env, { actorId: me.id, action: 'task.create', entity: 'task', entityId: created[0]!.id, meta: { title: created[0]!.title, parentId: parent.id } })
    return c.json(created[0], 201)
  })

  // Pronista §2.12 — custom field ยืดหยุ่น (label/value เอง หลายอันได้)
  .post('/tasks/:id/custom-fields', teamOnly, async (c) => {
    const body = z.object({ label: z.string().min(1).max(60), value: z.string().min(1).max(500) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const task = (await db.select().from(tasks).where(eq(tasks.id, c.req.param('id'))).limit(1))[0]
    if (!task) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    if (!(await canEditTask(db, task, me))) return c.json({ error: 'forbidden' }, 403)
    const siblings = await db.select().from(taskCustomFields).where(eq(taskCustomFields.taskId, task.id))
    const inserted = await db
      .insert(taskCustomFields)
      .values({ taskId: task.id, label: body.data.label, value: body.data.value, sortOrder: siblings.length })
      .returning()
    return c.json(inserted[0], 201)
  })

  .patch('/custom-fields/:id', teamOnly, async (c) => {
    const body = z.object({ label: z.string().min(1).max(60).optional(), value: z.string().min(1).max(500).optional() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const field = (await db.select().from(taskCustomFields).where(eq(taskCustomFields.id, c.req.param('id'))).limit(1))[0]
    if (!field) return c.json({ error: 'not_found' }, 404)
    const task = (await db.select().from(tasks).where(eq(tasks.id, field.taskId)).limit(1))[0]
    const me = c.get('user')
    if (task && !(await canEditTask(db, task, me))) return c.json({ error: 'forbidden' }, 403)
    const updated = await db.update(taskCustomFields).set(body.data).where(eq(taskCustomFields.id, field.id)).returning()
    return c.json(updated[0])
  })

  .delete('/custom-fields/:id', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const field = (await db.select().from(taskCustomFields).where(eq(taskCustomFields.id, c.req.param('id'))).limit(1))[0]
    if (!field) return c.json({ error: 'not_found' }, 404)
    const task = (await db.select().from(tasks).where(eq(tasks.id, field.taskId)).limit(1))[0]
    const me = c.get('user')
    if (task && !(await canEditTask(db, task, me))) return c.json({ error: 'forbidden' }, 403)
    await db.delete(taskCustomFields).where(eq(taskCustomFields.id, field.id))
    return c.json({ ok: true })
  })

  // Pronista §Task Detail redesign — เกณฑ์ว่าเสร็จ (Acceptance Criteria) ต่อ task หนึ่ง เพิ่ม/ติ๊ก/ลบทีละข้อ
  .post('/tasks/:id/checklist', teamOnly, async (c) => {
    const body = z.object({ text: z.string().min(1).max(300) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const task = (await db.select().from(tasks).where(eq(tasks.id, c.req.param('id'))).limit(1))[0]
    if (!task) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    if (!(await canEditTask(db, task, me))) return c.json({ error: 'forbidden' }, 403)
    // Pronista §Back to Basic (ต่อยอด) — assignee ติ๊กเกณฑ์ว่าเสร็จได้ (PATCH) แต่เพิ่มเกณฑ์ใหม่เองไม่ได้ (เป็นของผู้จ่ายงาน)
    if (await isAssigneeOnlyEditor(db, task, me)) return c.json({ error: 'forbidden' }, 403)
    const siblings = await db.select().from(taskChecklistItems).where(eq(taskChecklistItems.taskId, task.id))
    const inserted = await db
      .insert(taskChecklistItems)
      .values({ taskId: task.id, text: body.data.text, sortOrder: siblings.length })
      .returning()
    return c.json(inserted[0], 201)
  })

  .patch('/checklist/:id', teamOnly, async (c) => {
    const body = z.object({ text: z.string().min(1).max(300).optional(), done: z.boolean().optional() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const item = (await db.select().from(taskChecklistItems).where(eq(taskChecklistItems.id, c.req.param('id'))).limit(1))[0]
    if (!item) return c.json({ error: 'not_found' }, 404)
    const task = (await db.select().from(tasks).where(eq(tasks.id, item.taskId)).limit(1))[0]
    const me = c.get('user')
    if (task && !(await canEditTask(db, task, me))) return c.json({ error: 'forbidden' }, 403)
    // Pronista §Back to Basic (ต่อยอด) — assignee ติ๊ก done ได้อย่างเดียว แก้ข้อความเกณฑ์เองไม่ได้ (เป็นของผู้จ่ายงาน)
    if (task && 'text' in body.data && (await isAssigneeOnlyEditor(db, task, me))) return c.json({ error: 'forbidden' }, 403)
    const updated = await db.update(taskChecklistItems).set(body.data).where(eq(taskChecklistItems.id, item.id)).returning()
    // Pronista §Daily Report — บันทึกไว้ให้ดึงเป็นสัญญาณ "มีการทำ Checklist วันนี้" ได้ (เดิมไม่มี audit จุดนี้)
    if (task && 'done' in body.data && body.data.done !== item.done) {
      await writeAudit(c.env, { actorId: me.id, action: 'task.checklist', entity: 'task', entityId: task.id, meta: { checklistItemId: item.id, done: body.data.done } })
    }
    return c.json(updated[0])
  })

  .delete('/checklist/:id', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const item = (await db.select().from(taskChecklistItems).where(eq(taskChecklistItems.id, c.req.param('id'))).limit(1))[0]
    if (!item) return c.json({ error: 'not_found' }, 404)
    const task = (await db.select().from(tasks).where(eq(tasks.id, item.taskId)).limit(1))[0]
    const me = c.get('user')
    if (task && !(await canEditTask(db, task, me))) return c.json({ error: 'forbidden' }, 403)
    if (task && (await isAssigneeOnlyEditor(db, task, me))) return c.json({ error: 'forbidden' }, 403)
    await db.delete(taskChecklistItems).where(eq(taskChecklistItems.id, item.id))
    return c.json({ ok: true })
  })

  // comment — เปิดให้ vendor ด้วย (ต้องสื่อสารบนงานที่ตัวเองลงเวลา) · จดเป็น interpretation ไว้ใน SPEC
  .post('/tasks/:id/comments', async (c) => {
    // Pronista §Task Detail redesign — isBlocked ทำเครื่องหมายคอมเมนต์นี้เป็นการแจ้ง "ติดขัด" (โชว์แท็กแดงในฟีดรวมของหน้าใหม่)
    const body = z.object({ body: z.string().min(1).max(4000), isBlocked: z.boolean().optional() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const task = (await db.select().from(tasks).where(eq(tasks.id, c.req.param('id'))).limit(1))[0]
    if (!task) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    const inserted = await db
      .insert(taskComments)
      .values({ taskId: task.id, userId: me.id, body: body.data.body, isBlocked: body.data.isBlocked ?? false })
      .returning()
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'task.comment',
      entity: 'task',
      entityId: task.id,
      meta: { preview: body.data.body.slice(0, 80) },
    })
    return c.json({ ...inserted[0], userName: me.name }, 201)
  })

  // อัปโหลดไฟล์ → R2 (multipart) — owner+member
  .post('/tasks/:id/attachments', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const task = (await db.select().from(tasks).where(eq(tasks.id, c.req.param('id'))).limit(1))[0]
    if (!task) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    if (!(await canEditTask(db, task, me))) return c.json({ error: 'forbidden' }, 403)
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400)
    if (file.size === 0 || file.size > MAX_FILE_BYTES) return c.json({ error: 'file_too_large' }, 413)

    const safeName = file.name.replaceAll('/', '_').slice(0, 120)
    const r2Key = `tasks/${task.id}/${crypto.randomUUID()}-${safeName}`
    await c.env.FILES.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    })
    const inserted = await db
      .insert(taskAttachments)
      .values({
        taskId: task.id,
        r2Key,
        filename: safeName,
        mime: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        uploadedBy: me.id,
      })
      .returning()
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'task.attach',
      entity: 'task',
      entityId: task.id,
      meta: { filename: safeName },
    })
    return c.json(inserted[0], 201)
  })

  // แนบลิงก์ภายนอก (Google Docs/Figma/Canva/อื่นๆ) — auto-detect ประเภทจาก hostname ไม่ต้องให้เลือกเอง
  .post('/tasks/:id/attachment-links', teamOnly, async (c) => {
    const body = z.object({ url: z.string().url().max(2000), label: z.string().max(200).optional() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const task = (await db.select().from(tasks).where(eq(tasks.id, c.req.param('id'))).limit(1))[0]
    if (!task) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    if (!(await canEditTask(db, task, me))) return c.json({ error: 'forbidden' }, 403)

    const host = new URL(body.data.url).hostname.replace(/^www\./, '')
    const linkType = host === 'docs.google.com' || host === 'drive.google.com' ? 'google_docs' : host === 'figma.com' ? 'figma' : host === 'canva.com' ? 'canva' : 'other'
    const inserted = await db
      .insert(taskAttachments)
      .values({
        taskId: task.id,
        filename: body.data.label?.trim() || body.data.url,
        externalUrl: body.data.url,
        linkType,
        uploadedBy: me.id,
      })
      .returning()
    await writeAudit(c.env, { actorId: me.id, action: 'task.attach', entity: 'task', entityId: task.id, meta: { url: body.data.url, linkType } })
    return c.json(inserted[0], 201)
  })

  // โหลดไฟล์ (auth แล้วทุก role) — รูป inline, อื่นๆ (รวม SVG กัน XSS) บังคับดาวน์โหลด
  .get('/attachments/:id', async (c) => {
    const db = createDb(c.env.DB)
    const att = (
      await db.select().from(taskAttachments).where(eq(taskAttachments.id, c.req.param('id'))).limit(1)
    )[0]
    if (!att || !att.r2Key) return c.json({ error: 'not_found' }, 404)
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

  // เปลี่ยนชื่อไฟล์แนบ (rename) — สิทธิ์เดียวกับลบ (อัปโหลดเอง/owner/editor ของโปรเจกต์)
  .patch('/attachments/:id', teamOnly, async (c) => {
    const body = z.object({ filename: z.string().min(1).max(200) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const att = (
      await db.select().from(taskAttachments).where(eq(taskAttachments.id, c.req.param('id'))).limit(1)
    )[0]
    if (!att) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    if (me.role !== 'owner' && att.uploadedBy !== me.id) {
      const task = (await db.select().from(tasks).where(eq(tasks.id, att.taskId)).limit(1))[0]
      if (!task || !(await canEditTask(db, task, me))) return c.json({ error: 'forbidden' }, 403)
    }
    const updated = await db
      .update(taskAttachments)
      .set({ filename: body.data.filename.trim() })
      .where(eq(taskAttachments.id, att.id))
      .returning()
    return c.json(updated[0])
  })

  .delete('/attachments/:id', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const att = (
      await db.select().from(taskAttachments).where(eq(taskAttachments.id, c.req.param('id'))).limit(1)
    )[0]
    if (!att) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    if (me.role !== 'owner' && att.uploadedBy !== me.id) {
      // Pronista §permission (Jira-style project role) — editor ของโปรเจกต์ลบไฟล์แนบของคนอื่นได้ด้วย (แทนที่กฎเดิม "อัปโหลดเอง/owner เท่านั้น") · assignee ของ task นี้ก็ลบได้เช่นกัน
      const task = (await db.select().from(tasks).where(eq(tasks.id, att.taskId)).limit(1))[0]
      if (!task || !(await canEditTask(db, task, me))) return c.json({ error: 'forbidden' }, 403)
    }
    if (att.r2Key) await c.env.FILES.delete(att.r2Key)
    await db.delete(taskAttachments).where(eq(taskAttachments.id, att.id))
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'task.attach_delete',
      entity: 'task',
      entityId: att.taskId,
      meta: { filename: att.filename },
    })
    return c.json({ ok: true })
  })

  // Pronista §Document Traceability — ไล่ chain ของ task นี้ทั้งขึ้น (upstream = อ้างอิงถึงเล่มก่อนหน้า) และลง (downstream = ถูกเล่มถัดไปอ้างอิงถึง) ผ่าน task_references
  // เดินทีละชั้น (BFS) กันวน + จำกัดความลึก 10 ชั้น (สายเอกสารจริงมีแค่ 4 เล่ม ไม่มีทางลึกขนาดนั้น)
  .get('/tasks/:id/trace', async (c) => {
    const db = createDb(c.env.DB)
    const taskId = c.req.param('id')
    const traceFields = {
      id: tasks.id,
      code: tasks.code,
      title: tasks.title,
      projectId: tasks.projectId,
      originDocType: tasks.originDocType,
      originCode: tasks.originCode,
      originRefCode: tasks.originRefCode,
      originDocId: tasks.originDocId,
    }
    type TraceRow = {
      id: string
      code: string | null
      title: string
      projectId: string | null
      originDocType: string | null
      originCode: string | null
      originRefCode: string | null
      originDocId: string | null
    }
    const walk = async (direction: 'upstream' | 'downstream') => {
      const visited = new Set<string>([taskId])
      const out: TraceRow[] = []
      let frontier = [taskId]
      for (let depth = 0; depth < 10 && frontier.length > 0; depth++) {
        const refs = await db
          .select({ taskId: taskReferences.taskId, referencesTaskId: taskReferences.referencesTaskId })
          .from(taskReferences)
          .where(direction === 'upstream' ? inArray(taskReferences.taskId, frontier) : inArray(taskReferences.referencesTaskId, frontier))
        const nextIds = [...new Set(refs.map((r) => (direction === 'upstream' ? r.referencesTaskId : r.taskId)))].filter((id) => !visited.has(id))
        if (nextIds.length === 0) break
        for (const id of nextIds) visited.add(id)
        const rows = await db.select(traceFields).from(tasks).where(inArray(tasks.id, nextIds))
        out.push(...rows)
        frontier = nextIds
      }
      return out
    }
    const [upstream, downstream] = await Promise.all([walk('upstream'), walk('downstream')])
    return c.json({ upstream, downstream })
  })

  // Pronista §Project Refactor — เชื่อมโยง EPIC/Story/Task/CR อิสระ (ต่างจาก /trace ที่เดิน BFS หลายชั้นเฉพาะสาย doc) — โชว์แค่ลิงก์ตรง (depth 1) ทั้ง 2 ทิศ
  .get('/tasks/:id/references', async (c) => {
    const db = createDb(c.env.DB)
    const taskId = c.req.param('id')
    const fields = { id: tasks.id, code: tasks.code, title: tasks.title, kind: tasks.kind }
    const outgoing = await db
      .select({ refId: taskReferences.id, ...fields })
      .from(taskReferences)
      .innerJoin(tasks, eq(tasks.id, taskReferences.referencesTaskId))
      .where(eq(taskReferences.taskId, taskId))
    const incoming = await db
      .select({ refId: taskReferences.id, ...fields })
      .from(taskReferences)
      .innerJoin(tasks, eq(tasks.id, taskReferences.taskId))
      .where(eq(taskReferences.referencesTaskId, taskId))
    return c.json([
      ...outgoing.map((r) => ({ ...r, direction: 'outgoing' as const })),
      ...incoming.map((r) => ({ ...r, direction: 'incoming' as const })),
    ])
  })

  .post('/tasks/:id/references', teamOnly, async (c) => {
    const body = z.object({ referencesTaskId: z.string() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const taskId = c.req.param('id')
    if (taskId === body.data.referencesTaskId) return c.json({ error: 'self_reference' }, 400)
    const before = (await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const target = (await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, body.data.referencesTaskId)).limit(1))[0]
    if (!target) return c.json({ error: 'target_not_found' }, 404)
    const me = c.get('user')
    if (!(await canEditTask(db, before, me))) return c.json({ error: 'forbidden' }, 403)
    const inserted = await db
      .insert(taskReferences)
      .values({ taskId, referencesTaskId: body.data.referencesTaskId })
      .onConflictDoNothing()
      .returning()
    return c.json(inserted[0] ?? { ok: true }, 201)
  })

  .delete('/task-references/:refId', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const row = (await db.select().from(taskReferences).where(eq(taskReferences.id, c.req.param('refId'))).limit(1))[0]
    if (!row) return c.json({ error: 'not_found' }, 404)
    const owningTask = (await db.select().from(tasks).where(eq(tasks.id, row.taskId)).limit(1))[0]
    const me = c.get('user')
    if (owningTask && !(await canEditTask(db, owningTask, me))) return c.json({ error: 'forbidden' }, 403)
    await db.delete(taskReferences).where(eq(taskReferences.id, row.id))
    return c.json({ ok: true })
  })
