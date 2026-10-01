import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

// (2026-10-01) §D1 row-read quota — query หนักที่สุด 4 ตัวบน PRD ต้องค้นผ่าน index (ไม่ไล่อ่านทั้งตาราง)
// ถาม query plan ของ SQLite ตรงๆ: ถ้ามีคนแก้ query/ลบ index จนกลับไปไล่ทั้งตาราง เทสต์นี้จะล้ม
async function plan(sql: string, ...binds: unknown[]): Promise<string> {
  const res = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all<{ detail: string }>()
  return res.results.map((r) => r.detail).join(' | ')
}

describe('§D1 row-read quota — query plan ต้องใช้ index', () => {
  it('ประวัติกิจกรรมของงาน (audit_logs ค้นด้วย entity_id เรียงตามเวลา) ใช้ audit_entity_id_at_idx และไม่ต้องเรียงเพิ่ม', async () => {
    const p = await plan('SELECT id FROM audit_logs WHERE entity_id = ? ORDER BY at DESC LIMIT 50', 'x')
    expect(p).toContain('audit_entity_id_at_idx')
    expect(p).not.toContain('SCAN audit_logs')
    expect(p).not.toContain('TEMP B-TREE')
  })

  it('แจ้งเตือนของผู้ใช้ (user_id เรียงใหม่สุด limit) ใช้ notifications_user_created_idx และไม่ต้องเรียงเพิ่ม', async () => {
    const p = await plan('SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', 'x')
    expect(p).toContain('notifications_user_created_idx')
    expect(p).not.toContain('TEMP B-TREE')
  })

  it('งานรอตรวจของผู้ตรวจ (reviewer_id + status) ใช้ tasks_reviewer_idx', async () => {
    const p = await plan("SELECT id FROM tasks WHERE reviewer_id = ? AND status = 'waiting_for_test'", 'x')
    expect(p).toContain('tasks_reviewer_idx')
    expect(p).not.toContain('SCAN tasks')
  })

  it('งานย่อยของงานแม่ (parent_id) ใช้ tasks_parent_idx', async () => {
    const p = await plan('SELECT id FROM tasks WHERE parent_id = ? ORDER BY created_at ASC', 'x')
    expect(p).toContain('tasks_parent_idx')
    expect(p).not.toContain('SCAN tasks')
  })
})
