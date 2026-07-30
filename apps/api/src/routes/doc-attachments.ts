import { createDb, docAttachments, docs } from '@seedoffice/db'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { canEditDoc, canViewDoc, getDocAccess } from '../lib/doc-acl'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

const MAX_FILE_BYTES = 15 * 1024 * 1024

/**
 * Tasknista §Document Attachments — ส่วนแนบท้ายเอกสาร template ทุกประเภท (MOM/BRD/SOW/SRS/PROP): ลิงก์ภายนอก (เช่น ลิงก์บันทึกประชุม) หรือไฟล์/รูปใน R2
 * ใช้ ACL เดียวกับเอกสาร (doc-acl.ts) — ไม่ใช่ task attachments (task-detail.ts) คนละตารางคนละสิทธิ์
 */
export const docAttachmentsRoutes = new Hono<AppEnv>()

  .get('/docs/:id/attachments', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const doc = (await db.select().from(docs).where(and(eq(docs.id, c.req.param('id')), isNull(docs.deletedAt))).limit(1))[0]
    if (!doc) return c.json({ error: 'not_found' }, 404)
    const access = await getDocAccess(db, doc.id, me.id, me.role)
    if (!canViewDoc(access)) return c.json({ error: 'forbidden' }, 403)
    const rows = await db.select().from(docAttachments).where(eq(docAttachments.docId, doc.id)).orderBy(asc(docAttachments.createdAt))
    return c.json(rows)
  })

  // แนบลิงก์ภายนอก (JSON) — เช่น ลิงก์บันทึกประชุม Google Meet
  .post('/docs/:id/attachments/link', teamOnly, async (c) => {
    const body = z.object({ label: z.string().min(1).max(200), url: z.string().url().max(2000) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const doc = (await db.select().from(docs).where(and(eq(docs.id, c.req.param('id')), isNull(docs.deletedAt))).limit(1))[0]
    if (!doc) return c.json({ error: 'not_found' }, 404)
    const access = await getDocAccess(db, doc.id, me.id, me.role)
    if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    const inserted = (
      await db.insert(docAttachments).values({ docId: doc.id, kind: 'link', label: body.data.label, url: body.data.url, createdBy: me.id }).returning()
    )[0]!
    await writeAudit(c.env, { actorId: me.id, action: 'doc.attach', entity: 'doc', entityId: doc.id, meta: { kind: 'link', label: body.data.label } })
    return c.json(inserted, 201)
  })

  // แนบไฟล์/รูป (multipart) → R2
  .post('/docs/:id/attachments/file', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const doc = (await db.select().from(docs).where(and(eq(docs.id, c.req.param('id')), isNull(docs.deletedAt))).limit(1))[0]
    if (!doc) return c.json({ error: 'not_found' }, 404)
    const access = await getDocAccess(db, doc.id, me.id, me.role)
    if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400)
    if (file.size === 0 || file.size > MAX_FILE_BYTES) return c.json({ error: 'file_too_large' }, 413)

    const safeName = file.name.replaceAll('/', '_').slice(0, 120)
    const r2Key = `docs/${doc.id}/attachments/${crypto.randomUUID()}-${safeName}`
    await c.env.FILES.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } })
    const inserted = (
      await db
        .insert(docAttachments)
        .values({
          docId: doc.id,
          kind: 'file',
          label: safeName,
          filename: safeName,
          mime: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          r2Key,
          createdBy: me.id,
        })
        .returning()
    )[0]!
    await writeAudit(c.env, { actorId: me.id, action: 'doc.attach', entity: 'doc', entityId: doc.id, meta: { kind: 'file', filename: safeName } })
    return c.json(inserted, 201)
  })

  // โหลดไฟล์/รูปที่แนบ — รูป inline, อื่นๆ (รวม SVG กัน XSS) บังคับดาวน์โหลด
  .get('/doc-attachments/:id', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const att = (await db.select().from(docAttachments).where(eq(docAttachments.id, c.req.param('id'))).limit(1))[0]
    if (!att || !att.r2Key) return c.json({ error: 'not_found' }, 404)
    const access = await getDocAccess(db, att.docId, me.id, me.role)
    if (!canViewDoc(access)) return c.json({ error: 'forbidden' }, 403)
    const obj = await c.env.FILES.get(att.r2Key)
    if (!obj) return c.json({ error: 'object_missing' }, 404)
    const inlineSafe = /^image\/(png|jpeg|gif|webp|avif)$/.test(att.mime ?? '')
    return new Response(obj.body, {
      headers: {
        'content-type': inlineSafe && att.mime ? att.mime : 'application/octet-stream',
        'content-disposition': `${inlineSafe ? 'inline' : 'attachment'}; filename="${encodeURIComponent(att.filename ?? att.label)}"`,
        'cache-control': 'private, max-age=3600',
      },
    })
  })

  .delete('/doc-attachments/:id', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const att = (await db.select().from(docAttachments).where(eq(docAttachments.id, c.req.param('id'))).limit(1))[0]
    if (!att) return c.json({ error: 'not_found' }, 404)
    if (me.role !== 'owner' && att.createdBy !== me.id) {
      const access = await getDocAccess(db, att.docId, me.id, me.role)
      if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    }
    if (att.r2Key) await c.env.FILES.delete(att.r2Key)
    await db.delete(docAttachments).where(eq(docAttachments.id, att.id))
    await writeAudit(c.env, { actorId: me.id, action: 'doc.attach_delete', entity: 'doc', entityId: att.docId, meta: { label: att.label } })
    return c.json({ ok: true })
  })
