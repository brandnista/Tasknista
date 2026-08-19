import { createDb, changelogItemLinks, changelogItems, projectChangelogs, tasks, projects, users } from '@seedoffice/db'
import { CHANGELOG_CATEGORIES } from '@seedoffice/core'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { getProjectPermissions } from '../lib/project-role'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

/**
 * Pronista §Change Log (Internal) — แท็บ "Change Log" ต่อโปรเจกต์ (แยกจาก "Version Release" ที่เป็นมุมมองภายนอก)
 * สิทธิ์เข้าถึงคุมด้วย tabs.changeLog (มองเห็นแท็บ) + actions.changeLog.{create,edit,delete} (ตำแหน่ง — ดู packages/core/permissions.ts)
 * โครงสร้างมิเรอร์ project_releases/release_note_items/release_note_item_links เป๊ะ ต่างแค่ category เป็น enum คงที่ 5 ค่า แทน section แบบ freeform
 */
export const projectChangelogRoutes = new Hono<AppEnv>()

const itemInput = z.object({
  category: z.enum(CHANGELOG_CATEGORIES),
  text: z.string().min(1).max(2000),
  linkedTaskIds: z.array(z.string()).max(20).default([]),
})

/** เก็บเฉพาะ task/defect/cr ที่มีจริงในโปรเจกต์นี้ — กันลิงก์ข้ามโปรเจกต์หรือลิงก์ผิด kind (epic/story/backlog) เหมือน project-releases.ts */
async function filterValidLinkTargets(db: ReturnType<typeof createDb>, projectId: string, ids: string[]) {
  if (ids.length === 0) return new Set<string>()
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(inArray(tasks.id, ids), eq(tasks.projectId, projectId), inArray(tasks.kind, ['task', 'defect', 'cr'])))
  return new Set(rows.map((r) => r.id))
}

/** แทนที่ items เดิมของ changelog ทั้งชุด (ลบ links→items เก่าก่อน กัน FK ค้าง) แล้วสร้างใหม่ตามลำดับที่ส่งมา */
async function replaceItems(
  db: ReturnType<typeof createDb>,
  projectId: string,
  changelogId: string,
  items: z.infer<typeof itemInput>[],
) {
  const oldItemIds = (
    await db.select({ id: changelogItems.id }).from(changelogItems).where(eq(changelogItems.changelogId, changelogId))
  ).map((r) => r.id)
  if (oldItemIds.length > 0) {
    await db.delete(changelogItemLinks).where(inArray(changelogItemLinks.itemId, oldItemIds))
    await db.delete(changelogItems).where(eq(changelogItems.changelogId, changelogId))
  }
  if (items.length === 0) return

  const allLinkIds = [...new Set(items.flatMap((it) => it.linkedTaskIds))]
  const validIds = await filterValidLinkTargets(db, projectId, allLinkIds)

  const insertedItems = await db
    .insert(changelogItems)
    .values(
      items.map((it, i) => ({
        changelogId,
        category: it.category,
        text: it.text.trim(),
        sortOrder: i,
      })),
    )
    .returning()

  const linkRows = items.flatMap((it, i) =>
    it.linkedTaskIds.filter((tid) => validIds.has(tid)).map((taskId) => ({ itemId: insertedItems[i]!.id, taskId })),
  )
  if (linkRows.length > 0) await db.insert(changelogItemLinks).values(linkRows)
}

/** โหลด items+linkedTasks ของหลาย changelog พร้อมกัน (แทน N+1 query) */
async function loadItemsForChangelogs(db: ReturnType<typeof createDb>, changelogIds: string[]) {
  type Item = { id: string; category: string; text: string; sortOrder: number; linkedTasks: { id: string; code: string | null; title: string; kind: string }[] }
  if (changelogIds.length === 0) return new Map<string, Item[]>()

  const items = await db
    .select()
    .from(changelogItems)
    .where(inArray(changelogItems.changelogId, changelogIds))
    .orderBy(asc(changelogItems.sortOrder))
  const itemIds = items.map((it) => it.id)
  const links = itemIds.length
    ? await db
        .select({ itemId: changelogItemLinks.itemId, id: tasks.id, code: tasks.code, title: tasks.title, kind: tasks.kind })
        .from(changelogItemLinks)
        .innerJoin(tasks, eq(tasks.id, changelogItemLinks.taskId))
        .where(inArray(changelogItemLinks.itemId, itemIds))
    : []
  const linksByItem = new Map<string, { id: string; code: string | null; title: string; kind: string }[]>()
  for (const l of links) {
    const arr = linksByItem.get(l.itemId) ?? []
    arr.push({ id: l.id, code: l.code, title: l.title, kind: l.kind })
    linksByItem.set(l.itemId, arr)
  }
  const result = new Map<string, Item[]>()
  for (const it of items) {
    const arr = result.get(it.changelogId) ?? []
    arr.push({ id: it.id, category: it.category, text: it.text, sortOrder: it.sortOrder, linkedTasks: linksByItem.get(it.id) ?? [] })
    result.set(it.changelogId, arr)
  }
  return result
}

projectChangelogRoutes

  .get('/projects/:id/changelogs', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const rows = await db
      .select({ changelog: projectChangelogs, createdByName: users.name })
      .from(projectChangelogs)
      .leftJoin(users, eq(projectChangelogs.createdBy, users.id))
      .where(eq(projectChangelogs.projectId, projectId))
      .orderBy(desc(projectChangelogs.sortOrder))
    const itemsByChangelog = await loadItemsForChangelogs(db, rows.map((r) => r.changelog.id))
    return c.json({
      changelogs: rows.map((r) => ({ ...r.changelog, createdByName: r.createdByName, items: itemsByChangelog.get(r.changelog.id) ?? [] })),
    })
  })

  .post('/projects/:id/changelogs', teamOnly, async (c) => {
    const body = z
      .object({
        title: z.string().min(1).max(200),
        entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
    if (!permissions.actions.changeLog.create) return c.json({ error: 'forbidden' }, 403)

    const last = (
      await db
        .select({ sortOrder: projectChangelogs.sortOrder, changelogNo: projectChangelogs.changelogNo })
        .from(projectChangelogs)
        .where(eq(projectChangelogs.projectId, projectId))
        .orderBy(desc(projectChangelogs.sortOrder))
        .limit(1)
    )[0]
    const inserted = (
      await db
        .insert(projectChangelogs)
        .values({
          projectId,
          changelogNo: (last?.changelogNo ?? 0) + 1,
          title: d.title.trim(),
          entryDate: d.entryDate,
          sortOrder: (last?.sortOrder ?? 0) + 1,
          createdBy: me.id,
        })
        .returning()
    )[0]!
    await replaceItems(db, projectId, inserted.id, d.items)
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'project_changelog.create',
      entity: 'project',
      entityId: projectId,
      meta: { title: inserted.title, changelogNo: inserted.changelogNo },
    })
    const itemsByChangelog = await loadItemsForChangelogs(db, [inserted.id])
    return c.json({ ...inserted, items: itemsByChangelog.get(inserted.id) ?? [] }, 201)
  })

  .patch('/changelogs/:id', teamOnly, async (c) => {
    const body = z
      .object({
        title: z.string().min(1).max(200).optional(),
        entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        items: z.array(itemInput).max(200).optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const changelog = (await db.select().from(projectChangelogs).where(eq(projectChangelogs.id, c.req.param('id'))).limit(1))[0]
    if (!changelog) return c.json({ error: 'not_found' }, 404)
    const permissions = await getProjectPermissions(db, changelog.projectId, me.id, me.role)
    if (!permissions.actions.changeLog.edit) return c.json({ error: 'forbidden' }, 403)

    const d = body.data
    const updated = (
      await db
        .update(projectChangelogs)
        .set({
          ...(d.title !== undefined ? { title: d.title.trim() } : {}),
          ...(d.entryDate !== undefined ? { entryDate: d.entryDate } : {}),
        })
        .where(eq(projectChangelogs.id, changelog.id))
        .returning()
    )[0]!
    if (d.items !== undefined) await replaceItems(db, changelog.projectId, changelog.id, d.items)
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'project_changelog.edit',
      entity: 'project',
      entityId: changelog.projectId,
      meta: { title: updated.title, changelogNo: updated.changelogNo },
    })
    const itemsByChangelog = await loadItemsForChangelogs(db, [updated.id])
    return c.json({ ...updated, items: itemsByChangelog.get(updated.id) ?? [] })
  })

  .delete('/changelogs/:id', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const changelog = (await db.select().from(projectChangelogs).where(eq(projectChangelogs.id, c.req.param('id'))).limit(1))[0]
    if (!changelog) return c.json({ error: 'not_found' }, 404)
    const permissions = await getProjectPermissions(db, changelog.projectId, me.id, me.role)
    if (!permissions.actions.changeLog.delete) return c.json({ error: 'forbidden' }, 403)

    const itemIds = (
      await db.select({ id: changelogItems.id }).from(changelogItems).where(eq(changelogItems.changelogId, changelog.id))
    ).map((r) => r.id)
    if (itemIds.length > 0) {
      await db.delete(changelogItemLinks).where(inArray(changelogItemLinks.itemId, itemIds))
      await db.delete(changelogItems).where(eq(changelogItems.changelogId, changelog.id))
    }
    await db.delete(projectChangelogs).where(eq(projectChangelogs.id, changelog.id))
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'project_changelog.delete',
      entity: 'project',
      entityId: changelog.projectId,
      meta: { title: changelog.title, changelogNo: changelog.changelogNo },
    })
    return c.json({ ok: true })
  })

