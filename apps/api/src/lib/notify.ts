import { createDb, notifications, projectMembers, users } from '@seedoffice/db'
import { eq } from 'drizzle-orm'
import type { NOTIFICATION_TYPES } from '@seedoffice/db'

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

export interface NotifyProjectMembersInput {
  projectId: string
  type: (typeof NOTIFICATION_TYPES)[number]
  message: string
  taskId?: string
  excludeUserId?: string // ผู้ทำ action เอง ไม่ต้องแจ้งเตือนตัวเอง
}

/** แจ้งเตือนสมาชิกโปรเจกต์ทุกคน (ทุก role) — ใช้ตอนลูกค้าคีย์ Backlog/Defect เอง เป็นต้น */
export async function notifyProjectMembers(env: Env, input: NotifyProjectMembersInput): Promise<void> {
  const db = createDb(env.DB)
  const members = await db.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, input.projectId))
  const recipients = new Set(members.map((m) => m.userId))
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
