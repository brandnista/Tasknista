import { createDb, noteMembers, notes } from '@seedoffice/db'
import { and, eq } from 'drizzle-orm'

/**
 * Pronista §My Note sharing (2026-08-28) — สิทธิ์ต่อบันทึก mirror personal-files.ts แต่ไม่มี parent chain (note ไม่มีลูก จึงไม่ต้องเดินขึ้น)
 */
export type NoteAccess = 'owner' | 'editor' | 'viewer' | 'none'

export async function getNoteAccess(db: ReturnType<typeof createDb>, noteId: string, userId: string): Promise<NoteAccess> {
  const note = (await db.select().from(notes).where(eq(notes.id, noteId)).limit(1))[0]
  if (!note) return 'none'
  if (note.userId === userId) return 'owner'
  const rows = await db.select({ role: noteMembers.role }).from(noteMembers).where(and(eq(noteMembers.noteId, noteId), eq(noteMembers.userId, userId)))
  if (rows.length > 0) return rows.some((r) => r.role === 'editor') ? 'editor' : 'viewer'
  return 'none'
}

export function canEditNote(access: NoteAccess): boolean {
  return access === 'owner' || access === 'editor'
}
export function canViewNote(access: NoteAccess): boolean {
  return access !== 'none'
}
