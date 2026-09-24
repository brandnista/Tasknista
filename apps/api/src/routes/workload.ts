/**
 * Pronista §Workload (Phase 2) — ภาพรวมภาระงานทีม: ใคร ทำอะไร วันไหน เหลือ Manhour เท่าไหร่
 * ใช้เวลาที่บันทึกจริงของแต่ละคนต่อวัน เทียบกับ Manhour ของประเภทผู้ใช้
 */
import {
  addDaysISO,
  meetingMinutesByDate,
  resolveManhourMinutesPerDay,
  weekdayOfISO,
  type ManhourUserType,
} from '@seedoffice/core'
import { calendarEvents, companyConfig, createDb, projects, sprints, tasks, timeEntries, users } from '@seedoffice/db'
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { actualMinutesFor, checklistCountsFor } from '../lib/workspace-query'
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

    // คงรายการงานที่ยังไม่กำหนดวันไว้ให้ตามงานได้ แต่ไม่เอา estimate มาคิดเป็นภาระงานอีกแล้ว
    const taskRows = await db
      .select({
        id: tasks.id, code: tasks.code, title: tasks.title, assigneeId: tasks.assigneeId,
        startDate: tasks.startDate, dueDate: tasks.dueDate, estimateMinutes: tasks.estimateMinutes,
      })
      .from(tasks)
      .where(
        and(
          isNotNull(tasks.acceptedAt),
          ne(tasks.status, 'cancelled'),
          inArray(tasks.assigneeId, rosterIds),
          sprintId ? eq(tasks.sprintId, sprintId) : undefined,
        ),
      )

    const unscheduled = taskRows
      .filter((t) => !t.dueDate)
      .map((t) => ({ id: t.id, code: t.code, title: t.title, assigneeId: t.assigneeId! }))

    // Pronista §Calendar/Workload (2026-09-18) — แยก taskMinutes/meetingMinutes ให้ frontend โชว์ breakdown แหล่งที่มาได้ (usedMinutes รวมยังคงมีไว้เหมือนเดิม)
    type Cell = { usedMinutes: number; taskMinutes: number; meetingMinutes: number; capacityMinutes: number; onLeave: boolean; taskIds: string[] }
    const grid: Record<string, Record<string, Cell>> = {}
    for (const u of roster) grid[u.id] = {}
    const cellOf = (userId: string, date: string): Cell =>
      (grid[userId]![date] ??= { usedMinutes: 0, taskMinutes: 0, meetingMinutes: 0, capacityMinutes: 0, onLeave: false, taskIds: [] })

    // Workload คือ utilisation จริง: รวม time_entries ตามวันทำงานของคนที่บันทึกเวลา
    // ไม่ใช้ estimate/start/due date ในการเติมเวลาสมมติอีกต่อไป
    const loggedRows = await db
      .select({ taskId: timeEntries.taskId, userId: timeEntries.userId, workDate: timeEntries.workDate, minutes: timeEntries.minutes })
      .from(timeEntries)
      .innerJoin(tasks, eq(timeEntries.taskId, tasks.id))
      .where(
        and(
          gte(timeEntries.workDate, from),
          lte(timeEntries.workDate, to),
          isNull(timeEntries.deletedAt),
          inArray(timeEntries.userId, rosterIds),
          ne(tasks.status, 'cancelled'),
          sprintId ? eq(tasks.sprintId, sprintId) : undefined,
        ),
      )
    for (const row of loggedRows) {
      const cell = cellOf(row.userId, row.workDate)
      cell.usedMinutes += row.minutes
      cell.taskMinutes += row.minutes
      if (!cell.taskIds.includes(row.taskId)) cell.taskIds.push(row.taskId)
    }

    // ประชุมจาก Google Calendar (source='gcal') — เฉพาะที่มีเวลาจริง (ไม่ใช่ all-day) และ busy=true (transparent = ว่าง ไม่หัก) — declined ไม่ถูก sync เข้ามาอยู่แล้วตั้งแต่ gcal-sync.ts
    const meetingRows = await db
      .select({ userId: calendarEvents.userId, startAt: calendarEvents.startAt, endAt: calendarEvents.endAt })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.source, 'gcal'),
          eq(calendarEvents.type, 'meeting'),
          eq(calendarEvents.allDay, false),
          eq(calendarEvents.busy, true),
          isNotNull(calendarEvents.userId),
          isNotNull(calendarEvents.startAt),
          isNotNull(calendarEvents.endAt),
          inArray(calendarEvents.userId, rosterIds),
        ),
      )
    const meetingMinutes = meetingMinutesByDate(
      meetingRows.map((r) => ({ userId: r.userId!, startAt: +r.startAt!, endAt: +r.endAt! })),
      addDaysISO(from, -1), // ประชุมอาจเริ่มก่อนเที่ยงคืน BKK ของวันก่อนหน้าแล้วคาบมาถึง from
      to,
    )
    for (const [userId, byDate] of Object.entries(meetingMinutes)) {
      for (const [date, minutes] of Object.entries(byDate)) {
        if (date < from || date > to) continue
        const cell = cellOf(userId, date)
        cell.usedMinutes += minutes
        cell.meetingMinutes += minutes
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

  // Pronista §Workload Drill-down (2026-09-07) — เจาะดูงานของพนักงานคนไหนก็ได้ (owner-only จาก middleware /api/workload/* ใน index.ts)
  // ?ids= (ถ้ามา) = taskIds เฉพาะที่มาจากการกดช่องวันในตาราง Workload (frontend คำนวณเองจาก grid[userId][date].taskIds อยู่แล้ว ไม่ต้องคำนวณวันซ้ำฝั่งนี้)
  .get('/workload/users/:id/tasks', async (c) => {
    const db = createDb(c.env.DB)
    const userId = c.req.param('id')
    const user = (await db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, userId)).limit(1))[0]
    if (!user) return c.json({ error: 'not_found' }, 404)
    const ids = c.req.query('ids')?.split(',').filter(Boolean)

    // หน้านี้เป็นมุมมองเจาะจากตาราง Workload — ถ้าส่ง ids มา จะเห็นเฉพาะงานที่ถูกนับใน Cell นั้น
    const rows = await db
      .select({ task: tasks, projectName: projects.name })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(eq(tasks.assigneeId, userId), ids && ids.length > 0 ? inArray(tasks.id, ids) : undefined))
      .orderBy(asc(tasks.dueDate))
    const checklistCounts = await checklistCountsFor(db, rows.map((r) => r.task.id))
    const checklistOf = (taskId: string) => {
      const cc = checklistCounts.get(taskId)
      return { checklistDone: cc?.done ?? 0, checklistTotal: cc?.total ?? 0 }
    }
    // Pronista §Workload Restructuring เฟส 5b (2026-09-24) — "เวลาทำจริง" บนการ์ด Kanban ของหน้า Workload รายบุคคล
    const actualMinutes = await actualMinutesFor(db, rows.map((r) => r.task.id))
    return c.json({ user, tasks: rows.map((r) => ({ ...r.task, projectName: r.projectName, ...checklistOf(r.task.id), actualMinutes: actualMinutes.get(r.task.id) ?? null })) })
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
