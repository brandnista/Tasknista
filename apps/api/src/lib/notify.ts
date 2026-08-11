import { createDb, companyConfig, notifications, projectMembers, projects, users } from '@seedoffice/db'
import { eq } from 'drizzle-orm'
import type { NOTIFICATION_TYPES } from '@seedoffice/db'
import { resolvePositions } from '@seedoffice/core'

/**
 * แจ้งเตือนชนเพดานชั่วโมง/วัน (SPEC §4.5: เตือนเว็บ + อีเมล — เจตนา: อยากให้ทีมพัก)
 * เว็บ = banner จาก response/GET /api/timer (ทำแล้ว)
 * อีเมล = รอเลือก provider (Cloudflare Email Sending ต้อง verify domain / หรือ Resend)
 *   → ตอนนี้ log structured ไว้ก่อน · จุดต่อสายอยู่ที่นี่ที่เดียว
 *   → SPEC §11: การส่งอีเมลออกนอกระบบต้อง ask ก่อนเปิดใช้จริง
 */
export async function notifyCapReached(env: Env, userId: string): Promise<void> {
  const db = createDb(env.DB)
  const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0]
  if (!user) return
  // TODO(email-provider): ส่งอีเมลจริงเมื่อเจ้าของเคาะ provider — ดูคำถามท้าย CP4
  console.log(
    JSON.stringify({
      event: 'cap_reached',
      userId: user.id,
      email: user.email,
      message: `ครบเพดานชั่วโมงทำงานของวันแล้ว — พักได้แล้ว 🌱 (ทำเกินจริงค่อยลง manual ย้อนหลัง)`,
    }),
  )
}

export interface NotifyProjectPmAndBaInput {
  projectId: string
  type: (typeof NOTIFICATION_TYPES)[number]
  message: string
  taskId?: string
  excludeUserId?: string // ผู้ทำ action เอง ไม่ต้องแจ้งเตือนตัวเอง
}

// Pronista §Feedback batch 2 — ไม่มี role ตายตัวชื่อ "PM"/"BA" ในระบบ (ตำแหน่งตั้งชื่อเองได้ต่อบริษัท)
// PM = หัวหน้าโครงการของโปรเจกต์นั้น (projects.leadId) · BA = สมาชิกโปรเจกต์ที่ตำแหน่ง (position) มีคำว่า "BA" (คำเดี่ยว) หรือ "Business Analyst" ในชื่อ
const BA_NAME_RE = /\bba\b|business analyst/i

/** แจ้งเตือนเฉพาะหัวหน้าโครงการ + สมาชิกตำแหน่ง BA ของโปรเจกต์ — ใช้ตอนลูกค้าคีย์ Backlog/Defect เอง */
export async function notifyProjectPmAndBa(env: Env, input: NotifyProjectPmAndBaInput): Promise<void> {
  const db = createDb(env.DB)
  const [project, members, cfg] = await Promise.all([
    db.select({ leadId: projects.leadId }).from(projects).where(eq(projects.id, input.projectId)).limit(1),
    db.select({ userId: projectMembers.userId, positionId: projectMembers.positionId }).from(projectMembers).where(eq(projectMembers.projectId, input.projectId)),
    db.select({ positions: companyConfig.positions }).from(companyConfig).limit(1),
  ])
  const positions = resolvePositions(cfg[0]?.positions)
  const baPositionIds = new Set(positions.filter((p) => BA_NAME_RE.test(p.name)).map((p) => p.id))
  const recipients = new Set(members.filter((m) => m.positionId && baPositionIds.has(m.positionId)).map((m) => m.userId))
  if (project[0]?.leadId) recipients.add(project[0].leadId)
  if (input.excludeUserId) recipients.delete(input.excludeUserId)
  for (const userId of recipients) {
    await db.insert(notifications).values({
      userId,
      type: input.type,
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      message: input.message,
    })
  }
}
