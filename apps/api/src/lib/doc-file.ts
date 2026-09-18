import type { docs } from '@seedoffice/db'
import type { AppEnv } from '../types'

type Env = AppEnv['Bindings']
type DocRow = typeof docs.$inferSelect

/** Stream ไฟล์ของ doc (kind='file') จาก R2 — PDF เปิด inline ได้ (ปลอดภัย ไม่ใช่ SVG), อย่างอื่นบังคับดาวน์โหลด
 * ใช้ร่วมกันทั้ง /api/docs/:id/raw (doc-acl gate) และ /api/projects/:id/documents/:docId/raw (project-permission gate) */
export async function streamDocFile(env: Env, doc: Pick<DocRow, 'r2Key' | 'mime' | 'filename' | 'title'>): Promise<Response> {
  if (!doc.r2Key) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } })
  const obj = await env.FILES.get(doc.r2Key)
  if (!obj) return new Response(JSON.stringify({ error: 'object_missing' }), { status: 404, headers: { 'content-type': 'application/json' } })
  const inlineSafe = doc.mime === 'application/pdf'
  return new Response(obj.body, {
    headers: {
      'content-type': doc.mime ?? 'application/octet-stream',
      'content-disposition': `${inlineSafe ? 'inline' : 'attachment'}; filename="${encodeURIComponent(doc.filename ?? doc.title)}"`,
      'cache-control': 'private, max-age=3600',
    },
  })
}

/** Copy ไฟล์ R2 ที่มีอยู่แล้วไปคีย์ใหม่ (prefix "docs/") — ใช้ตอน duplicate เอกสาร หรือโปรโมทไฟล์แนบ Task เป็นเอกสารโปรเจกต์
 * ตั้งใจ copy ไม่ใช่อ้างคีย์เดิมร่วมกัน — กันกรณีต้นทาง (เช่น task attachment) ถูกลบทีหลังแล้วไฟล์จริงหายไปด้วย (DELETE /attachments/:id ลบไฟล์ R2 จริง) */
export async function copyR2DocFile(env: Env, srcR2Key: string, filename: string): Promise<string | null> {
  const obj = await env.FILES.get(srcR2Key)
  if (!obj) return null
  const newR2Key = `docs/${crypto.randomUUID()}-${filename}`
  await env.FILES.put(newR2Key, obj.body, { httpMetadata: { contentType: obj.httpMetadata?.contentType } })
  return newR2Key
}
