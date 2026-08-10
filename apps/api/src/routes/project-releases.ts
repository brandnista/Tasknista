import { createDb, projectReleases, projects, users } from '@seedoffice/db'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { getProjectPermissions } from '../lib/project-role'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

/**
 * Pronista §Version Release — แท็บ "Version Release" ต่อโปรเจกต์ (อยู่ต่อจาก "ประวัติเอกสาร")
 * สิทธิ์เข้าถึงคุมด้วย tabs.releases (มองเห็นแท็บ) + actions.release.{create,edit,delete} (ตำแหน่ง — ดู packages/core/permissions.ts)
 */
export const projectReleaseRoutes = new Hono<AppEnv>()

  .get('/projects/:id/releases', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const rows = await db
      .select({ release: projectReleases, createdByName: users.name })
      .from(projectReleases)
      .leftJoin(users, eq(projectReleases.createdBy, users.id))
      .where(eq(projectReleases.projectId, projectId))
      .orderBy(desc(projectReleases.sortOrder))
    return c.json({ releases: rows.map((r) => ({ ...r.release, createdByName: r.createdByName })) })
  })

  .post('/projects/:id/releases', teamOnly, async (c) => {
    const body = z
      .object({
        version: z.string().min(1).max(50),
        notes: z.string().max(20000).default(''),
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
          notes: d.notes,
          sortOrder: (last?.sortOrder ?? 0) + 1,
          createdBy: me.id,
        })
        .returning()
    )[0]!
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'project_release.create',
      entity: 'project',
      entityId: projectId,
      meta: { version: inserted.version },
    })
    return c.json(inserted, 201)
  })

  .patch('/releases/:id', teamOnly, async (c) => {
    const body = z
      .object({
        version: z.string().min(1).max(50).optional(),
        notes: z.string().max(20000).optional(),
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
        .set({
          ...(d.version !== undefined ? { version: d.version.trim() } : {}),
          ...(d.notes !== undefined ? { notes: d.notes } : {}),
        })
        .where(eq(projectReleases.id, release.id))
        .returning()
    )[0]!
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'project_release.edit',
      entity: 'project',
      entityId: release.projectId,
      meta: { version: updated.version },
    })
    return c.json(updated)
  })

  .delete('/releases/:id', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const release = (await db.select().from(projectReleases).where(eq(projectReleases.id, c.req.param('id'))).limit(1))[0]
    if (!release) return c.json({ error: 'not_found' }, 404)
    const permissions = await getProjectPermissions(db, release.projectId, me.id, me.role)
    if (!permissions.actions.release.delete) return c.json({ error: 'forbidden' }, 403)

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
