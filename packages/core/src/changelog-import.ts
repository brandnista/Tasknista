import { CHANGELOG_CATEGORIES, type ChangelogCategory } from './changelog'

/**
 * Pronista §Import Changelog จากไฟล์ .md — parse ไฟล์สรุป changelog ที่ทีมเขียนกันอยู่แล้ว (heading วันที่ + หมวดย่อย ## + bullet list)
 * ให้เติมฟอร์ม ChangelogForm อัตโนมัติ แทนคีย์มือทีละบรรทัด — pure function ล้วนๆ (ไม่แตะ Date.now เอง รับ `today` จาก caller)
 */

export interface ParsedChangelogItem {
  category: ChangelogCategory | null // null = จับหมวดจาก heading ไม่ได้ ต้องให้ผู้ใช้เลือกเองใน review step
  categoryGuess: string | null // raw heading text ที่ทายมา (โชว์ใน warning เวลา category เป็น null)
  text: string
}

export interface ParsedChangelog {
  title: string
  entryDate: string // YYYY-MM-DD
  items: ParsedChangelogItem[]
  warnings: string[]
}

const CATEGORY_KEYWORDS: Record<ChangelogCategory, string[]> = {
  backoffice: ['หลังบ้าน', 'back-office', 'backoffice', 'admin'],
  frontend: ['หน้าบ้าน', 'frontend', 'front-end', 'mobile'],
  api: ['api'],
  cron: ['cron', 'scheduled'],
  database: ['database', 'db', 'ฐานข้อมูล'],
}

function matchCategory(heading: string): ChangelogCategory | null {
  const lower = heading.toLowerCase()
  for (const cat of CHANGELOG_CATEGORIES) {
    if (CATEGORY_KEYWORDS[cat].some((kw) => lower.includes(kw.toLowerCase()))) return cat
  }
  return null
}

// ลอกสัญลักษณ์ markdown ที่ renderer เดิมไม่รองรับ (ไม่มี markdown rendering) — code ก่อน (กัน ** ข้างในโดนกินไปก่อน) แล้วค่อย bold แล้ว italic
function stripDecoration(s: string): string {
  return s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .trim()
}

function isValidISODate(s: string): boolean {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

export function parseChangelogMarkdown(markdown: string, today: string): ParsedChangelog {
  const lines = markdown.split(/\r?\n/)

  let title = ''
  let titleFound = false
  let entryDate = today
  let currentCategory: ChangelogCategory | null = null
  let currentCategoryGuess: string | null = null
  let pendingLabel: string | null = null
  let inCodeBlock = false
  let codeBlockLines: string[] = []

  const items: ParsedChangelogItem[] = []
  const warnings: string[] = []
  const warnedHeadings = new Set<string>()

  for (const rawLine of lines) {
    // fence เปิด/ปิด code block — เนื้อในเป็น literal ไม่ลอก decoration
    if (rawLine.trim().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeBlockLines = []
      } else {
        inCodeBlock = false
        const content = codeBlockLines.join('\n')
        const text = pendingLabel ? `${pendingLabel}:\n${content}` : content
        items.push({ category: currentCategory, categoryGuess: currentCategoryGuess, text })
        pendingLabel = null
      }
      continue
    }
    if (inCodeBlock) {
      codeBlockLines.push(rawLine)
      continue
    }

    const trimmed = rawLine.trim()
    if (trimmed === '') continue
    if (/^-{3,}$/.test(trimmed)) continue // เส้นคั่น --- ไม่ใช่เนื้อหา

    if (!titleFound && /^#\s+/.test(trimmed)) {
      title = trimmed.replace(/^#\s+/, '').trim()
      titleFound = true
      const dateMatch = title.match(/\d{4}-\d{2}-\d{2}/)
      if (dateMatch && isValidISODate(dateMatch[0])) entryDate = dateMatch[0]
      continue
    }

    const headingMatch = trimmed.match(/^##\s+(.+)$/)
    if (headingMatch) {
      const headingText = headingMatch[1]!.trim()
      currentCategoryGuess = headingText
      currentCategory = matchCategory(headingText)
      if (!currentCategory && !warnedHeadings.has(headingText)) {
        warnings.push(`ไม่รู้จักหมวด "${headingText}" — ต้องเลือกหมวดเอง`)
        warnedHeadings.add(headingText)
      }
      continue
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/)
    if (bulletMatch) {
      items.push({ category: currentCategory, categoryGuess: currentCategoryGuess, text: stripDecoration(bulletMatch[1]!) })
      pendingLabel = null
      continue
    }

    // บรรทัด **label**: เดี่ยวๆ (ไม่มีเนื้อหาอื่น) — เก็บไว้รอ ยังไม่สร้าง bullet จนกว่าจะเจอ code block ถัดไป
    const labelMatch = trimmed.match(/^\*\*([^*]+)\*\*:?\s*$/)
    if (labelMatch) {
      pendingLabel = labelMatch[1]!.trim()
      continue
    }

    // บรรทัดต่อท้ายโดยไม่ขึ้น "- " ใหม่ — ต่อเข้า text ของ bullet ล่าสุด
    if (items.length > 0) {
      items[items.length - 1]!.text += `\n${stripDecoration(trimmed)}`
    }
  }

  return { title, entryDate, items, warnings }
}
