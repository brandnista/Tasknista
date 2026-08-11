import { bkkDateOf, columnsOf, firstColumnId } from '@seedoffice/core'
import { createDb, projects, sprintTaskSnapshots, sprints, tasks, users, workspaces } from '@seedoffice/db'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { canEditProject, getProjectRole } from '../lib/project-role'
import { completeSprint } from '../lib/sprint'
import { isWorkspaceMember, loadEpics, loadParents, loadPreset, loadProjectSprintBoards, loadSprintBoard, loadWorkspaceSprintBoards, workspaceProjectIds } from '../lib/workspace-query'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Pronista §Workspace Sprint (ต่อยอด) — Sprint ผูกโปรเจกต์เดียว (canEditProject) หรือผูกห้อง Workspace (isWorkspaceMember) แยกกัน ไม่มีทางเป็นทั้งคู่หรือไม่มีเลย (บังคับตอนสร้าง) */
async function canManageSprint(
  db: ReturnType<typeof createDb>,
  sprint: { projectId: string | null; workspaceId: string | null },
  me: { id: string; role: 'owner' | 'member' | 'vendor' | 'guest' },
) {
  if (sprint.projectId) return canEditProject(await getProjectRole(db, sprint.projectId, me.id, me.role))
  if (sprint.workspaceId) return isWorkspaceMember(db, sprint.workspaceId, me)
  return false
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
    const items = await loadProjectSprintBoards(db, projectId)
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

  // Pronista §Workspace Sprint (ต่อยอด) — กด "+ Sprint" ในห้อง Workspace สร้าง container ว่างทันทีเหมือนกัน แต่ผูกห้องแทนโปรเจกต์ (ไม่ต้องเลือกโปรเจกต์ — งานในนั้นจะพกโปรเจกต์ของตัวเองแยกกันได้)
  .post('/workspaces/:id/sprints', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const workspaceId = c.req.param('id')
    const workspace = (await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0]
    if (!workspace) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    if (!(await isWorkspaceMember(db, workspaceId, me))) return c.json({ error: 'forbidden' }, 403)

    const now = Date.now()
    const created = (
      await db
        .insert(sprints)
        .values({ workspaceId, name: null, startDate: bkkDateOf(now), endDate: bkkDateOf(now + 7 * 86_400_000), boardPresetId: null, createdBy: me.id })
        .returning()
    )[0]
    if (!created) return c.json({ error: 'insert_failed' }, 500)
    await writeAudit(c.env, { actorId: me.id, action: 'sprint.create', entity: 'sprint', entityId: created.id, meta: { workspaceId } })
    return c.json(created, 201)
  })

  // Pronista §Workspace Sprint (ต่อยอด) — Sprint ที่ผูกห้องนี้ทั้งหมด (ยังไม่ completed) พร้อม board data — เหมือน GET /projects/:id/sprints/current แต่ของห้อง
  .get('/workspaces/:id/sprints/current', async (c) => {
    const db = createDb(c.env.DB)
    const items = await loadWorkspaceSprintBoards(db, c.req.param('id'))
    return c.json({ sprints: items })
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
    if (!(await canManageSprint(db, before, me))) return c.json({ error: 'forbidden' }, 403)
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
    if (!(await canManageSprint(db, before, me))) return c.json({ error: 'forbidden' }, 403)
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
    if (!(await canManageSprint(db, before, me))) return c.json({ error: 'forbidden' }, 403)
    if (before.status === 'completed') return c.json({ error: 'already_completed' }, 409)
    await completeSprint(db, before.id)
    await writeAudit(c.env, { actorId: me.id, action: 'sprint.complete', entity: 'sprint', entityId: before.id, meta: { manual: true } })
    const after = (await db.select().from(sprints).where(eq(sprints.id, before.id)).limit(1))[0]
    return c.json(after)
  })

  // ลาก task จาก Backlog ของโปรเจกต์เข้า sprint — ทั้งตอนยังไม่ Start (planned) และหลัง Start แล้ว (active)
  // planned: ยังไม่รู้คอลัมน์บอร์ด (เลือก preset ตอน start) — ตั้ง sprintStatus ว่างไว้ก่อน, ตอน start ค่อยจัดลงคอลัมน์แรกทีเดียว
  // active: รู้ preset อยู่แล้ว — จัดลงคอลัมน์แรกของบอร์ดทันที (เหมือนงานที่ลากเข้าตอน planned แล้วโดน start จัดคอลัมน์ให้)
  .post('/sprints/:id/tasks', teamOnly, async (c) => {
    const body = z.object({ taskId: z.string() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const sprint = (await db.select().from(sprints).where(eq(sprints.id, c.req.param('id'))).limit(1))[0]
    if (!sprint) return c.json({ error: 'not_found' }, 404)
    if (sprint.status === 'completed') return c.json({ error: 'sprint_completed', message: 'Sprint นี้ปิดไปแล้ว เพิ่มงานเข้าไม่ได้' }, 409)
    const me = c.get('user')
    if (!(await canManageSprint(db, sprint, me))) return c.json({ error: 'forbidden' }, 403)

    const task = (await db.select().from(tasks).where(eq(tasks.id, body.data.taskId)).limit(1))[0]
    if (!task) return c.json({ error: 'task_not_found' }, 404)
    // Pronista §Workspace Sprint (ต่อยอด) — Sprint ผูกโปรเจกต์: งานต้องเป็นของโปรเจกต์เดียวกันเป๊ะเหมือนเดิม · Sprint ผูกห้อง Workspace: งานต้องมาจากโปรเจกต์ที่ถูกดึงเข้าห้องนี้แล้ว (ข้ามโปรเจกต์ได้ภายในห้องเดียวกัน)
    const taskAllowed = sprint.projectId
      ? task.projectId === sprint.projectId
      : sprint.workspaceId && task.projectId
        ? (await workspaceProjectIds(db, sprint.workspaceId)).has(task.projectId)
        // Pronista §System Requirements Update — งาน Backlog ที่คีย์ตรงในห้อง (projectId ว่าง, workspaceId ผูกห้อง) ลากเข้า Sprint ของห้องเดียวกันได้
        : sprint.workspaceId && !task.projectId
          ? task.workspaceId === sprint.workspaceId
          : false
    if (!taskAllowed) return c.json({ error: 'not_in_backlog', message: 'ต้องเป็นงานในโปรเจกต์ที่อยู่ในห้อง/โปรเจกต์เดียวกับ Sprint นี้เท่านั้น' }, 400)

    const preset = sprint.status === 'active' ? await loadPreset(db, sprint.boardPresetId) : undefined
    const sprintStatus = preset ? firstColumnId(preset) : null

    // Pronista §Sprint & Board fix — ลาก Task พ่อของ SOW เข้า Sprint = ดึง subtask ทั้งหมดที่ยังอยู่ Backlog เข้าไปแทน (Task พ่อเองไม่เข้า sprint — ยังคงกฎเดิมที่ Task พ่อ SOW ลาก sprint โดยตรงไม่ได้)
    const isSowParent = task.originDocType === 'SOW' && task.parentId === null
    if (isSowParent) {
      const children = await db
        .update(tasks)
        .set({ sprintId: sprint.id, sprintStatus })
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
      .set({ sprintId: sprint.id, sprintStatus })
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
    if (!(await canManageSprint(db, sprint, me))) return c.json({ error: 'forbidden' }, 403)
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
