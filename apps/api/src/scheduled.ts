import { bkkDateOf, isNearExpiry } from '@seedoffice/core'
import { createDb, notifications, projectMembers, projects, sprints, tasks, timerSessions } from '@seedoffice/db'
import { and, eq, isNotNull, isNull, lt } from 'drizzle-orm'
import { runBackup } from './lib/backup'
import { syncAllCalendars } from './lib/gcal-sync'
import { syncAllMailboxes, wakeSnoozedThreads } from './lib/inbox-sync'
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
    return syncAllMailboxes(env)
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
    await runBackup(env)
  }
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
      await db.insert(notifications).values({ userId, type: 'expiry_reminder', projectId: p.id, message })
    }
    await db.update(projects).set({ expiryNotifiedAt: new Date() }).where(eq(projects.id, p.id))
  }
}
