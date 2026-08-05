import { createDb, docLinks, docs, externalDocumentLogs, externalDocumentLogSowTasks, projects, tasks, users } from '@seedoffice/db'
import { and, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { canEditProject, getProjectRole } from '../lib/project-role'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

/**
 * Pronista §External Document Version Logging — log เวอร์ชันเอกสารภายนอก (เช่น เล่ม UI Design บน Canva) ต่อโปรเจกต์
 * append-only: อัปเดตเวอร์ชัน = POST เพิ่มแถวใหม่เสมอ (ดูประวัติย้อนหลังได้) · ผูก SOW Task ผ่าน pivot เพื่อทำ Traceability ฝั่งธุรกิจ
 * แสดงในแท็บ "External Design Assets" ของหน้าโปรเจกต์ (ExternalDesignAssetsSection.tsx)
 */
export const externalDocLogRoutes = new Hono<AppEnv>()

  // Pronista §Document Version History — หน้า "ประวัติเอกสาร": เอกสารภายในทุกประเภท (MOM/BRD/SOW/SRS/PEP/UIR) ทุกโปรเจกต์
  // คืน doc ที่ผูกโปรเจกต์ (ไม่รวมโฟลเดอร์) พร้อมเลขที่เอกสาร(เล่ม)+เวอร์ชัน → frontend จัดกลุ่ม โปรเจกต์→ประเภท→เล่ม→เวอร์ชัน
  .get('/document-history', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db
      .select({
        id: docs.id,
        title: docs.title,
        kind: docs.kind,
        docType: docs.docType,
        docNumber: docs.docNumber,
        docVersion: docs.docVersion,
        templateDocNumber: docs.templateDocNumber,
        updatedAt: docs.updatedAt,
        createdAt: docs.createdAt,
        updatedBy: docs.updatedBy,
        createdBy: docs.createdBy,
      })
      .from(docs)
      .where(and(isNull(docs.deletedAt), ne(docs.kind, 'folder')))
      .orderBy(desc(docs.updatedAt))

    // โปรเจกต์แรกที่แต่ละ doc ผูกไว้ (1 doc อาจผูกหลายโปรเจกต์ — เอาอันแรกพอ เหมือน docs.ts GET /)
    const projectLinks = await db
      .select({ docId: docLinks.docId, projectId: projects.id, projectName: projects.name })
      .from(docLinks)
      .innerJoin(projects, eq(docLinks.projectId, projects.id))
      .where(isNotNull(docLinks.projectId))
    const projectOf = new Map<string, { id: string; name: string }>()
    for (const l of projectLinks) if (!projectOf.has(l.docId)) projectOf.set(l.docId, { id: l.projectId, name: l.projectName })

    const nameRows = await db.select({ id: users.id, name: users.name }).from(users)
    const nameOf = new Map(nameRows.map((u) => [u.id, u.name]))

    // เอาเฉพาะ doc ที่ผูกโปรเจกต์ (ประวัติเอกสารตามโปรเจกต์)
    const docsOut = rows
      .filter((r) => projectOf.has(r.id))
      .map((r) => {
        const proj = projectOf.get(r.id)!
        return {
          id: r.id,
          title: r.title,
          kind: r.kind,
          docType: r.docType,
          docNumber: r.docNumber ?? r.templateDocNumber ?? null,
          docVersion: r.docVersion,
          projectId: proj.id,
          projectName: proj.name,
          updatedByName: nameOf.get(r.updatedBy) ?? null,
          uploaderName: nameOf.get(r.createdBy) ?? null,
          updatedAt: r.updatedAt,
          createdAt: r.createdAt,
        }
      })
    return c.json({ docs: docsOut })
  })

  // Pronista §Document Management MVP — หน้า "ประวัติเอกสาร" ในเมนูหลัก: log ทุกโปรเจกต์รวมกัน (ต่างจาก endpoint ด้านล่างที่ผูก project เดียว)
  .get('/external-doc-logs', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const reviewer = alias(users, 'reviewer')
    const rows = await db
      .select({
        log: externalDocumentLogs,
        createdByName: users.name,
        reviewedByName: reviewer.name,
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(externalDocumentLogs)
      .innerJoin(projects, eq(externalDocumentLogs.projectId, projects.id))
      .leftJoin(users, eq(externalDocumentLogs.createdBy, users.id))
      .leftJoin(reviewer, eq(externalDocumentLogs.reviewedBy, reviewer.id))
      .orderBy(desc(externalDocumentLogs.createdAt))

    const logIds = rows.map((r) => r.log.id)
    const links =
      logIds.length === 0
        ? []
        : await db
            .select({ logId: externalDocumentLogSowTasks.logId, taskId: tasks.id, code: tasks.code, originCode: tasks.originCode, title: tasks.title })
            .from(externalDocumentLogSowTasks)
            .innerJoin(tasks, eq(externalDocumentLogSowTasks.taskId, tasks.id))
            .where(inArray(externalDocumentLogSowTasks.logId, logIds))

    return c.json({
      logs: rows.map((r) => ({
        ...r.log,
        createdByName: r.createdByName,
        reviewedByName: r.reviewedByName,
        projectId: r.projectId,
        projectName: r.projectName,
        relatedSowTasks: links.filter((l) => l.logId === r.log.id).map(({ taskId, code, originCode, title }) => ({ id: taskId, code, originCode, title })),
      })),
    })
  })

  .get('/projects/:id/external-doc-logs', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const reviewer = alias(users, 'reviewer')
    const rows = await db
      .select({ log: externalDocumentLogs, createdByName: users.name, reviewedByName: reviewer.name })
      .from(externalDocumentLogs)
      .leftJoin(users, eq(externalDocumentLogs.createdBy, users.id))
      .leftJoin(reviewer, eq(externalDocumentLogs.reviewedBy, reviewer.id))
      .where(eq(externalDocumentLogs.projectId, projectId))
      .orderBy(desc(externalDocumentLogs.createdAt))

    const logIds = rows.map((r) => r.log.id)
    const links =
      logIds.length === 0
        ? []
        : await db
            .select({ logId: externalDocumentLogSowTasks.logId, taskId: tasks.id, code: tasks.code, originCode: tasks.originCode, title: tasks.title })
            .from(externalDocumentLogSowTasks)
            .innerJoin(tasks, eq(externalDocumentLogSowTasks.taskId, tasks.id))
            .where(inArray(externalDocumentLogSowTasks.logId, logIds))

    // ตัวเลือก SOW Task ของโปรเจกต์ (ใช้ใน modal เพิ่มเวอร์ชัน) — ทุก Task ที่แตกจากเอกสาร SOW ไม่ว่าอยู่ Backlog/บอร์ด/Sprint
    const sowTaskOptions = await db
      .select({ id: tasks.id, code: tasks.code, originCode: tasks.originCode, title: tasks.title })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.originDocType, 'SOW')))

    return c.json({
      logs: rows.map((r) => ({
        ...r.log,
        createdByName: r.createdByName,
        reviewedByName: r.reviewedByName,
        relatedSowTasks: links.filter((l) => l.logId === r.log.id).map(({ taskId, code, originCode, title }) => ({ id: taskId, code, originCode, title })),
      })),
      sowTaskOptions,
    })
  })

  // เพิ่ม log เวอร์ชันใหม่ (append-only — ไม่มี endpoint แก้ไขทับ ตามสเปค: ดูประวัติย้อนหลังได้เสมอ)
  .post('/projects/:id/external-doc-logs', teamOnly, async (c) => {
    const body = z
      .object({
        documentName: z.string().min(1).max(200),
        externalUrl: z.string().url().max(2000),
        version: z.string().min(1).max(50),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        createdBy: z.string().min(1), // ผู้จัดทำ — เลือกจากฟอร์ม
        reviewedBy: z.string().nullable().optional(),
        status: z.enum(['draft', 'under_review', 'approved']).default('draft'),
        relatedTaskIds: z.array(z.string()).default([]),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const d = body.data
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const projectId = c.req.param('id')
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)
    if (!canEditProject(await getProjectRole(db, projectId, me.id, me.role))) return c.json({ error: 'forbidden' }, 403)

    // รายการ SOW ที่ผูกต้องเป็น Task ของโปรเจกต์นี้ + มาจากเอกสาร SOW จริง (กันผูกข้ามโปรเจกต์/ข้ามประเภท)
    let validTaskIds: string[] = []
    if (d.relatedTaskIds.length > 0) {
      const found = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), eq(tasks.originDocType, 'SOW'), inArray(tasks.id, d.relatedTaskIds)))
      validTaskIds = found.map((t) => t.id)
      if (validTaskIds.length !== d.relatedTaskIds.length)
        return c.json({ error: 'invalid_sow_tasks', message: 'มีรายการ SOW ที่ไม่อยู่ในโปรเจกต์นี้หรือไม่ได้มาจากเอกสาร SOW' }, 400)
    }

    const inserted = (
      await db
        .insert(externalDocumentLogs)
        .values({
          projectId,
          documentName: d.documentName.trim(),
          externalUrl: d.externalUrl,
          version: d.version.trim(),
          startDate: d.startDate ?? null,
          endDate: d.endDate ?? null,
          createdBy: d.createdBy,
          reviewedBy: d.reviewedBy ?? null,
          status: d.status,
        })
        .returning()
    )[0]!
    for (const taskId of validTaskIds) {
      await db.insert(externalDocumentLogSowTasks).values({ logId: inserted.id, taskId }).onConflictDoNothing()
    }
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'external_doc_log.create',
      entity: 'project',
      entityId: projectId,
      meta: { documentName: inserted.documentName, version: inserted.version, status: inserted.status, sowTaskCount: validTaskIds.length },
    })
    return c.json(inserted, 201)
  })

  // ลบแถว log (ไว้แก้กรณีกรอกผิด — ไม่ใช่การแก้ไขประวัติ) — editor ของโปรเจกต์/owner เท่านั้น
  .delete('/external-doc-logs/:id', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const log = (await db.select().from(externalDocumentLogs).where(eq(externalDocumentLogs.id, c.req.param('id'))).limit(1))[0]
    if (!log) return c.json({ error: 'not_found' }, 404)
    if (!canEditProject(await getProjectRole(db, log.projectId, me.id, me.role))) return c.json({ error: 'forbidden' }, 403)
    await db.delete(externalDocumentLogSowTasks).where(eq(externalDocumentLogSowTasks.logId, log.id))
    await db.delete(externalDocumentLogs).where(eq(externalDocumentLogs.id, log.id))
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'external_doc_log.delete',
      entity: 'project',
      entityId: log.projectId,
      meta: { documentName: log.documentName, version: log.version },
    })
    return c.json({ ok: true })
  })
