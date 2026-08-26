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
  await env.DB.prepare('DELETE FROM external_document_log_sow_tasks').run()
  await env.DB.prepare('DELETE FROM external_document_logs').run()
  await env.DB.prepare('DELETE FROM task_references').run()
  await env.DB.prepare('DELETE FROM doc_links').run()
  await env.DB.prepare('DELETE FROM doc_template_values').run()
  await env.DB.prepare('DELETE FROM doc_attachments').run()
  await env.DB.prepare('DELETE FROM tasks').run()
  await env.DB.prepare('DELETE FROM docs').run()
  await env.DB.prepare('DELETE FROM project_members').run()
  await env.DB.prepare('DELETE FROM chat_channels').run()
  await env.DB.prepare('DELETE FROM projects').run()
})

async function makeProjectWithSowTask(owner: string, editor: string, code: string) {
  const p = (await (
    await app.request('/api/projects', json(owner, { name: `โปรเจกต์ ${code}`, type: 'project', code }), env)
  ).json()) as { id: string }
  await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_pond', positionId: 'pos_full_access' }), env)
  // สร้าง SOW task ผ่าน template breakout (ให้ originDocType='SOW' จริง)
  const doc = (await (
    await app.request('/api/docs/template', json(editor, { templateType: 'sow', title: 'SOW ทดสอบ', projectId: p.id }), env)
  ).json()) as { id: string }
  const breakout = (await (
    await app.request(
      `/api/docs/${doc.id}/breakout`,
      json(editor, { docVersion: '1.0', items: [{ sourceCode: 'X-SOW-001', title: 'Design Module', description: '', priority: null, referenceCodes: [] }] }),
      env,
    )
  ).json()) as { tasks: { id: string }[] }
  return { project: p, sowTaskId: breakout.tasks[0]!.id }
}

describe('X1 — External Document Version Logging', () => {
  it('เพิ่ม log + ผูก SOW task → GET เห็นครบ (ชื่อผู้ทำ/ผู้รีวิว + badge SOW) · append-only: เพิ่มเวอร์ชันใหม่เห็นประวัติ 2 แถว', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const { project, sowTaskId } = await makeProjectWithSowTask(owner, m, 'EXT001')

    const create = await app.request(
      `/api/projects/${project.id}/external-doc-logs`,
      json(m, {
        documentName: 'User Interface Design',
        externalUrl: 'https://www.canva.com/design/abc123',
        version: 'v1.0',
        startDate: '2026-07-01',
        endDate: '2026-07-10',
        createdBy: 'u_pond',
        reviewedBy: 'u_owner',
        status: 'under_review',
        relatedTaskIds: [sowTaskId],
      }),
      env,
    )
    expect(create.status).toBe(201)

    // เพิ่มเวอร์ชันใหม่ (append-only — ไม่ทับของเดิม)
    await app.request(
      `/api/projects/${project.id}/external-doc-logs`,
      json(m, { documentName: 'User Interface Design', externalUrl: 'https://www.canva.com/design/abc123?v=2', version: 'v1.1', createdBy: 'u_pond', status: 'approved', relatedTaskIds: [sowTaskId] }),
      env,
    )

    const res = (await (
      await app.request(`/api/projects/${project.id}/external-doc-logs`, { headers: { cookie: m } }, env)
    ).json()) as { logs: { version: string; createdByName: string; reviewedByName: string | null; status: string; relatedSowTasks: { id: string; originCode: string | null }[] }[]; sowTaskOptions: unknown[] }
    expect(res.logs).toHaveLength(2)
    expect(res.logs.map((l) => l.version).sort()).toEqual(['v1.0', 'v1.1'])
    const v10 = res.logs.find((l) => l.version === 'v1.0')!
    expect(v10.createdByName).toBe('ปอนด์')
    expect(v10.reviewedByName).toBe('เมธ')
    expect(v10.relatedSowTasks).toHaveLength(1)
    expect(v10.relatedSowTasks[0]!.id).toBe(sowTaskId)
    expect(v10.relatedSowTasks[0]!.originCode).toBe('X-SOW-001')
    expect(res.sowTaskOptions).toHaveLength(1)
  })

  it('ผูก task ที่ไม่ใช่ SOW = 400 · vendor = 403 ทั้งอ่านและเขียน · ลบได้เฉพาะ editor', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const { project } = await makeProjectWithSowTask(owner, m, 'EXT002')

    // task ทั่วไป (ไม่ได้มาจาก SOW) ผูกไม่ได้
    const plainTask = (await (
      await app.request(`/api/projects/${project.id}/backlog`, json(m, { title: 'งานทั่วไป' }), env)
    ).json()) as { id: string }
    const bad = await app.request(
      `/api/projects/${project.id}/external-doc-logs`,
      json(m, { documentName: 'X', externalUrl: 'https://x.test', version: 'v1', createdBy: 'u_pond', relatedTaskIds: [plainTask.id] }),
      env,
    )
    expect(bad.status).toBe(400)

    const created = (await (
      await app.request(
        `/api/projects/${project.id}/external-doc-logs`,
        json(m, { documentName: 'UI Design', externalUrl: 'https://www.canva.com/x', version: 'v1.0', createdBy: 'u_pond' }),
        env,
      )
    ).json()) as { id: string }

    const v = await loginAs(app, 'somchai@example.com')
    expect((await app.request(`/api/projects/${project.id}/external-doc-logs`, { headers: { cookie: v } }, env)).status).toBe(403)
    expect(
      (await app.request(`/api/projects/${project.id}/external-doc-logs`, json(v, { documentName: 'X', externalUrl: 'https://x.test', version: 'v1', createdBy: 'u_pond' }), env)).status,
    ).toBe(403)
    expect((await app.request(`/api/external-doc-logs/${created.id}`, { method: 'DELETE', headers: { cookie: v } }, env)).status).toBe(403)

    expect((await app.request(`/api/external-doc-logs/${created.id}`, { method: 'DELETE', headers: { cookie: m } }, env)).status).toBe(200)
    const after = (await (
      await app.request(`/api/projects/${project.id}/external-doc-logs`, { headers: { cookie: m } }, env)
    ).json()) as { logs: unknown[] }
    expect(after.logs).toHaveLength(0)
  })
})
