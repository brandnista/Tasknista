import { extractMentionedUserIds } from '@seedoffice/core'
import { createDb, users } from '@seedoffice/db'
import { inArray } from 'drizzle-orm'
import { notifyUser } from './notify'
import { isProjectVisibleToUser } from './project-role'

/**
 * Pronista §PRO-0024 — แจ้งเตือนคนที่ถูกแท็ก (@mention) ในคอมเมนต์งาน
 * - แกะรายชื่อจากเนื้อหาคอมเมนต์เอง (ลิงก์ /mention/<userId>) ไม่เชื่อรายชื่อที่ client ส่งมา
 * - แจ้งเฉพาะคนที่ยังใช้งานอยู่ + มีสิทธิ์เห็นงานนั้นจริง (กันแท็กคนนอกโปรเจกต์แล้วเผยข้อมูลงาน) · ไม่แจ้งตัวเอง
 * - ตอนแก้คอมเมนต์: ส่ง previousBody มา → แจ้งเฉพาะคนที่ "เพิ่งถูกแท็กเพิ่ม" ไม่แจ้งซ้ำคนเดิม
 * คืน userId ที่แจ้งไปแล้ว (ผู้เรียกใช้ตัดคนเหล่านี้ออกจากแจ้งเตือน "คอมเมนต์ใหม่" ปกติ กันได้สองอัน)
 */
export async function notifyCommentMentions(
  db: ReturnType<typeof createDb>,
  p: {
    task: { id: string; title: string; projectId: string | null }
    author: { id: string; name: string }
    body: string
    previousBody?: string
  },
): Promise<string[]> {
  const before = new Set(p.previousBody ? extractMentionedUserIds(p.previousBody) : [])
  const wanted = extractMentionedUserIds(p.body).filter((id) => id !== p.author.id && !before.has(id))
  if (wanted.length === 0) return []
  const rows = await db.select({ id: users.id, role: users.role, status: users.status }).from(users).where(inArray(users.id, wanted))
  const notified: string[] = []
  const preview = p.body.replace(/\[@([^\]]*)\]\(\/mention\/[^)]*\)/g, '@$1').slice(0, 80)
  for (const u of rows) {
    if (u.status !== 'active') continue
    const canSee = p.task.projectId ? await isProjectVisibleToUser(db, p.task.projectId, u.id, u.role) : u.role !== 'guest'
    if (!canSee) continue
    await notifyUser(db, {
      userId: u.id,
      type: 'task_mentioned',
      taskId: p.task.id,
      projectId: p.task.projectId,
      message: `${p.author.name} แท็กคุณในคอมเมนต์ของงาน "${p.task.title}": "${preview}"`,
    })
    notified.push(u.id)
  }
  return notified
}
