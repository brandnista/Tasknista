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
  await env.DB.prepare('DELETE FROM doc_images').run()
  await env.DB.prepare('DELETE FROM docs').run()
})

async function makeDoc(cookie: string, title: string, parentId?: string) {
  return (await (
    await app.request('/api/docs', json(cookie, { title, ...(parentId ? { parentId } : {}) }), env)
  ).json()) as { id: string }
}

describe('D1 — docs tree CRUD', () => {
  it('สร้างซ้อน 3 ชั้น → tree ครบ · autosave content คงอยู่ · vendor = 403', async () => {
    const m = await loginAs(app, 'pond@example-co.test')
    const root = await makeDoc(m, 'คู่มือพนักงานใหม่')
    const child = await makeDoc(m, 'ตั้งค่าเครื่อง', root.id)
    const grand = await makeDoc(m, 'ติดตั้ง dev tools', child.id)

    const tree = (await (await app.request('/api/docs', { headers: { cookie: m } }, env)).json()) as { id: string; parentId: string | null }[]
    expect(tree).toHaveLength(3)
    expect(tree.find((d) => d.id === grand.id)?.parentId).toBe(child.id)

    await app.request(`/api/docs/${root.id}`, { ...json(m, { contentMarkdown: '# สวัสดี\n\n- ข้อแรก' }), method: 'PATCH' }, env)
    const doc = (await (await app.request(`/api/docs/${root.id}`, { headers: { cookie: m } }, env)).json()) as { contentMarkdown: string }
    expect(doc.contentMarkdown).toBe('# สวัสดี\n\n- ข้อแรก')

    const v = await loginAs(app, 'somchai@example.com')
    expect((await app.request('/api/docs', { headers: { cookie: v } }, env)).status).toBe(403)
    expect((await app.request(`/api/docs/${root.id}`, { headers: { cookie: v } }, env)).status).toBe(403)
  })

  it('move: ย้าย+เรียงได้ · ย้ายลงใต้ลูกตัวเอง = 409 cycle', async () => {
    const m = await loginAs(app, 'pond@example-co.test')
    const a = await makeDoc(m, 'A')
    const b = await makeDoc(m, 'B', a.id)
    const c0 = await makeDoc(m, 'C')

    // ย้าย C ไปใต้ B
    const mv = await app.request(`/api/docs/${c0.id}/move`, json(m, { parentId: b.id, sortOrder: 0 }), env)
    expect(mv.status).toBe(200)
    const tree = (await (await app.request('/api/docs', { headers: { cookie: m } }, env)).json()) as { id: string; parentId: string | null }[]
    expect(tree.find((d) => d.id === c0.id)?.parentId).toBe(b.id)

    // A → ใต้ C (หลาน) = cycle
    expect((await app.request(`/api/docs/${a.id}/move`, json(m, { parentId: c0.id, sortOrder: 0 }), env)).status).toBe(409)
  })

  it('ลบ root = soft-delete ทั้ง subtree (row ยังอยู่ใน DB)', async () => {
    const m = await loginAs(app, 'pond@example-co.test')
    const a = await makeDoc(m, 'A')
    const b = await makeDoc(m, 'B', a.id)
    await makeDoc(m, 'C', b.id)

    const del = (await (
      await app.request(`/api/docs/${a.id}`, { method: 'DELETE', headers: { cookie: m } }, env)
    ).json()) as { deleted: number }
    expect(del.deleted).toBe(3)

    const tree = (await (await app.request('/api/docs', { headers: { cookie: m } }, env)).json()) as unknown[]
    expect(tree).toHaveLength(0)
    const raw = await env.DB.prepare('SELECT COUNT(*) AS n FROM docs WHERE deleted_at IS NOT NULL').first<{ n: number }>()
    expect(raw?.n).toBe(3)
  })

  // Pronista §Document Management — คอลัมน์ "ขนาดไฟล์" (2026-09-01) — GET /docs ต้องคืน sizeBytes ให้หน้าบ้านโชว์ได้ (เฉพาะ kind='file')
  it('อัปโหลดไฟล์ (kind=file) → GET /docs เห็น sizeBytes ตรงกับไฟล์จริง', async () => {
    const m = await loginAs(app, 'pond@example-co.test')
    const fd = new FormData()
    fd.set('file', new File(['เนื้อหาไฟล์ทดสอบ'], 'สัญญา.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    const uploaded = (await (await app.request('/api/docs/upload', { method: 'POST', headers: { cookie: m }, body: fd }, env)).json()) as { id: string; sizeBytes: number }
    expect(uploaded.sizeBytes).toBeGreaterThan(0)

    const tree = (await (await app.request('/api/docs', { headers: { cookie: m } }, env)).json()) as { id: string; kind: string; sizeBytes: number | null }[]
    expect(tree.find((n) => n.id === uploaded.id)).toMatchObject({ kind: 'file', sizeBytes: uploaded.sizeBytes })
  })

  // Pronista §Document Versioning fix (2026-09-01) — เดิม docNumber/docVersion เซ็ตได้แค่ตอนระบบ gen เอง (breakout/SRS import) กรอกเองไม่ได้เลย
  it('อัปโหลดไฟล์พร้อมระบุเลขที่เอกสาร+เวอร์ชันได้เลย', async () => {
    const m = await loginAs(app, 'pond@example-co.test')
    const fd = new FormData()
    fd.set('file', new File(['x'], 'สัญญา.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    fd.set('docNumber', 'BNT-MOM-2026-014')
    fd.set('docVersion', '1.0')
    const uploaded = (await (await app.request('/api/docs/upload', { method: 'POST', headers: { cookie: m }, body: fd }, env)).json()) as { docNumber: string | null; docVersion: string | null }
    expect(uploaded).toMatchObject({ docNumber: 'BNT-MOM-2026-014', docVersion: '1.0' })
  })

  it('PATCH /api/docs/:id ตั้ง/แก้เลขที่เอกสาร+เวอร์ชันทีหลังได้ · ส่งค่าว่างเคลียร์กลับเป็น null', async () => {
    const m = await loginAs(app, 'pond@example-co.test')
    const doc = await makeDoc(m, 'เอกสารยังไม่มีเลขที่')

    const patched = (await (
      await app.request(`/api/docs/${doc.id}`, { ...json(m, { docNumber: 'BNT-BRD-2026-002', docVersion: '2.1' }), method: 'PATCH' }, env)
    ).json()) as { docNumber: string | null; docVersion: string | null }
    expect(patched).toMatchObject({ docNumber: 'BNT-BRD-2026-002', docVersion: '2.1' })

    const cleared = (await (
      await app.request(`/api/docs/${doc.id}`, { ...json(m, { docNumber: '', docVersion: '' }), method: 'PATCH' }, env)
    ).json()) as { docNumber: string | null; docVersion: string | null }
    expect(cleared).toMatchObject({ docNumber: null, docVersion: null })
  })

  it('เอกสาร 2 ไฟล์เลขที่เดียวกัน ต่างเวอร์ชัน → GET /docs เห็นทั้งคู่จับกลุ่มด้วย docNumber เดียวกัน', async () => {
    const m = await loginAs(app, 'pond@example-co.test')
    const fd1 = new FormData()
    fd1.set('file', new File(['v1'], 'v1.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    fd1.set('docNumber', 'BNT-SOW-2026-001')
    fd1.set('docVersion', '1.0')
    const v1 = (await (await app.request('/api/docs/upload', { method: 'POST', headers: { cookie: m }, body: fd1 }, env)).json()) as { id: string }

    const fd2 = new FormData()
    fd2.set('file', new File(['v2'], 'v2.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    fd2.set('docNumber', 'BNT-SOW-2026-001')
    fd2.set('docVersion', '1.1')
    const v2 = (await (await app.request('/api/docs/upload', { method: 'POST', headers: { cookie: m }, body: fd2 }, env)).json()) as { id: string }

    const tree = (await (await app.request('/api/docs', { headers: { cookie: m } }, env)).json()) as { id: string; docNumber: string | null; docVersion: string | null }[]
    const versions = tree.filter((d) => d.docNumber === 'BNT-SOW-2026-001')
    expect(versions.map((d) => d.id).sort()).toEqual([v1.id, v2.id].sort())
    expect(versions.map((d) => d.docVersion).sort()).toEqual(['1.0', '1.1'])
  })
})

describe('D3 — docs images', () => {
  it('อัป png → ได้ url → โหลดได้ · SVG = 415', async () => {
    const m = await loginAs(app, 'pond@example-co.test')
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array([137, 80, 78, 71])], 'pic.png', { type: 'image/png' }))
    const up = await app.request('/api/docs/images', { method: 'POST', headers: { cookie: m }, body: fd }, env)
    expect(up.status).toBe(201)
    const { url } = (await up.json()) as { url: string }
    expect(url).toMatch(/^\/api\/docs\/images\//)

    const dl = await app.request(url, { headers: { cookie: m } }, env)
    expect(dl.status).toBe(200)
    expect(dl.headers.get('content-type')).toBe('image/png')

    const svg = new FormData()
    svg.append('file', new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }))
    expect((await app.request('/api/docs/images', { method: 'POST', headers: { cookie: m }, body: svg }, env)).status).toBe(415)

    // vendor โหลดรูปก็ไม่ได้ (เอกสารทั้ง subtree = team only)
    const v = await loginAs(app, 'somchai@example.com')
    expect((await app.request(url, { headers: { cookie: v } }, env)).status).toBe(403)
  })
})
