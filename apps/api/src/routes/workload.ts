/**
 * Pronista §Workload (Phase 2) — ภาพรวมภาระงานทีม: ใคร ทำอะไร วันไหน เหลือ Manhour เท่าไหร่
 * นับเฉพาะ task ที่ status='on_processing' (กดรับงานแล้ว) ของคนในทีม (owner+member+vendor, ตัด guest ออก) — owner-only endpoint
 */
import {
  addDaysISO,
  resolveManhourMinutesPerDay,
  spreadTaskMinutes,
  weekdayOfISO,
  type ManhourUserType,
} from '@seedoffice/core'
import { calendarEvents, companyConfig, createDb, projects, sprints, tasks, users } from '@seedoffice/db'
import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types'

// owner ถือเป็นหมวด 'staff' เหมือน categoryOfUserRole() ใน admin.ts — Workload คนละแกนกับเพดานสิทธิ์ (permissionCategoryOfRole คืน null ให้ owner เพราะ owner bypass เพดานเสมอ)
const capacityCategoryOf = (role: 'owner' | 'member' | 'vendor'): ManhourUserType => (role === 'vendor' ? 'outsource' : 'staff')

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const workloadRoutes = new Hono<AppEnv>()

  .get('/workload', async (c) => {
    const q = z.object({ from: isoDate, to: isoDate, sprintId: z.string().optional() }).safeParse(c.req.query())
    if (!q.success) return c.json({ error: 'invalid' }, 400)
    const { from, to, sprintId } = q.data
    if (from > to) return c.json({ error: 'invalid' }, 400)

    const db = createDb(c.env.DB)

    const roster = await db
      .select({ id: users.id, name: users.name, role: users.role, avatarUrl: users.avatarUrl })
      .from(users)
      .where(and(eq(users.status, 'active'), inArray(users.role, ['owner', 'member', 'vendor'])))
    const rosterIds = roster.map((u) => u.id)
    if (rosterIds.length === 0) return c.json({ people: [], days: [], grid: {}, unscheduled: [] })

    const taskRows = await db
      .select({
        id: tasks.id, code: tasks.code, title: tasks.title, assigneeId: tasks.assigneeId,
        startDate: tasks.startDate, dueDate: tasks.dueDate, estimateMinutes: tasks.estimateMinutes,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'on_processing'),
          inArray(tasks.assigneeId, rosterIds),
          sprintId ? eq(tasks.sprintId, sprintId) : undefined,
        ),
      )

    const unscheduled = taskRows
      .filter((t) => !t.dueDate)
      .map((t) => ({ id: t.id, code: t.code, title: t.title, assigneeId: t.assigneeId!, estimateMinutes: t.estimateMinutes ?? 0 }))

    type Cell = { usedMinutes: number; capacityMinutes: number; onLeave: boolean; taskIds: string[] }
    const grid: Record<string, Record<string, Cell>> = {}
    for (const u of roster) grid[u.id] = {}
    const cellOf = (userId: string, date: string): Cell => (grid[userId]![date] ??= { usedMinutes: 0, capacityMinutes: 0, onLeave: false, taskIds: [] })

    for (const t of taskRows) {
      if (!t.dueDate || !t.assigneeId) continue
      const spread = spreadTaskMinutes({ startDate: t.startDate, dueDate: t.dueDate, estimateMinutes: t.estimateMinutes ?? 0 })
      for (const [date, minutes] of Object.entries(spread)) {
        if (date < from || date > to) continue
        const cell = cellOf(t.assigneeId, date)
        cell.usedMinutes += minutes
        cell.taskIds.push(t.id)
      }
    }

    // วันลา (calendarEvents type='leave') ช่วง from..to — เผื่อ startDate ย้อนไป 31 วันเหมือน gatherCalendarEvents (apps/api/src/routes/calendar.ts)
    const leaveRows = await db
      .select({ userId: calendarEvents.userId, startDate: calendarEvents.startDate, endDate: calendarEvents.endDate })
      .from(calendarEvents)
      .where(and(eq(calendarEvents.type, 'leave'), lte(calendarEvents.startDate, to), gte(calendarEvents.startDate, addDaysISO(from, -31))))
    const leaveSet = new Set<string>()
    for (const r of leaveRows) {
      if (!r.userId) continue
      const end = r.endDate ?? r.startDate
      if (end < from) continue
      const last = end > to ? to : end
      for (let d = r.startDate < from ? from : r.startDate; d <= last; d = addDaysISO(d, 1)) leaveSet.add(`${r.userId}:${d}`)
    }

    const cfg = (await db.select({ manhourMinutesPerDay: companyConfig.manhourMinutesPerDay, workHourCapMinutes: companyConfig.workHourCapMinutes }).from(companyConfig).limit(1))[0]
    const manhour = resolveManhourMinutesPerDay(cfg?.manhourMinutesPerDay, cfg?.workHourCapMinutes ?? 480)

    const days: string[] = []
    for (let d = from; d <= to; d = addDaysISO(d, 1)) days.push(d)

    for (const u of roster) {
      const category = capacityCategoryOf(u.role as 'owner' | 'member' | 'vendor')
      for (const date of days) {
        const onLeave = leaveSet.has(`${u.id}:${date}`)
        const cell = cellOf(u.id, date)
        cell.onLeave = onLeave
        cell.capacityMinutes = onLeave ? 0 : manhour[category][weekdayOfISO(date)]
      }
    }

    const people = roster.map((u) => ({ id: u.id, name: u.name, role: u.role, avatarUrl: u.avatarUrl }))
    return c.json({ people, days, grid, unscheduled })
  })

  // sprint ที่ยังไม่ปิด ทุกโปรเจกต์ — ให้ dropdown เลือกตอน view=Sprint
  .get('/workload/sprints', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db
      .select({ id: sprints.id, name: sprints.name, projectId: sprints.projectId, projectName: projects.name, startDate: sprints.startDate, endDate: sprints.endDate, status: sprints.status })
      .from(sprints)
      .leftJoin(projects, eq(sprints.projectId, projects.id))
      .where(inArray(sprints.status, ['planned', 'active']))
    return c.json({ sprints: rows })
  })
