import type { DocTemplateDef, FieldsSectionDef, ListSectionDef, TableSectionDef, TemplateData } from '@seedoffice/core'
import { BorderStyle, Document, Header, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { BRAND_BLUE, BRAND_BLUE_LIGHT, BRAND_LOGO_HEIGHT, BRAND_LOGO_URL, BRAND_LOGO_WIDTH } from './brand'

/**
 * Tasknista §Document Template — สร้าง .docx จาก SectionDef[] + ข้อมูลที่กรอกจริง ล้วนๆ ฝั่ง client (ไม่แตะ apps/api เลย)
 * Generic 100% ขับด้วย section.kind — เพิ่ม template ใหม่ (SRS) ใช้ไฟล์นี้ได้เลยไม่ต้องแก้ (ไม่มีโค้ดเฉพาะ MOM ที่นี่)
 * ธีมแบรนด์ (logo + สี) ล้อไฟล์ต้นแบบจริง BNT_Template_01_MOM_v3.docx — ใช้ร่วมกับทุก template ผ่าน brand.ts ไม่ผูก MOM โดยเฉพาะ
 */

const FULL_WIDTH = { size: 100, type: WidthType.PERCENTAGE } as const
const sectionBorder = { bottom: { style: BorderStyle.SINGLE, color: BRAND_BLUE, size: 6, space: 2 } }

function cell(text: string, header = false): TableCell {
  return new TableCell({
    shading: header ? { fill: BRAND_BLUE_LIGHT } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: text || '-', bold: header })] })],
  })
}

function sectionTitle(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, border: sectionBorder })
}

function buildFieldsSection(section: FieldsSectionDef, data: TemplateData): (Paragraph | Table)[] {
  const rows = section.fields.map((f) => new TableRow({ children: [cell(f.label, true), cell(data.fields[section.id]?.[f.key] ?? '')] }))
  return [sectionTitle(section.title), new Table({ width: FULL_WIDTH, rows })]
}

function buildTableSection(section: TableSectionDef, data: TemplateData): (Paragraph | Table)[] {
  const headerRow = new TableRow({ children: section.columns.map((c) => cell(c.label, true)) })
  const rows = (data.tables[section.id] ?? []).map((row) => new TableRow({ children: section.columns.map((c) => cell(row[c.key] ?? '')) }))
  return [sectionTitle(section.title), new Table({ width: FULL_WIDTH, rows: [headerRow, ...rows] })]
}

function buildListSection(section: ListSectionDef, data: TemplateData): Paragraph[] {
  const items = (data.lists[section.id] ?? []).filter((s) => s.trim())
  return [
    sectionTitle(section.title),
    ...(items.length > 0 ? items.map((item, i) => new Paragraph({ text: `${i + 1}. ${item}` })) : [new Paragraph({ text: '-' })]),
  ]
}

async function buildBrandHeader(): Promise<Header> {
  const logoBytes = await fetch(BRAND_LOGO_URL).then((r) => r.arrayBuffer())
  return new Header({
    children: [
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, color: BRAND_BLUE, size: 8, space: 4 } },
        children: [new ImageRun({ type: 'png', data: logoBytes, transformation: { width: BRAND_LOGO_WIDTH, height: BRAND_LOGO_HEIGHT } })],
      }),
    ],
  })
}

export async function buildTemplateDocx(def: DocTemplateDef, data: TemplateData, title: string): Promise<Blob> {
  const children: (Paragraph | Table)[] = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })]
  for (const section of def.sections) {
    if (section.kind === 'fields') children.push(...buildFieldsSection(section, data))
    else if (section.kind === 'table') children.push(...buildTableSection(section, data))
    else children.push(...buildListSection(section, data))
    children.push(new Paragraph({ text: '' }))
  }
  const header = await buildBrandHeader()
  const doc = new Document({ sections: [{ headers: { default: header }, children }] })
  return Packer.toBlob(doc)
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
