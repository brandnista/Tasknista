/** Pronista §PRO-0024 — @mention ในคอมเมนต์งาน
 *  เก็บเป็นลิงก์ Markdown ธรรมดา `[@ชื่อ](/mention/<userId>)` (ไม่สร้างโหนดชนิดใหม่) — โหลดกลับเข้า editor ได้เองเพราะเป็นลิงก์ปกติ
 *  ฝั่งเซิร์ฟเวอร์แกะรายชื่อจากเนื้อหาเอง ไม่เชื่อรายชื่อที่ client ส่งมา */
export const MENTION_PATH_PREFIX = '/mention/'
const MAX_MENTIONS = 20

/** สร้างลิงก์ mention (ชื่อที่มี [ ] ถูกแปลงเป็น ( ) กันทำลายโครง Markdown) */
export function mentionMarkdown(userId: string, name: string): string {
  return `[@${name.replace(/\[/g, '(').replace(/\]/g, ')')}](${MENTION_PATH_PREFIX}${userId})`
}

/** userId ที่ถูกแท็กในเนื้อหา (ไม่ซ้ำ ตามลำดับที่เจอ จำกัดจำนวนกันสแปม) */
export function extractMentionedUserIds(markdown: string): string[] {
  const ids: string[] = []
  const re = /\]\(\/mention\/([A-Za-z0-9_-]{1,64})\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    if (!ids.includes(m[1]!)) ids.push(m[1]!)
    if (ids.length >= MAX_MENTIONS) break
  }
  return ids
}
