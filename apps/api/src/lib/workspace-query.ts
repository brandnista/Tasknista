/**
 * Pronista §Workspace — logic ต่อโปรเจกต์ (sprint board + backlog) แยกออกมาให้เรียกซ้ำได้
 * ย้ายมาจาก sprints.ts (loadPreset/loadParents/loadEpics/loadSprintBoard) + tasks.ts (backlog query)
 * ใช้ทั้งจาก sprints.ts/tasks.ts (endpoint เดิม ต่อ 1 โปรเจกต์) และ workspace.ts (endpoint ใหม่ รวมหลายโปรเจกต์)
 * pure extraction — พฤติกรรมของ endpoint เดิมต้องเหมือนเดิม 100%
 */
import { presetById, resolvePresets } from '@seedoffice/core'
import { companyConfig, createDb, epics, sprints, tasks, users, workspaceMembers, workspaceProjects } from '@seedoffice/db'
import { alias } from 'drizzle-orm/sqlite-core'
import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'
import { canEditProject, type EffectiveProjectRole } from './project-role'

/** Pronista §Workspace Sprint (ต่อยอด) — สมาชิกห้องนี้หรือ owner บริษัท (ใช้คุมสิทธิ์แก้ไข Sprint ที่ผูกห้อง แทน getProjectRole ที่ใช้กับ Sprint ผูกโปรเจกต์) */
export async function isWorkspaceMember(db: ReturnType<typeof createDb>, workspaceId: string, me: { id: string; role: 'owner' | 'member' | 'vendor' | 'guest' }) {
  if (me.role === 'owner') return true
  const row = (await db.select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, me.id))).limit(1))[0]
  return !!row
}

/** โปรเจกต์ที่ถูกดึงเข้าห้องนี้แล้ว (ดู workspace_projects) — ใช้เช็คว่า task ที่จะลากเข้า Sprint ของห้องนี้มาจากโปรเจกต์ที่อยู่ในห้องจริงไหม */
export async function workspaceProjectIds(db: ReturnType<typeof createDb>, workspaceId: string) {
  const rows = await db.select({ projectId: workspaceProjects.projectId }).from(workspaceProjects).where(eq(workspaceProjects.workspaceId, workspaceId))
  return new Set(rows.map((r) => r.projectId))
}

export interface WorkspaceBacklogItem {
  id: string
  code: string | null
  title: string
  kind: 'epic' | 'task' | 'backlog'
  workType: 'epic' | 'story' | 'task' | 'subtask'
  status: string | null
  dueDate: string | null
  priority: 'low' | 'normal' | 'high' | null
  assigneeId: string | null
  assigneeName: string | null
  assignedBy: string | null
  dispatcherName: string | null
  epicId: string | null
  parentId: string | null
  labelIds: string[] | null
}

export async function loadPreset(db: ReturnType<typeof createDb>, boardPresetId: string | null) {
  if (!boardPresetId) return undefined
  const cfg = (await db.select({ boardPresets: companyConfig.boardPresets }).from(companyConfig).limit(1))[0]
  return presetById(resolvePresets(cfg?.boardPresets), boardPresetId)
}

// Pronista §Sprint & Board fix — ให้ frontend จัดกลุ่ม/ยุบการ์ด subtask ตาม parent ได้ (Task View / Mixed View) โดยไม่ต้อง query เพิ่มฝั่ง client
export async function loadParents(db: ReturnType<typeof createDb>, rowTasks: (typeof tasks.$inferSelect)[]) {
  const parentIds = [...new Set(rowTasks.map((t) => t.parentId).filter((id): id is string => id !== null))]
  if (parentIds.length === 0) return []
  return db.select({ id: tasks.id, code: tasks.code, title: tasks.title }).from(tasks).where(inArray(tasks.id, parentIds))
}

// Pronista §Epic Layer — ให้ frontend วาด swimlane ต่อ Epic บน Sprint Timeline โดยไม่ต้อง query เพิ่มฝั่ง client
export async function loadEpics(db: ReturnType<typeof createDb>, rowTasks: (typeof tasks.$inferSelect)[]) {
  const epicIds = [...new Set(rowTasks.map((t) => t.epicId).filter((id): id is string => id !== null))]
  if (epicIds.length === 0) return []
  return db.select({ id: epics.id, title: epics.title, code: epics.code }).from(epics).where(inArray(epics.id, epicIds))
}

// Pronista §Back to Basic (ต่อยอด) — ข้อมูล Board ของ sprint เดียว (ใช้ทั้งใน /sprints/current ที่คืนทุก sprint พร้อมกัน และ /sprints/:id/board ของหน้า Board แยกต่อ sprint)
export async function loadSprintBoard(db: ReturnType<typeof createDb>, sprint: typeof sprints.$inferSelect) {
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

// Pronista §Workspace — sprint ที่ยังไม่ completed ทั้งหมดของโปรเจกต์เดียว (active มาก่อนเสมอ ที่เหลือเรียงตาม createdAt) พร้อม board data ของแต่ละอัน
// logic เดียวกับ GET /projects/:id/sprints/current (sprints.ts) — ดึงมาไว้ที่นี่ให้ workspace.ts เรียกซ้ำต่อโปรเจกต์ได้
export async function loadProjectSprintBoards(db: ReturnType<typeof createDb>, projectId: string) {
  const open = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.projectId, projectId), ne(sprints.status, 'completed')))
    .orderBy(asc(sprints.createdAt))
  const ordered = [...open.filter((s) => s.status === 'active'), ...open.filter((s) => s.status !== 'active')]
  return Promise.all(ordered.map((sprint) => loadSprintBoard(db, sprint)))
}

// Pronista §Workspace Sprint (ต่อยอด) — เหมือน loadProjectSprintBoards แต่ของ Sprint ที่ผูกห้อง Workspace โดยตรง (projectId ว่าง, workspaceId ตั้ง)
// task ในแต่ละ sprint ยังพกโปรเจกต์ของตัวเอง (tasks.projectId) แยกกันได้ตามปกติ — ไม่ต้องกรองอะไรเพิ่มตรงนี้
export async function loadWorkspaceSprintBoards(db: ReturnType<typeof createDb>, workspaceId: string) {
  const open = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.workspaceId, workspaceId), ne(sprints.status, 'completed')))
    .orderBy(asc(sprints.createdAt))
  const ordered = [...open.filter((s) => s.status === 'active'), ...open.filter((s) => s.status !== 'active')]
  return Promise.all(ordered.map((sprint) => loadSprintBoard(db, sprint)))
}

// Pronista §Workspace — backlog ของโปรเจกต์เดียว logic เดียวกับ GET /projects/:id/backlog (tasks.ts) — ดึงมาไว้ที่นี่ให้ workspace.ts เรียกซ้ำต่อโปรเจกต์ได้
export async function loadProjectBacklog(
  db: ReturnType<typeof createDb>,
  projectId: string,
  myRole: EffectiveProjectRole,
  userId: string,
) {
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
        // Pronista §Back to Basic (ต่อยอด) — ตัด Story/Task-ลอย/Defect/CR ออกจากลิสต์นี้ (ไปโผล่เฉพาะแท็บของตัวเองผ่าน /tasks/all): เหลือแค่งานทั่วไปแท้ (kind='backlog'), งานที่มาจากเอกสาร (originDocType ใดๆ, ระดับบนสุด), และลูกของ SOW (ทุกระดับ)
        or(
          and(isNull(tasks.parentId), or(eq(tasks.kind, 'backlog'), isNotNull(tasks.originDocType))),
          eq(tasks.originDocType, 'SOW'),
        ),
      ),
    )
    .orderBy(asc(tasks.createdAt))
  // Pronista §Backlog ownership — แท็บ "ทั่วไป" (kind='backlog') เป็นของส่วนตัวคนคีย์ · Owner/Editor เห็นของทุกคน ส่วน Member เห็นแค่ของตัวเอง (แท็บเอกสาร/SOW ไม่ใช่ของส่วนตัว ไม่กรอง)
  const rows = canEditProject(myRole) ? rowsAll : rowsAll.filter((r) => r.task.kind !== 'backlog' || r.task.createdBy === userId)

  // Pronista §Sprint & Board fix — ซ่อน Task พ่อของ SOW ที่ subtask ทั้งหมดย้ายออกจาก Backlog ไปหมดแล้ว (เข้า Sprint แล้วหรือถูกลบ) — parent ที่ไม่เคยมี subtask เลย (parse ไม่เจอ) ยังโชว์ไว้เหมือนเดิม
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

  // Pronista §Epic Layer — % ความคืบหน้ารวมของ Epic นับจากงานทั้งหมดในเอกสาร (รวมที่ย้ายเข้า Sprint ไปแล้วด้วย) ไม่ใช่แค่ที่เหลือใน Backlog
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

  return {
    tasks: rows
      .filter((r) => !hiddenParentIds.has(r.task.id))
      .map((r) => ({ ...r.task, assigneeName: r.assigneeName, epicTitle: r.epicTitle, epicCode: r.epicCode })),
    epics: epicList,
  }
}

// Pronista §Workspace Backlog Grid — ทุก "work item" ที่ยังไม่เข้า Sprint ของโปรเจกต์เดียว (Epic + Story/Task/Subtask + งานทั่วไป kind='backlog')
// ต่างจาก loadProjectBacklog เดิม (กรองแคบเฉพาะ kind='backlog'/เอกสาร/SOW) — ฟังก์ชันนี้แยกใหม่เฉพาะ Grid รวมของ Workspace ไม่แตะ endpoint เดิม
export async function loadProjectAllBacklogItems(db: ReturnType<typeof createDb>, projectId: string): Promise<WorkspaceBacklogItem[]> {
  const dispatcher = alias(users, 'dispatcher')

  const epicRows = await db.select().from(epics).where(eq(epics.projectId, projectId)).orderBy(asc(epics.createdAt))

  // หา parent ของทุก task (ไม่กรอง sprint) แค่พอรู้ depth ของ chain (Story→Task→Subtask) แม้ parent จะถูกลากเข้า sprint ไปแล้วก็ตาม
  const parentLookup = await db
    .select({ id: tasks.id, parentId: tasks.parentId })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.kind, 'task')))
  const parentIdById = new Map(parentLookup.map((t) => [t.id, t.parentId]))

  const rows = await db
    .select({ task: tasks, assigneeName: users.name, dispatcherName: dispatcher.name })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .leftJoin(dispatcher, eq(tasks.assignedBy, dispatcher.id))
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.sprintId), isNull(tasks.groupId), inArray(tasks.kind, ['task', 'backlog'])))
    .orderBy(asc(tasks.createdAt))

  // Pronista §Workspace Backlog Grid — Story = ไม่มีพ่อและไม่ใช่ Task ลอย · Task = ลูกของ Story (หรือ Task ลอย/kind='backlog') · Subtask = ลูกของ Task (พ่อมีพ่อของตัวเองอีกที)
  const classify = (t: typeof tasks.$inferSelect): 'story' | 'task' | 'subtask' => {
    if (t.kind === 'backlog') return 'task'
    if (t.parentId === null) return t.isStandaloneTask ? 'task' : 'story'
    return (parentIdById.get(t.parentId) ?? null) !== null ? 'subtask' : 'task'
  }

  const epicItems: WorkspaceBacklogItem[] = epicRows.map((e) => ({
    id: e.id,
    code: e.code,
    title: e.title,
    kind: 'epic',
    workType: 'epic',
    status: null,
    dueDate: null,
    priority: null,
    assigneeId: null,
    assigneeName: null,
    assignedBy: null,
    dispatcherName: null,
    epicId: null,
    parentId: null,
    labelIds: null,
  }))

  const taskItems: WorkspaceBacklogItem[] = rows.map((r) => ({
    id: r.task.id,
    code: r.task.code,
    title: r.task.title,
    kind: r.task.kind === 'backlog' ? 'backlog' : 'task',
    workType: classify(r.task),
    status: r.task.status,
    dueDate: r.task.dueDate,
    priority: r.task.priority,
    assigneeId: r.task.assigneeId,
    assigneeName: r.assigneeName,
    assignedBy: r.task.assignedBy,
    dispatcherName: r.dispatcherName,
    epicId: r.task.epicId,
    parentId: r.task.parentId,
    labelIds: r.task.labelIds,
  }))

  return [...epicItems, ...taskItems]
}
