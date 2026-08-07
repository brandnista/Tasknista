import { resolveLabels, resolvePresets, resolveStatuses } from '@seedoffice/core'
import { companyConfig, createDb, users } from '@seedoffice/db'
import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppEnv } from '../types'

/** routes ที่ทุก role ใช้ (ติด requireAuth ตอน mount) */
export const userRoutes = new Hono<AppEnv>()

  // รายชื่อ user active — ใช้กับ assignee picker (ไม่มีข้อมูลเงิน)
  .get('/users', async (c) => {
    const db = createDb(c.env.DB)
    const list = await db
      .select({ id: users.id, name: users.name, role: users.role, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.status, 'active'))
      .orderBy(asc(users.name))
    return c.json(list)
  })

  // config บริษัท (เพดานชั่วโมง/วันตัดรอบ) — ทุก role ใช้แสดงผล/ค่า timer
  // เลือกคอลัมน์ชัดเจน: ห้ามส่ง icsToken (token ลับ ICS feed) ออกให้ทุก role — เห็นได้เฉพาะ owner
  .get('/config', async (c) => {
    const db = createDb(c.env.DB)
    const cfg = (
      await db
        .select({
          id: companyConfig.id,
          cutoffDay: companyConfig.cutoffDay,
          workHourCapMinutes: companyConfig.workHourCapMinutes,
          memberDomain: companyConfig.memberDomain,
          projectStatuses: companyConfig.projectStatuses,
          productStatuses: companyConfig.productStatuses,
          boardPresets: companyConfig.boardPresets,
          labels: companyConfig.labels,
        })
        .from(companyConfig)
        .limit(1)
    )[0]
    if (!cfg) return c.json({ error: 'config_missing' }, 500)
    // null = ยังไม่ตั้ง → คืน default (ทุก role ใช้ render chip/filter) · 2 ชุดตาม category (Pronista §F1)
    return c.json({
      ...cfg,
      projectStatuses: resolveStatuses(cfg.projectStatuses),
      productStatuses: resolveStatuses(cfg.productStatuses),
      boardPresets: resolvePresets(cfg.boardPresets), // Pronista §Sprint & Board
      labels: resolveLabels(cfg.labels), // Pronista §Workspace
    })
  })
