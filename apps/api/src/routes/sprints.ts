import { bkkDateOf, columnsOf, firstColumnId, presetById, resolvePresets } from '@seedoffice/core'
import { companyConfig, createDb, epics, projects, sprintTaskSnapshots, sprints, tasks, users } from '@seedoffice/db'
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { canEditProject, getProjectRole } from '../lib/project-role'
import { completeSprint } from '../lib/sprint'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

async function loadPreset(db: ReturnType<typeof createDb>, boardPresetId: string | null) {
  if (!boardPresetId) return undefined
  const cfg = (await db.select({ boardPresets: companyConfig.boardPresets }).from(companyConfig).limit(1))[0]
  return presetById(resolvePresets(cfg?.boardPresets), boardPresetId)
}

// Pronista §Sprint & Board fix — ให้ frontend จัดกลุ่ม/ยุบการ์ด subtask ตาม parent ได้ (Task View / Mixed View) โดยไม่ต้อง query เพิ่มฝั่ง client
async function loadParents(db: ReturnType<typeof createDb>, rowTasks: (typeof tasks.$inferSelect)[]) {
  const parentIds = [...new Set(rowTasks.map((t) => t.parentId).filter((id): id is string => id !== null))]
  if (parentIds.length === 0) return []
  return db.select({ id: tasks.id, code: tasks.code, title: tasks.title }).from(tasks).where(inArray(tasks.id, parentIds))
}

// Pronista §Epic Layer — ให้ frontend วาด swimlane ต่อ Epic บน Sprint Timeline โดยไม่ต้อง query เพิ่มฝั่ง client
async function loadEpics(db: ReturnType<typeof createDb>, rowTasks: (typeof tasks.$inferSelect)[]) {
  const epicIds = [...new Set(rowTasks.map((t) => t.epicId).filter((id): id is string => id !== null))]
  if (epicIds.length === 0) return []
  return db.select({ id: epics.id, title: epics.title, code: epics.code }).from(epics).where(inArray(epics.id, epicIds))
}

// Pronista §Back to Basic (ต่อยอด) — ข้อมูล Board ของ sprint เดียว (ใช้ทั้งใน /sprints/current ที่คืนทุก sprint พร้อมกัน และ /sprints/:id/board ของหน้า Board แยกต่อ sprint)
async function loadSprintBoard(db: ReturnType<typeof createDb>, sprint: typeof sprints.$inferSelect) {
  const preset = await loadPreset(db, sprint.boardPresetId)
  const rows = await db
    .select({ task: tasks, assigneeName: users.name, assigneeAvatarUrl: users.avatarUrl })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.sprintId, sprint.id))
    .orderBy(asc(tasks.sortOrder))
  // Pronista §Sprint queueing — งานย่อยขั้นที่ 3 (ลูกของ Task ที่อยู่ใน Sprint นี้) ไม่ได้เข้า Sprint เอง แต่โชว์ให้เห็นบริบทได้ (กดขยายดู)
  const taskIds = rows.map((r) => r.task.id)
  const grandchildRows =
    taskIds.length > 0
      ? await db
          .select({ task: tasks, assigneeName: users.name })
          .from(tasks)
          .leftJoin(users, eq(tasks.assigneeId, users.id))
          .where(inArray(tasks.parentId, taskIds))
      : []
  return {
    sprint,
    preset: preset ?? null,
    tasks: rows.map((r) => ({ ...r.task, assigneeName: r.assigneeName, assigneeAvatarUrl: r.assigneeAvatarUrl })),
    subtasks: grandchildRows.map((r) => ({ ...r.task, assigneeName: r.assigneeName })),
    parents: await loadParents(db, rows.map((r) => r.task)),
    epics: await loadEpics(db, rows.map((r) => r.task)),
  }
}

/** Sprint & Board (Pronista §Sprint & Board) — vendor อ่านได้ แก้ไม่ได้ (teamOnly เฉพาะ mutation, เหมือน taskRoutes) */
export const sprintRoutes = new Hono<AppEnv>()

  // ประวัติ sprint ทั้งหมดของโปรเจกต์ (ใหม่→เก่า) — ใช้ทำหน้า log + เลือกดู report ย้อนหลัง
  .get('/projects/:id/sprints', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const rows = await db.select().from(sprints).where(eq(sprints.projectId, projectId)).orderBy(desc(sprints.createdAt))
    // sprint ที่ยังไม่ completed นับ live จาก tasks ปัจจุบัน · completed แล้วใช้ snapshot ที่ปิดไว้ (นับใหม่จาก tasks ไม่ได้ต่อ)
    const liveCounts = await db.select({ id: tasks.id, sprintId: tasks.sprintId, sprintStatus: tasks.sprintStatus }).from(tasks).where(eq(tasks.projectId, projectId))
    return c.json(
      await Promise.all(
        rows.map(async (s) => {
          if (s.status === 'completed') return { ...s, doneCount: s.doneCount ?? 0, notDoneCount: s.notDoneCount ?? 0 }
          const preset = await loadPreset(db, s.boardPresetId)
          const cols = preset ? columnsOf(preset) : []
          const doneColId = cols[cols.length - 1]?.id
          const mine = liveCounts.filter((t) => t.sprintId === s.id)
          const done = mine.filter((t) => t.sprintStatus === doneColId).length
          return { ...s, doneCount: done, notDoneCount: mine.length - done }
        }),
      ),
    )
  })

  // Pronista §Back to Basic — เดิม endpoint นี้คืนแค่ sprint เดียว ("current" = active ก่อนเสมอ ไม่งั้น planned เก่าสุด) พร้อม tasks ของตัวเอง
  // ส่วนที่เหลือ (queued) ได้แค่ข้อมูล sprint เปล่าๆ ไม่มี tasks — ทำให้ลากงานเข้า queued sprint ไม่ได้เลยตั้งแต่ต้น (บั๊กที่พบจากข้อมูลจริง: sprint ที่ start ไปแล้วมี 0/0 งานเสมอ)
  // แก้โดยคืนทุก open sprint (active มาก่อนเสมอ ที่เหลือเรียงตาม createdAt) พร้อม tasks/subtasks/parents/epics ของตัวเองครบทุกอัน ให้ frontend render เป็นการ์ด dropzone เดียวกันหมด
  .get('/projects/:id/sprints/current', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const open = await db
      .select()
      .from(sprints)
      .where(and(eq(sprints.projectId, projectId), ne(sprints.status, 'completed')))
      .orderBy(asc(sprints.createdAt))
    const ordered = [...open.filter((s) => s.status === 'active'), ...open.filter((s) => s.status !== 'active')]
    const items = await Promise.all(ordered.map((sprint) => loadSprintBoard(db, sprint)))
    // Pronista §Back to Basic — คง sprint/preset/tasks/subtasks/parents/epics เดิมไว้ที่ระดับบนสุด (ชี้ไปที่ตัวแรกใน items เสมอ = active ถ้ามี) เพื่อไม่ให้ Board.tsx ที่ยังอ่านชื่อฟิลด์เดิมพังไป — เพิ่ม items ใหม่ให้ SprintSection ใช้ render ทุก sprint แยกกัน
    const first = items[0]
    return c.json({
      sprints: items,
      sprint: first?.sprint ?? null,
      preset: first?.preset ?? null,
      tasks: first?.tasks ?? [],
      subtasks: first?.subtasks ?? [],
      parents: first?.parents ?? [],
      epics: first?.epics ?? [],
      queued: items.slice(1).map((it) => it.sprint),
    })
  })

  // Pronista §Project Refactor — กลับลำดับสร้าง Sprint: กด "+ Sprint" สร้าง container ว่างทันที ไม่ต้องกรอกอะไรก่อน (วันที่ default ไปพลางๆ ยังไม่มีความหมายจนกว่าจะกด "เริ่ม Sprint")
  // ลากงานเข้าได้เลย (เข้าคิวเป็น 'planned') · เลือก Preset + ชื่อ/วันที่จริง/เป้าหมาย ทีหลังตอนกด "เริ่ม Sprint"
  .post('/projects/:id/sprints', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    const role = await getProjectRole(db, projectId, me.id, me.role)
    if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)

    const now = Date.now()
    const created = (
      await db
        .insert(sprints)
        .values({ projectId, name: null, startDate: bkkDateOf(now), endDate: bkkDateOf(now + 7 * 86_400_000), boardPresetId: null, createdBy: me.id })
        .returning()
    )[0]
    if (!created) return c.json({ error: 'insert_failed' }, 500)
    await writeAudit(c.env, { actorId: me.id, action: 'sprint.create', entity: 'sprint', entityId: created.id, meta: { projectId } })
    return c.json(created, 201)
  })

  // แก้ไข sprint — เฉพาะตอนยังไม่ Start (planned) กันคอลัมน์/กำหนดเวลาเปลี่ยนกลางคันหลัง task ขึ้นบอร์ดแล้ว
  .patch('/sprints/:id', teamOnly, async (c) => {
    const body = z
      .object({
        name: z.string().trim().max(60).nullable().optional(),
        startDate: isoDate.optional(),
        endDate: isoDate.optional(),
        goal: z.string().trim().max(300).nullable().optional(),
        boardPresetId: z.string().optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const before = (await db.select().from(sprints).where(eq(sprints.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    const role = await getProjectRole(db, before.projectId, me.id, me.role)
    if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)
    if (before.status !== 'planned') return c.json({ error: 'sprint_started', message: 'แก้ไขได้เฉพาะก่อน Start Sprint' }, 409)

    if (body.data.boardPresetId) {
      const preset = await loadPreset(db, body.data.boardPresetId)
      if (!preset) return c.json({ error: 'invalid_preset' }, 400)
    }
    const startDate = body.data.startDate ?? before.startDate
    const endDate = body.data.endDate ?? before.endDate
    if (endDate < startDate) return c.json({ error: 'invalid_range', message: 'วันจบต้องไม่ก่อนวันเริ่ม' }, 400)

    const updated = await db
      .update(sprints)
      .set({ ...body.data, name: body.data.name === undefined ? undefined : body.data.name || null })
      .where(eq(sprints.id, before.id))
      .returning()
    return c.json(updated[0])
  })

  // เริ่ม sprint (planned → active) — เลือก Preset ตรงนี้ (Pronista §Sprint & Board แก้ไข flow) แล้วจัดทุก task ที่ลากเข้ามาไว้ก่อนหน้าลงคอลัมน์แรกของบอร์ดพร้อมกัน
  .post('/sprints/:id/start', teamOnly, async (c) => {
    const body = z
      .object({
        boardPresetId: z.string(),
        name: z.string().trim().max(60).optional(),
        startDate: isoDate,
        endDate: isoDate,
        goal: z.string().trim().max(300).optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    if (body.data.endDate < body.data.startDate) return c.json({ error: 'invalid_range', message: 'วันจบต้องไม่ก่อนวันเริ่ม' }, 400)
    const db = createDb(c.env.DB)
    const before = (await db.select().from(sprints).where(eq(sprints.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    const role = await getProjectRole(db, before.projectId, me.id, me.role)
    if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)
    if (before.status !== 'planned') return c.json({ error: 'invalid_state' }, 409)
    // Pronista §Back to Basic (ต่อยอด) — เดิมจำกัด active พร้อมกันได้แค่ 1 อันต่อโปรเจกต์ พี่แจ้งว่าอยากให้ Start พร้อมกันได้หลายอัน (แต่ละอันแยก Board ของตัวเอง — ดู GET /sprints/:id/board) จึงเอาเช็คนี้ออก
    const preset = await loadPreset(db, body.data.boardPresetId)
    if (!preset) return c.json({ error: 'invalid_preset' }, 400)

    const updated = await db
      .update(sprints)
      .set({
        status: 'active',
        startedAt: new Date(),
        boardPresetId: body.data.boardPresetId,
        name: body.data.name || null,
        startDate: body.data.startDate,
        endDate: body.data.endDate,
        goal: body.data.goal || null,
      })
      .where(eq(sprints.id, before.id))
      .returning()
    // task ที่ลากเข้า sprint ไว้ตอน planned ยังไม่มีคอลัมน์ (sprintStatus ว่าง) — พอเลือก preset แล้วจัดลงคอลัมน์แรกทีเดียว
    await db
      .update(tasks)
      .set({ sprintStatus: firstColumnId(preset) })
      .where(and(eq(tasks.sprintId, before.id), isNull(tasks.sprintStatus)))
    await writeAudit(c.env, { actorId: me.id, action: 'sprint.start', entity: 'sprint', entityId: before.id, meta: { boardPresetId: body.data.boardPresetId } })
    return c.json(updated[0])
  })

  // Pronista §Back to Basic (ต่อยอด) — หน้า Board แยกต่อ sprint (หลาย sprint active พร้อมกันได้ ต้องระบุว่าดู sprint ไหน)
  .get('/sprints/:id/board', async (c) => {
    const db = createDb(c.env.DB)
    const sprint = (await db.select().from(sprints).where(eq(sprints.id, c.req.param('id'))).limit(1))[0]
    if (!sprint) return c.json({ error: 'not_found' }, 404)
    return c.json(await loadSprintBoard(db, sprint))
  })

  // ปิด sprint เอง (ก่อนครบกำหนด) — งานไม่ Done เด้งกลับ backlog · ปกติจะปิดอัตโนมัติตอนครบกำหนด (scheduled.ts)
  .post('/sprints/:id/complete', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const before = (await db.select().from(sprints).where(eq(sprints.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    const role = await getProjectRole(db, before.projectId, me.id, me.role)
    if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)
    if (before.status === 'completed') return c.json({ error: 'already_completed' }, 409)
    await completeSprint(db, before.id)
    await writeAudit(c.env, { actorId: me.id, action: 'sprint.complete', entity: 'sprint', entityId: before.id, meta: { manual: true } })
    const after = (await db.select().from(sprints).where(eq(sprints.id, before.id)).limit(1))[0]
    return c.json(after)
  })

  // ลาก task จาก Backlog ของโปรเจกต์เข้า sprint — เฉพาะตอนยังไม่ Start (planned) เท่านั้น (Pronista §Sprint & Board แก้ไข flow)
  // ยังไม่รู้คอลัมน์บอร์ด (เลือก preset ตอน start) — ตั้ง sprintStatus ว่างไว้ก่อน, ตอน start ค่อยจัดลงคอลัมน์แรกทีเดียว
  .post('/sprints/:id/tasks', teamOnly, async (c) => {
    const body = z.object({ taskId: z.string() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const sprint = (await db.select().from(sprints).where(eq(sprints.id, c.req.param('id'))).limit(1))[0]
    if (!sprint) return c.json({ error: 'not_found' }, 404)
    if (sprint.status !== 'planned') return c.json({ error: 'sprint_not_planned', message: 'เพิ่มงานเข้า Sprint ได้เฉพาะตอนยังไม่ Start' }, 409)
    const me = c.get('user')
    const role = await getProjectRole(db, sprint.projectId, me.id, me.role)
    if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)

    const task = (await db.select().from(tasks).where(eq(tasks.id, body.data.taskId)).limit(1))[0]
    if (!task) return c.json({ error: 'task_not_found' }, 404)
    if (task.projectId !== sprint.projectId) return c.json({ error: 'not_in_backlog', message: 'ต้องเป็นงานใน Backlog ของโปรเจกต์นี้เท่านั้น' }, 400)

    // Pronista §Sprint & Board fix — ลาก Task พ่อของ SOW เข้า Sprint = ดึง subtask ทั้งหมดที่ยังอยู่ Backlog เข้าไปแทน (Task พ่อเองไม่เข้า sprint — ยังคงกฎเดิมที่ Task พ่อ SOW ลาก sprint โดยตรงไม่ได้)
    const isSowParent = task.originDocType === 'SOW' && task.parentId === null
    if (isSowParent) {
      const children = await db
        .update(tasks)
        .set({ sprintId: sprint.id, sprintStatus: null })
        .where(and(eq(tasks.parentId, task.id), isNull(tasks.groupId), isNull(tasks.sprintId)))
        .returning()
      if (children.length === 0)
        return c.json({ error: 'no_subtasks_available', message: 'Task นี้ไม่มี Subtask เหลือใน Backlog ให้ลากเข้า Sprint แล้ว' }, 400)
      return c.json({ added: children })
    }

    // Task อื่นทั้งหมด (ไม่มีต้นทาง/ต้นทางอื่น) ทำงานเหมือนเดิมทุกประการ — subtask ทั่วไป (ไม่ใช่ SOW) ยังลาก sprint ไม่ได้เหมือนเดิม (ของเดิม)
    const genericSubtaskBlocked = task.originDocType !== 'SOW' && task.parentId !== null
    if (task.groupId !== null || task.sprintId !== null || genericSubtaskBlocked)
      return c.json({ error: 'not_in_backlog', message: 'ต้องเป็นงานใน Backlog ของโปรเจกต์นี้เท่านั้น' }, 400)

    const updated = await db
      .update(tasks)
      .set({ sprintId: sprint.id, sprintStatus: null })
      .where(eq(tasks.id, task.id))
      .returning()
    return c.json({ added: updated })
  })

  // เอา task ออกจาก sprint กลับไป Backlog ของโปรเจกต์
  .delete('/sprints/:id/tasks/:taskId', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const sprint = (await db.select().from(sprints).where(eq(sprints.id, c.req.param('id'))).limit(1))[0]
    if (!sprint) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    const role = await getProjectRole(db, sprint.projectId, me.id, me.role)
    if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)
    const task = (await db.select().from(tasks).where(eq(tasks.id, c.req.param('taskId'))).limit(1))[0]
    if (!task || task.sprintId !== sprint.id) return c.json({ error: 'not_found' }, 404)
    const updated = await db.update(tasks).set({ sprintId: null, sprintStatus: null }).where(eq(tasks.id, task.id)).returning()
    return c.json(updated[0])
  })

  // task ของ sprint นี้สำหรับหน้า Board (เฉพาะกระดานของ sprint นี้ — คนละอันกับ sprint อื่น/โปรเจกต์อื่น)
  .get('/sprints/:id/board', async (c) => {
    const db = createDb(c.env.DB)
    const sprint = (await db.select().from(sprints).where(eq(sprints.id, c.req.param('id'))).limit(1))[0]
    if (!sprint) return c.json({ error: 'not_found' }, 404)
    const preset = await loadPreset(db, sprint.boardPresetId)
    const rows = await db
      .select({ task: tasks, assigneeName: users.name, assigneeAvatarUrl: users.avatarUrl })
      .from(tasks)
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .where(eq(tasks.sprintId, sprint.id))
      .orderBy(asc(tasks.sortOrder))
    return c.json({
      sprint,
      preset: preset ?? null,
      tasks: rows.map((r) => ({ ...r.task, assigneeName: r.assigneeName, assigneeAvatarUrl: r.assigneeAvatarUrl })),
      parents: await loadParents(db, rows.map((r) => r.task)),
      epics: await loadEpics(db, rows.map((r) => r.task)),
    })
  })

  // report — completed ใช้ snapshot ที่ปิดไว้ · planned/active นับสดจาก tasks ปัจจุบัน
  .get('/sprints/:id/report', async (c) => {
    const db = createDb(c.env.DB)
    const sprint = (await db.select().from(sprints).where(eq(sprints.id, c.req.param('id'))).limit(1))[0]
    if (!sprint) return c.json({ error: 'not_found' }, 404)
    if (sprint.status === 'completed') {
      const done = sprint.doneCount ?? 0
      const notDone = sprint.notDoneCount ?? 0
      return c.json({ sprint, done, notDone, total: done + notDone })
    }
    const preset = await loadPreset(db, sprint.boardPresetId)
    const cols = preset ? columnsOf(preset) : []
    const doneColId = cols[cols.length - 1]?.id
    const mine = await db.select({ sprintStatus: tasks.sprintStatus }).from(tasks).where(eq(tasks.sprintId, sprint.id))
    const done = mine.filter((t) => t.sprintStatus === doneColId).length
    return c.json({ sprint, done, notDone: mine.length - done, total: mine.length })
  })

  // Detail Board ย้อนหลังของ sprint ที่ปิดไปแล้ว — อ่านจาก snapshot (ไม่ใช่ tasks สด เพราะ task ถูกเด้งกลับ backlog ไปแล้ว)
  .get('/sprints/:id/snapshot', async (c) => {
    const db = createDb(c.env.DB)
    const sprint = (await db.select().from(sprints).where(eq(sprints.id, c.req.param('id'))).limit(1))[0]
    if (!sprint) return c.json({ error: 'not_found' }, 404)
    if (sprint.status !== 'completed') return c.json({ error: 'not_completed', message: 'ดู Detail Board ย้อนหลังได้เฉพาะ Sprint ที่ปิดแล้ว' }, 409)
    const preset = await loadPreset(db, sprint.boardPresetId)
    const cols = preset ? columnsOf(preset) : []
    const rows = await db.select().from(sprintTaskSnapshots).where(eq(sprintTaskSnapshots.sprintId, sprint.id))
    return c.json({ sprint, preset: preset ?? null, cols, tasks: rows })
  })
