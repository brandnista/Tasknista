import { createDb, personalFileMembers, personalFiles } from '@seedoffice/db'
import { and, eq, isNull } from 'drizzle-orm'

/**
 * Pronista §My Files (2026-08-28) — สิทธิ์ต่อไฟล์/โฟลเดอร์ส่วนตัว (mirror doc-acl.ts) แต่มี 2 จุดต่างจากเอกสารบริษัทโดยเจตนา:
 * (1) ไม่มี owner-bypass — company Admin เห็นไฟล์ส่วนตัวคนอื่นไม่ได้เลยถ้าไม่ถูกแชร์ (นี่คือพื้นที่ "ส่วนตัว" จริงๆ)
 * (2) แชร์ทั้งโฟลเดอร์ = ลูกทุกชิ้นข้างในสืบสิทธิ์ต่อ (เดินขึ้น parent chain ถ้าตัวไฟล์เองไม่มีแถวแชร์ตรง)
 */
export type PersonalFileAccess = 'owner' | 'editor' | 'viewer' | 'none'

export async function getPersonalFileAccess(db: ReturnType<typeof createDb>, fileId: string, userId: string): Promise<PersonalFileAccess> {
  const file = (await db.select().from(personalFiles).where(and(eq(personalFiles.id, fileId), isNull(personalFiles.deletedAt))).limit(1))[0]
  if (!file) return 'none'
  if (file.ownerId === userId) return 'owner'
  const rows = await db.select({ role: personalFileMembers.role }).from(personalFileMembers).where(and(eq(personalFileMembers.fileId, fileId), eq(personalFileMembers.userId, userId)))
  if (rows.length > 0) return rows.some((r) => r.role === 'editor') ? 'editor' : 'viewer'
  if (file.parentId) return getPersonalFileAccess(db, file.parentId, userId) // ไม่มีแถวแชร์ตรง — เช็คโฟลเดอร์แม่ต่อ (สืบสิทธิ์)
  return 'none'
}

export function canEditPersonalFile(access: PersonalFileAccess): boolean {
  return access === 'owner' || access === 'editor'
}
export function canViewPersonalFile(access: PersonalFileAccess): boolean {
  return access !== 'none'
}
