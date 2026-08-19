/**
 * Pronista §Change Log (Internal) — 5 หมวดคงที่ต่อ changelog entry (ตรงข้ามกับ release_note_items.section ที่เป็น freeform header)
 * ลำดับตาม CHANGELOG_CATEGORIES คือลำดับแสดงผลเสมอ (หลังบ้าน → หน้าบ้าน → API → Cron Job → Database)
 */
export const CHANGELOG_CATEGORIES = ['backoffice', 'frontend', 'api', 'cron', 'database'] as const
export type ChangelogCategory = (typeof CHANGELOG_CATEGORIES)[number]

export const CHANGELOG_CATEGORY_LABEL: Record<ChangelogCategory, string> = {
  backoffice: 'หลังบ้าน (Admin / Back-office)',
  frontend: 'หน้าบ้าน (Frontend: Desktop + Mobile)',
  api: 'API',
  cron: 'Cron Job',
  database: 'Database',
}

export function isChangelogCategory(v: string): v is ChangelogCategory {
  return (CHANGELOG_CATEGORIES as readonly string[]).includes(v)
}
