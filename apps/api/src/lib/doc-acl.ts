import { createDb, docMembers, docs } from '@seedoffice/db'
import { and, eq } from 'drizzle-orm'

/**
 * Pronista §merge (2026-07-03) — สิทธิ์ต่อโหนดในเมนู "เอกสาร" (mirror project-role.ts / เดิม library-acl.ts)
 * company owner = 'owner' เสมอ · เจ้าของโหนด = 'owner' เสมอ · vendor ไม่เข้าเมนูนี้เลย (teamOnly กันไว้ชั้นนอก)
 * private = ต้องมีแถวใน doc_members ถึงจะเห็น · team = ทุกคน (owner/member) เห็นอย่างน้อย viewer
 */
export type DocAccess = 'owner' | 'editor' | 'viewer' | 'none'

export async function getDocAccess(
  db: ReturnType<typeof createDb>,
  docId: string,
  userId: string,
  globalRole: 'owner' | 'member' | 'vendor' | 'guest',
): Promise<DocAccess> {
  if (globalRole === 'vendor' || globalRole === 'guest') return 'none'
  const doc = (await db.select().from(docs).where(eq(docs.id, docId)).limit(1))[0]
  if (!doc) return 'none'
  if (globalRole === 'owner' || doc.ownerId === userId) return 'owner'
  const rows = await db
    .select({ role: docMembers.role })
    .from(docMembers)
    .where(and(eq(docMembers.docId, docId), eq(docMembers.userId, userId)))
  const memberRole = rows.some((r) => r.role === 'editor') ? 'editor' : rows.length > 0 ? 'viewer' : null
  if (doc.visibility === 'team') return memberRole ?? 'viewer'
  return memberRole ?? 'none'
}

export function canEditDoc(access: DocAccess): boolean {
  return access === 'owner' || access === 'editor'
}
export function canViewDoc(access: DocAccess): boolean {
  return access !== 'none'
}
