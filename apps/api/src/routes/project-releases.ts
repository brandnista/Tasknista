import { createDb, projectReleases, releaseNoteItemLinks, releaseNoteItems, tasks, projects, users } from '@seedoffice/db'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { getProjectPermissions } from '../lib/project-role'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

/**
 * Pronista §Version Release — แท็บ "Version Release" ต่อโปรเจกต์ (อยู่ต่อจาก "ประวัติเอกสาร")
 * สิทธิ์เข้าถึงคุมด้วย tabs.releases (มองเห็นแท็บ) + actions.release.{create,edit,delete} (ตำแหน่ง — ดู packages/core/permissions.ts)
 * รายละเอียดแตกเป็นรายบรรทัด (release_note_items) แทน markdown blob เดิม ให้แต่ละบรรทัดเชื่อมโยง Task/Defect ได้ (release_note_item_links)
 */
export const projectReleaseRoutes = new Hono<AppEnv>()

const itemInput = z.object({
  section: z.string().max(200).trim().optional(),
  text: z.string().min(1).max(2000),
  linkedTaskIds: z.array(z.string()).max(20).default([]),
})

/** เก็บเฉพาะ task/defect ที่มีจริงในโปรเจกต์นี้ — กันลิงก์ข้ามโปรเจกต์หรือลิงก์ผิด kind (epic/story/cr/backlog) */
async function filterValidLinkTargets(db: ReturnType<typeof createDb>, projectId: string, ids: string[]) {
  if (ids.length === 0) return new Set<string>()
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(inArray(tasks.id, ids), eq(tasks.projectId, projectId), inArray(tasks.kind, ['task', 'defect'])))
  return new Set(rows.map((r) => r.id))
}

/** แทนที่ items เดิมของ release ทั้งชุด (ลบ links→items เก่าก่อน กัน FK ค้าง) แล้วสร้างใหม่ตามลำดับที่ส่งมา */
async function replaceItems(
  db: ReturnType<typeof createDb>,
  projectId: string,
  releaseId: string,
  items: z.infer<typeof itemInput>[],
) {
  const oldItemIds = (await db.select({ id: releaseNoteItems.id }).from(releaseNoteItems).where(eq(releaseNoteItems.releaseId, releaseId))).map(
    (r) => r.id,
  )
  if (oldItemIds.length > 0) {
    await db.delete(releaseNoteItemLinks).where(inArray(releaseNoteItemLinks.itemId, oldItemIds))
    await db.delete(releaseNoteItems).where(eq(releaseNoteItems.releaseId, releaseId))
  }
  if (items.length === 0) return

  const allLinkIds = [...new Set(items.flatMap((it) => it.linkedTaskIds))]
  const validIds = await filterValidLinkTargets(db, projectId, allLinkIds)

  const insertedItems = await db
    .insert(releaseNoteItems)
    .values(
      items.map((it, i) => ({
        releaseId,
        section: it.section || null,
        text: it.text.trim(),
        sortOrder: i,
      })),
    )
    .returning()

  const linkRows = items.flatMap((it, i) =>
    it.linkedTaskIds.filter((tid) => validIds.has(tid)).map((taskId) => ({ itemId: insertedItems[i]!.id, taskId })),
  )
  if (linkRows.length > 0) await db.insert(releaseNoteItemLinks).values(linkRows)
}

/** โหลด items+linkedTasks ของหลาย release พร้อมกัน (แทน N+1 query) */
async function loadItemsForReleases(db: ReturnType<typeof createDb>, releaseIds: string[]) {
  if (releaseIds.length === 0) return new Map<string, { id: string; section: string | null; text: string; sortOrder: number; linkedTasks: { id: string; code: string | null; title: string; kind: string }[] }[]>()

  const items = await db
    .select()
    .from(releaseNoteItems)
    .where(inArray(releaseNoteItems.releaseId, releaseIds))
    .orderBy(asc(releaseNoteItems.sortOrder))
  const itemIds = items.map((it) => it.id)
  const links = itemIds.length
    ? await db
        .select({ itemId: releaseNoteItemLinks.itemId, id: tasks.id, code: tasks.code, title: tasks.title, kind: tasks.kind })
        .from(releaseNoteItemLinks)
        .innerJoin(tasks, eq(tasks.id, releaseNoteItemLinks.taskId))
        .where(inArray(releaseNoteItemLinks.itemId, itemIds))
    : []
  const linksByItem = new Map<string, { id: string; code: string | null; title: string; kind: string }[]>()
  for (const l of links) {
    const arr = linksByItem.get(l.itemId) ?? []
    arr.push({ id: l.id, code: l.code, title: l.title, kind: l.kind })
    linksByItem.set(l.itemId, arr)
  }
  const result = new Map<string, { id: string; section: string | null; text: string; sortOrder: number; linkedTasks: { id: string; code: string | null; title: string; kind: string }[] }[]>()
  for (const it of items) {
    const arr = result.get(it.releaseId) ?? []
    arr.push({ id: it.id, section: it.section, text: it.text, sortOrder: it.sortOrder, linkedTasks: linksByItem.get(it.id) ?? [] })
    result.set(it.releaseId, arr)
  }
  return result
}

projectReleaseRoutes

  .get('/projects/:id/releases', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const rows = await db
      .select({ release: projectReleases, createdByName: users.name })
      .from(projectReleases)
      .leftJoin(users, eq(projectReleases.createdBy, users.id))
      .where(eq(projectReleases.projectId, projectId))
      .orderBy(desc(projectReleases.sortOrder))
    const itemsByRelease = await loadItemsForReleases(db, rows.map((r) => r.release.id))
    return c.json({
      releases: rows.map((r) => ({ ...r.release, createdByName: r.createdByName, items: itemsByRelease.get(r.release.id) ?? [] })),
    })
  })

  .post('/projects/:id/releases', teamOnly, async (c) => {
    const body = z
      .object({
        version: z.string().min(1).max(50),
        items: z.array(itemInput).max(200).default([]),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const d = body.data
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const projectId = c.req.param('id')
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)
    const permissions = await getProjectPermissions(db, projectId, me.id, me.role)
    if (!permissions.actions.release.create) return c.json({ error: 'forbidden' }, 403)

    const last = (
      await db
        .select({ sortOrder: projectReleases.sortOrder })
        .from(projectReleases)
        .where(eq(projectReleases.projectId, projectId))
        .orderBy(desc(projectReleases.sortOrder))
        .limit(1)
    )[0]
    const inserted = (
      await db
        .insert(projectReleases)
        .values({
          projectId,
          version: d.version.trim(),
          sortOrder: (last?.sortOrder ?? 0) + 1,
          createdBy: me.id,
        })
        .returning()
    )[0]!
    await replaceItems(db, projectId, inserted.id, d.items)
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'project_release.create',
      entity: 'project',
      entityId: projectId,
      meta: { version: inserted.version },
    })
    const itemsByRelease = await loadItemsForReleases(db, [inserted.id])
    return c.json({ ...inserted, items: itemsByRelease.get(inserted.id) ?? [] }, 201)
  })

  .patch('/releases/:id', teamOnly, async (c) => {
    const body = z
      .object({
        version: z.string().min(1).max(50).optional(),
        items: z.array(itemInput).max(200).optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const release = (await db.select().from(projectReleases).where(eq(projectReleases.id, c.req.param('id'))).limit(1))[0]
    if (!release) return c.json({ error: 'not_found' }, 404)
    const permissions = await getProjectPermissions(db, release.projectId, me.id, me.role)
    if (!permissions.actions.release.edit) return c.json({ error: 'forbidden' }, 403)

    const d = body.data
    const updated = (
      await db
        .update(projectReleases)
        .set({ ...(d.version !== undefined ? { version: d.version.trim() } : {}) })
        .where(eq(projectReleases.id, release.id))
        .returning()
    )[0]!
    if (d.items !== undefined) await replaceItems(db, release.projectId, release.id, d.items)
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'project_release.edit',
      entity: 'project',
      entityId: release.projectId,
      meta: { version: updated.version },
    })
    const itemsByRelease = await loadItemsForReleases(db, [updated.id])
    return c.json({ ...updated, items: itemsByRelease.get(updated.id) ?? [] })
  })

  .delete('/releases/:id', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const release = (await db.select().from(projectReleases).where(eq(projectReleases.id, c.req.param('id'))).limit(1))[0]
    if (!release) return c.json({ error: 'not_found' }, 404)
    const permissions = await getProjectPermissions(db, release.projectId, me.id, me.role)
    if (!permissions.actions.release.delete) return c.json({ error: 'forbidden' }, 403)

    const itemIds = (await db.select({ id: releaseNoteItems.id }).from(releaseNoteItems).where(eq(releaseNoteItems.releaseId, release.id))).map(
      (r) => r.id,
    )
    if (itemIds.length > 0) {
      await db.delete(releaseNoteItemLinks).where(inArray(releaseNoteItemLinks.itemId, itemIds))
      await db.delete(releaseNoteItems).where(eq(releaseNoteItems.releaseId, release.id))
    }
    await db.delete(projectReleases).where(eq(projectReleases.id, release.id))
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'project_release.delete',
      entity: 'project',
      entityId: release.projectId,
      meta: { version: release.version },
    })
    return c.json({ ok: true })
  })
