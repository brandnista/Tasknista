import { bkkDateOf } from '@seedoffice/core'
import { createDb, projects, taskGroups, tasks, taskStars, timeEntries, timerSessions, users } from '@seedoffice/db'
import { and, asc, eq, gte, isNull, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { ownerOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

/** ดาว "ทำวันนี้" + ภาพรวมส่วนตัวแบบย่อ (งานวันนี้ / งานเร็วๆ นี้) — ของตัวเองทุก role */
export const overviewRoutes = new Hono<AppEnv>()

  // ติด/ถอนดาววันนี้ (ของตัวเอง)
  .post('/tasks/:id/star', async (c) => {
    const body = z.object({ on: z.boolean() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const task = (await db.select().from(tasks).where(eq(tasks.id, c.req.param('id'))).limit(1))[0]
    if (!task) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    const today = bkkDateOf(Date.now())
    await db
      .delete(taskStars)
      .where(and(eq(taskStars.taskId, task.id), eq(taskStars.userId, me.id), eq(taskStars.forDate, today)))
    if (body.data.on)
      await db.insert(taskStars).values({ taskId: task.id, userId: me.id, forDate: today })
    return c.json({ ok: true, starred: body.data.on })
  })

  // ภาพรวมย่อ: งานวันนี้ = ติดดาว ∪ งานที่จับเวลาวันนี้ (SPEC §4.10) + งานเร็วๆ นี้ (มอบหมายให้ฉัน ≤5)
  .get('/overview', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const today = bkkDateOf(Date.now())

    const starredRows = await db
      .select({ task: tasks, projectName: projects.name, projectId: projects.id, groupName: taskGroups.name })
      .from(taskStars)
      .innerJoin(tasks, eq(taskStars.taskId, tasks.id))
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .innerJoin(taskGroups, eq(tasks.groupId, taskGroups.id))
      .where(and(eq(taskStars.userId, me.id), eq(taskStars.forDate, today)))
      .orderBy(asc(tasks.sortOrder))

    // งานที่มีเวลาวันนี้ (ของฉัน) + นาทีรวมต่อ task
    const timedToday = await db
      .select({ task: tasks, projectName: projects.name, projectId: projects.id, groupName: taskGroups.name, minutes: timeEntries.minutes })
      .from(timeEntries)
      .innerJoin(tasks, eq(timeEntries.taskId, tasks.id))
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .innerJoin(taskGroups, eq(tasks.groupId, taskGroups.id))
      .where(and(eq(timeEntries.userId, me.id), eq(timeEntries.workDate, today), isNull(timeEntries.deletedAt)))
    const secondsByTask = new Map<string, number>()
    for (const r of timedToday)
      secondsByTask.set(r.task.id, (secondsByTask.get(r.task.id) ?? 0) + r.minutes * 60)

    // timer ที่กำลังเดิน — ส่งแค่ activeTaskId (FE บวกวินาทีที่วิ่งเองกันนับซ้ำ) + ให้ task โผล่ในลิสต์
    const active = (
      await db.select().from(timerSessions).where(eq(timerSessions.userId, me.id)).limit(1)
    )[0]
    if (active && !secondsByTask.has(active.taskId)) secondsByTask.set(active.taskId, 0)

    const byId = new Map<string, { id: string; title: string; status: string; projectId: string; projectName: string; groupName: string; starred: boolean; todaySeconds: number }>()
    for (const r of starredRows)
      byId.set(r.task.id, {
        id: r.task.id, title: r.task.title, status: r.task.status,
        projectId: r.projectId, projectName: r.projectName, groupName: r.groupName,
        starred: true, todaySeconds: secondsByTask.get(r.task.id) ?? 0,
      })
    for (const r of timedToday)
      if (!byId.has(r.task.id))
        byId.set(r.task.id, {
          id: r.task.id, title: r.task.title, status: r.task.status,
          projectId: r.projectId, projectName: r.projectName, groupName: r.groupName,
          starred: false, todaySeconds: secondsByTask.get(r.task.id) ?? 0,
        })
    // task ที่ timer กำลังเดินแต่ยังไม่มี entry/ดาว — ดึงมาโชว์ด้วย
    if (active && !byId.has(active.taskId)) {
      const row = (
        await db
          .select({ task: tasks, projectName: projects.name, projectId: projects.id, groupName: taskGroups.name })
          .from(tasks)
          .innerJoin(projects, eq(tasks.projectId, projects.id))
          .innerJoin(taskGroups, eq(tasks.groupId, taskGroups.id))
          .where(eq(tasks.id, active.taskId))
          .limit(1)
      )[0]
      if (row)
        byId.set(row.task.id, {
          id: row.task.id, title: row.task.title, status: row.task.status,
          projectId: row.projectId, projectName: row.projectName, groupName: row.groupName,
          starred: false, todaySeconds: 0,
        })
    }

    const upcoming = await db
      .select({ task: tasks, projectName: projects.name, projectId: projects.id })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(eq(tasks.assigneeId, me.id), ne(tasks.status, 'done'), gte(tasks.dueDate, today)))
      .orderBy(asc(tasks.dueDate))
      .limit(5)

    return c.json({
      today: [...byId.values()],
      activeTaskId: active?.taskId ?? null,
      upcoming: upcoming.map((r) => ({
        id: r.task.id,
        title: r.task.title,
        projectId: r.projectId,
        projectName: r.projectName,
        dueDate: r.task.dueDate,
      })),
    })
  })

  // ภาพรวมองค์กร (owner เท่านั้น) — สถิติข้ามโปรเจกต์: งานเลยกำหนด/ใกล้ครบกำหนด, ภาระงานทีม
  .get('/overview/company', ownerOnly, async (c) => {
    const db = createDb(c.env.DB)
    const today = bkkDateOf(Date.now())
    const in7 = bkkDateOf(Date.now() + 7 * 86_400_000)

    const allProjects = await db.select({ id: projects.id, name: projects.name }).from(projects)
    const projectNameById = new Map(allProjects.map((p) => [p.id, p.name]))

    const allTasks = await db.select().from(tasks)
    const overdueTasks = allTasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < today)

    const overdueDays = (dueDate: string) =>
      Math.round((Date.parse(`${today}T00:00:00+07:00`) - Date.parse(`${dueDate}T00:00:00+07:00`)) / 86_400_000)
    const overdueList = overdueTasks
      .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
      .slice(0, 12)
      .map((t) => ({
        id: t.id, title: t.title, priority: t.priority,
        projectId: t.projectId, projectName: t.projectId ? (projectNameById.get(t.projectId) ?? '') : 'Backlog',
        dueDate: t.dueDate, overdueDays: overdueDays(t.dueDate!),
      }))
    const dueSoonList = allTasks
      .filter((t) => t.status !== 'done' && t.dueDate && t.dueDate >= today && t.dueDate <= in7)
      .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
      .slice(0, 12)
      .map((t) => ({
        id: t.id, title: t.title, priority: t.priority,
        projectId: t.projectId, projectName: t.projectId ? (projectNameById.get(t.projectId) ?? '') : 'Backlog',
        dueDate: t.dueDate,
      }))

    // ภาระงานทีม — สมาชิก active ที่ไม่ใช่ vendor · นับงานยังไม่เสร็จ + เวลาที่ลงวันนี้
    const activeUsers = await db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl, role: users.role }).from(users).where(eq(users.status, 'active'))
    const unfinishedByUser = new Map<string, number>()
    const overdueByUser = new Map<string, number>()
    for (const t of allTasks) {
      if (t.status === 'done' || !t.assigneeId) continue
      unfinishedByUser.set(t.assigneeId, (unfinishedByUser.get(t.assigneeId) ?? 0) + 1)
      if (t.dueDate && t.dueDate < today) overdueByUser.set(t.assigneeId, (overdueByUser.get(t.assigneeId) ?? 0) + 1)
    }
    const timeToday = await db
      .select({ userId: timeEntries.userId, minutes: timeEntries.minutes })
      .from(timeEntries)
      .where(and(eq(timeEntries.workDate, today), isNull(timeEntries.deletedAt)))
    const minutesTodayByUser = new Map<string, number>()
    for (const e of timeToday) minutesTodayByUser.set(e.userId, (minutesTodayByUser.get(e.userId) ?? 0) + e.minutes)

    // เกณฑ์ความหนาแน่น (ปรับได้): ว่าง ≤3 · พอเหมาะ 4-6 · งานล้นมือ ≥7 งานที่ยังไม่เสร็จ
    const densityOf = (n: number): 'overloaded' | 'moderate' | 'free' => (n >= 7 ? 'overloaded' : n >= 4 ? 'moderate' : 'free')
    const teamWorkload = activeUsers
      .filter((u) => u.role !== 'vendor' && u.role !== 'guest')
      .map((u) => ({
        id: u.id, name: u.name, avatarUrl: u.avatarUrl,
        unfinished: unfinishedByUser.get(u.id) ?? 0,
        overdue: overdueByUser.get(u.id) ?? 0,
        minutesToday: minutesTodayByUser.get(u.id) ?? 0,
        density: densityOf(unfinishedByUser.get(u.id) ?? 0),
      }))
      .sort((a, b) => b.unfinished - a.unfinished)

    return c.json({ overdueList, dueSoonList, teamWorkload })
  })
