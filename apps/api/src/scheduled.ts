import { bkkDateOf, DEFAULT_MEETING_REMINDER_MINUTES, dueDomainReminder, isDomainExpired, isNearExpiry } from '@seedoffice/core'
import { createDb, domains, meetingParticipants, meetings, notifications, projectMembers, projects, sprints, tasks, timerSessions, users } from '@seedoffice/db'
import { and, eq, isNotNull, isNull, lt, lte, ne } from 'drizzle-orm'
import { runBackup } from './lib/backup'
import { syncAllCalendars } from './lib/gcal-sync'
import { syncAllMailboxes, wakeSnoozedThreads } from './lib/inbox-sync'
import { formatMeetingDetailMessage } from './lib/meeting-notify'
import { notifyUser } from './lib/notify'
import { purgeExpiredSessions } from './lib/session'
import { completeSprint } from './lib/sprint'
import { closeSession, getCapMinutes } from './lib/time-core'
import { notifyExpiringMembers } from './routes/members'

const BACKUP_CRON = '0 20 * * *' // 03:00 BKK รายวัน
const INBOX_SYNC_CRON = '* * * * *'

/**
 * Cron 3 จังหวะ:
 * - ทุก 1 นาที: sync อีเมลกลาง (E2 — เฉพาะกล่อง connected · ไม่มีกล่อง = จบทันที)
 * - ทุก 30 นาที: กวาด timer วิ่งเกินเพดาน (ปิดที่เพดาน) + ล้าง session หมดอายุ + sync Google Calendar (E6)
 * - รายวัน 03:00 BKK: backup D1 → R2 (T18 — ต้องมาก่อนปิดงวดจริงครั้งแรก)
 */
export async function runScheduled(env: Env, cron: string): Promise<void> {
  if (cron === INBOX_SYNC_CRON) {
    await wakeSnoozedThreads(env)
    await syncAllMailboxes(env)
    // Pronista §Meeting Schedule Tab (2026-08-27) — เตือนล่วงหน้าก่อนประชุมเริ่ม ต้องละเอียดระดับนาที เลยเกาะ cron ทุก 1 นาทีที่มีอยู่แล้ว (ไม่มี Cloudflare Queues ในระบบนี้)
    return notifyMeetingReminders(createDb(env.DB), Date.now())
  }

  const db = createDb(env.DB)
  const capMinutes = await getCapMinutes(env)
  const stale = await db
    .select()
    .from(timerSessions)
    .where(lt(timerSessions.startedAt, Date.now() - capMinutes * 60_000))
  for (const s of stale) {
    const task = (await db.select().from(tasks).where(eq(tasks.id, s.taskId)).limit(1))[0]
    await closeSession(env, s, task?.projectId ?? '', Date.now())
  }
  await purgeExpiredSessions(env)
  await syncAllCalendars(env) // E6 — sync ขาเข้า Google Calendar (กลืน error รายตัวเอง)

  // Pronista §Sprint & Board — sprint ที่ active ครบกำหนด (endDate < วันนี้ ตามเวลาไทย) → ปิดอัตโนมัติ (task ไม่ Done เด้งกลับ backlog)
  const today = bkkDateOf(Date.now())
  const overdueSprints = await db.select().from(sprints).where(and(eq(sprints.status, 'active'), lt(sprints.endDate, today)))
  for (const s of overdueSprints) await completeSprint(db, s.id)

  if (cron === BACKUP_CRON) {
    await notifyExpiringProjects(db, today)
    await notifyExpiringMembers(db, today)
    await notifyOverdueTasks(db, today)
    await notifyDomainExpiry(db, today)
    await cleanupOldNotifications(db)
    await runBackup(env)
  }
}

const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000 // 30 วัน

/** Pronista §Notification overhaul Batch C (2026-08-27) — ลบแจ้งเตือนที่อ่านแล้วเก่าเกิน 30 วันทิ้ง กันตาราง notifications โตไม่หยุด (แจ้งเตือนที่ยังไม่อ่านไม่ลบไม่ว่าเก่าแค่ไหน) */
export async function cleanupOldNotifications(db: ReturnType<typeof createDb>): Promise<void> {
  await db.delete(notifications).where(and(eq(notifications.isRead, true), lt(notifications.createdAt, new Date(Date.now() - NOTIFICATION_RETENTION_MS))))
}

/**
 * Pronista §Subscription Notify — เตือนทุกคนที่เป็นสมาชิกโปรเจกต์ล่วงหน้าก่อนโปรเจกต์หมดอายุบริการ (รันวันละครั้งพร้อม backup)
 * กันเตือนซ้ำทุกวันด้วย expiryNotifiedAt (reset เป็น null เฉพาะตอนแก้ serviceEndDate — ดู routes/projects.ts PATCH)
 */
async function notifyExpiringProjects(db: ReturnType<typeof createDb>, today: string): Promise<void> {
  const candidates = await db
    .select({
      id: projects.id,
      name: projects.name,
      leadId: projects.leadId,
      serviceEndDate: projects.serviceEndDate,
      notifyBeforeDays: projects.notifyBeforeDays,
    })
    .from(projects)
    .where(
      and(
        isNull(projects.deletedAt),
        isNotNull(projects.serviceEndDate),
        isNotNull(projects.notifyBeforeDays),
        isNull(projects.expiryNotifiedAt),
      ),
    )
  for (const p of candidates) {
    if (!isNearExpiry(p.serviceEndDate, p.notifyBeforeDays, today)) continue
    const members = await db.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, p.id))
    const recipients = new Set(members.map((m) => m.userId))
    if (p.leadId) recipients.add(p.leadId)
    const message = `โปรเจกต์ "${p.name}" ใกล้หมดอายุบริการ (${p.serviceEndDate})`
    for (const userId of recipients) {
      await notifyUser(db, { userId, type: 'expiry_reminder', projectId: p.id, message })
    }
    await db.update(projects).set({ expiryNotifiedAt: new Date() }).where(eq(projects.id, p.id))
  }
}

/**
 * Pronista §Notification overhaul (2026-08-27) — เตือนงานเลยกำหนดครั้งเดียวตอนเลยกำหนดวันแรก (ไม่เตือนซ้ำทุกวัน ด้วย dueNotifiedAt)
 * ไม่ย้อนหลัง — migration 0097 backfill ทำเครื่องหมายงานที่เลยกำหนดอยู่แล้วตอน deploy ไว้ว่า "แจ้งแล้ว" ไปแล้ว
 */
export async function notifyOverdueTasks(db: ReturnType<typeof createDb>, today: string): Promise<void> {
  const overdue = await db
    .select({ id: tasks.id, title: tasks.title, projectId: tasks.projectId, assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(and(isNotNull(tasks.dueDate), lt(tasks.dueDate, today), ne(tasks.status, 'done'), isNull(tasks.dueNotifiedAt), isNotNull(tasks.assigneeId)))
  for (const t of overdue) {
    await notifyUser(db, { userId: t.assigneeId!, type: 'task_overdue_reminder', taskId: t.id, projectId: t.projectId, message: `งาน "${t.title}" เลยกำหนดส่งแล้ว` })
    await db.update(tasks).set({ dueNotifiedAt: new Date() }).where(eq(tasks.id, t.id))
  }
}

/**
 * Pronista §Domain Management (2026-08-27) — เตือนโดเมนใกล้หมดอายุหลายระดับ (30/15/7/1 วัน) + เตือนแยกอีกครั้งตอนหมดอายุจริง (ครั้งเดียวไม่ซ้ำ)
 * ผู้รับ: ผู้รับผิดชอบโดเมน (ถ้าตั้งไว้) + owner ทุกคนเสมอ (กันโดเมนสำคัญหลุดสายตาเพราะผู้รับผิดชอบลาออก/พลาด)
 */
export async function notifyDomainExpiry(db: ReturnType<typeof createDb>, today: string): Promise<void> {
  const rows = await db.select().from(domains).where(isNull(domains.deletedAt))
  const owners = await db.select({ id: users.id }).from(users).where(eq(users.role, 'owner'))
  for (const d of rows) {
    // Pronista §Domain Detail Page — toggle "แจ้งเตือนหมดอายุ" ที่หน้า list/detail คุมจุดนี้โดยตรง
    if (!d.notifyEnabled) continue
    const recipients = new Set(owners.map((o) => o.id))
    if (d.responsibleUserId) recipients.add(d.responsibleUserId)

    if (isDomainExpired(d.expiryDate, today)) {
      if (!d.expiredNotifiedAt) {
        for (const userId of recipients) {
          await notifyUser(db, { userId, type: 'domain_expired', domainId: d.id, message: `โดเมน "${d.name}" หมดอายุแล้ว (${d.expiryDate})` })
        }
        await db.update(domains).set({ expiredNotifiedAt: new Date() }).where(eq(domains.id, d.id))
      }
      continue
    }

    const due = dueDomainReminder(d.expiryDate, today, d.notifiedTiers ?? [])
    if (!due) continue
    for (const userId of recipients) {
      await notifyUser(db, {
        userId,
        type: 'domain_expiry_reminder',
        domainId: d.id,
        message: `โดเมน "${d.name}" ใกล้หมดอายุ — เหลืออีก ${due.tierToAnnounce} วัน (${d.expiryDate})`,
      })
    }
    await db.update(domains).set({ notifiedTiers: [...(d.notifiedTiers ?? []), ...due.allDueTiers] }).where(eq(domains.id, d.id))
  }
}

// นาทีล่วงหน้าสูงสุดที่ตั้งได้ (ดู zod .max(120) ใน routes/notifications.ts) — ใช้เป็น upper bound กันสแกนประชุมที่ยังไกลเกินไปทุกนาที
const MAX_MEETING_REMINDER_LOOKAHEAD_MS = 120 * 60_000

/**
 * Pronista §Meeting Schedule Tab (2026-08-27) — เตือนล่วงหน้าก่อนประชุมเริ่ม ตามนาทีที่แต่ละคนตั้งเอง (users.meetingReminderMinutes, null = ค่าเริ่มต้น 5 นาที)
 * เตือนครั้งเดียวต่อคนต่อประชุม (remindedAt กันซ้ำ) · ไม่ย้อนหลัง — migration 0099 backfill ประชุมที่เริ่มไปแล้วก่อน deploy ไว้แล้วว่า "เตือนแล้ว"
 * ถ้า cron หน่วงจนเลยเวลาเริ่มประชุมไปแล้ว (now >= startAt) ข้ามการส่งแต่ยัง mark remindedAt กันเตือนซ้ำ/เตือนย้อนหลังไม่มีความหมาย
 */
export async function notifyMeetingReminders(db: ReturnType<typeof createDb>, now: number): Promise<void> {
  const candidates = await db
    .select({
      participantRowId: meetingParticipants.id,
      meetingId: meetings.id,
      title: meetings.title,
      startAt: meetings.startAt,
      endAt: meetings.endAt,
      agenda: meetings.agenda,
      userId: users.id,
      userName: users.name,
      meetingReminderMinutes: users.meetingReminderMinutes,
    })
    .from(meetingParticipants)
    .innerJoin(meetings, eq(meetingParticipants.meetingId, meetings.id))
    .innerJoin(users, eq(meetingParticipants.userId, users.id))
    .where(and(isNull(meetingParticipants.remindedAt), lte(meetings.startAt, new Date(now + MAX_MEETING_REMINDER_LOOKAHEAD_MS))))

  // ต่อประชุม ต้องรู้ชื่อผู้เข้าร่วมทุกคน (ไม่ใช่แค่คนที่กำลังจะถูกเตือน) เพื่อใส่ในข้อความแจ้งเตือน — จัดกลุ่มก่อนแล้วค่อยดึงชื่อทีเดียวต่อประชุม
  const byMeeting = new Map<string, typeof candidates>()
  for (const row of candidates) byMeeting.set(row.meetingId, [...(byMeeting.get(row.meetingId) ?? []), row])

  for (const [meetingId, rows] of byMeeting) {
    const participantNames = (
      await db.select({ name: users.name }).from(meetingParticipants).innerJoin(users, eq(meetingParticipants.userId, users.id)).where(eq(meetingParticipants.meetingId, meetingId))
    ).map((r) => r.name)
    for (const row of rows) {
      const leadMinutes = row.meetingReminderMinutes ?? DEFAULT_MEETING_REMINDER_MINUTES
      if (now < row.startAt.getTime() - leadMinutes * 60_000) continue // ยังไม่ถึงเวลาเตือนของคนนี้
      if (now < row.startAt.getTime()) {
        const message = formatMeetingDetailMessage(`อีก ${leadMinutes} นาที ประชุม "${row.title}" จะเริ่ม`, row, participantNames)
        await notifyUser(db, { userId: row.userId, type: 'meeting_reminder', meetingId: row.meetingId, message })
      }
      await db.update(meetingParticipants).set({ remindedAt: new Date(now) }).where(eq(meetingParticipants.id, row.participantRowId))
    }
  }
}
