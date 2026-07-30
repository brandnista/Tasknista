import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

beforeEach(async () => {
  await seedUsers()
  await env.DB.prepare('DELETE FROM doc_attachments').run()
  await env.DB.prepare('DELETE FROM docs').run()
})

async function makeDoc(cookie: string, title: string) {
  return (await (await app.request('/api/docs', json(cookie, { title }), env)).json()) as { id: string }
}

describe('D4 — doc_attachments: ส่วนแนบท้ายเอกสาร template ทุกประเภท (Link/File/Image)', () => {
  it('แนบลิงก์ → โชว์ในลิสต์ · vendor เข้าไม่ได้ (403) · ลบได้เฉพาะคนแนบ/owner', async () => {
    const m = await loginAs(app, 'pond@example-co.test')
    const doc = await makeDoc(m, 'เอกสารทดสอบแนบท้าย')

    const add = await app.request(`/api/docs/${doc.id}/attachments/link`, json(m, { label: 'ลิงก์ประชุม', url: 'https://meet.google.com/abc-defg-hij' }), env)
    expect(add.status).toBe(201)
    const attachment = (await add.json()) as { id: string; kind: string; label: string }
    expect(attachment.kind).toBe('link')

    const list = (await (await app.request(`/api/docs/${doc.id}/attachments`, { headers: { cookie: m } }, env)).json()) as { id: string; label: string }[]
    expect(list).toHaveLength(1)
    expect(list[0]!.label).toBe('ลิงก์ประชุม')

    // vendor ไม่เห็นเอกสารนี้เลย (team only visibility) → 403 ทั้งอ่านและแนบ
    const v = await loginAs(app, 'somchai@example.com')
    expect((await app.request(`/api/docs/${doc.id}/attachments`, { headers: { cookie: v } }, env)).status).toBe(403)
    expect((await app.request(`/api/docs/${doc.id}/attachments/link`, json(v, { label: 'x', url: 'https://x.test' }), env)).status).toBe(403)

    // ลบได้ (คนแนบเอง)
    const del = await app.request(`/api/doc-attachments/${attachment.id}`, { method: 'DELETE', headers: { cookie: m } }, env)
    expect(del.status).toBe(200)
    const listAfter = (await (await app.request(`/api/docs/${doc.id}/attachments`, { headers: { cookie: m } }, env)).json()) as unknown[]
    expect(listAfter).toHaveLength(0)
  })

  it('แนบไฟล์ (multipart) → โหลดกลับมาได้ byte ตรง · รูปภาพเปิด inline, ไฟล์อื่นบังคับดาวน์โหลด', async () => {
    const m = await loginAs(app, 'pond@example-co.test')
    const doc = await makeDoc(m, 'เอกสารทดสอบแนบไฟล์')

    const fd = new FormData()
    fd.append('file', new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'pic.png', { type: 'image/png' }))
    const up = await app.request(`/api/docs/${doc.id}/attachments/file`, { method: 'POST', headers: { cookie: m }, body: fd }, env)
    expect(up.status).toBe(201)
    const att = (await up.json()) as { id: string; filename: string }
    expect(att.filename).toBe('pic.png')

    const dl = await app.request(`/api/doc-attachments/${att.id}`, { headers: { cookie: m } }, env)
    expect(dl.status).toBe(200)
    expect(dl.headers.get('content-disposition')).toContain('inline')
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))

    const fd2 = new FormData()
    fd2.append('file', new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    const up2 = await app.request(`/api/docs/${doc.id}/attachments/file`, { method: 'POST', headers: { cookie: m }, body: fd2 }, env)
    const att2 = (await up2.json()) as { id: string }
    const dl2 = await app.request(`/api/doc-attachments/${att2.id}`, { headers: { cookie: m } }, env)
    expect(dl2.headers.get('content-disposition')).toContain('attachment')
  })
})
