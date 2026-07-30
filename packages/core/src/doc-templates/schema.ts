/**
 * ระบบ Template เอกสาร (Tasknista §Document Template) — โครงสร้าง template (หัวข้อ/ฟิลด์) เก็บเป็นโค้ดที่นี่ ไม่เก็บ DB
 * (ไม่มีความต้องการให้ผู้ใช้สร้าง template เองผ่าน UI — DB เก็บแค่ข้อมูลที่กรอกจริงต่อเอกสาร ดู doc_template_values)
 * เพิ่ม template ใหม่ (เช่น SRS) = เพิ่มไฟล์นิยามใหม่ 1 ไฟล์ + ลงทะเบียนใน registry.ts เท่านั้น ไม่ต้องแก้โค้ดเดิม
 */

// 'richtext' = ช่องพิมพ์อิสระแบบ Rich Text (เก็บเป็น markdown string ใน dataJson เหมือน field ปกติ — ฝั่ง UI ใช้ TipTap)
export type FieldType = 'text' | 'textarea' | 'date' | 'richtext'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
}

// 'member' = เลือกจากสมาชิกจริงในระบบ (เก็บ userId + ชื่อที่ resolve ไว้)
export type TableColumnType = 'text' | 'textarea' | 'date' | 'member'

export interface TableColumnDef {
  key: string
  label: string
  type: TableColumnType
  // ชื่อหัวคอลัมน์แบบอื่นที่ยอมรับตอนพาร์สไฟล์ Word อัปโหลด (label ในฟอร์มเราใส่คำอธิบายเพิ่ม เลย fuzzy ไม่เจอกับ header ดิบของเอกสารจริงบางเล่ม)
  matchLabels?: string[]
}

export interface FieldsSectionDef {
  kind: 'fields'
  id: string
  title: string
  fields: FieldDef[]
}

export interface TableSectionDef {
  kind: 'table'
  id: string
  title: string
  columns: TableColumnDef[]
  seedRows?: number
  // ตารางนี้ "แตกเป็น Task" ได้ (เช่น ตารางความต้องการเชิงฟังก์ชันของ SRS) — ระบุว่าคอลัมน์ไหนคือ field ไหนของ Task ที่จะสร้าง
  // Tasknista §Document Traceability — docType บอกว่าตารางนี้อยู่เล่มไหนในสาย MOM→BRD→SOW→SRS (ใช้เดินรหัสอ้างอิง + tag origin ของ Task ที่สร้าง)
  // referenceCodeKey (ถ้ามี) = คอลัมน์ที่ผู้เขียนพิมพ์รหัสของเล่มก่อนหน้าไว้เอง (คั่นด้วย comma ได้หลายรหัส) — resolve เป็น task_references ตอนแตก Task
  breakoutToTasks?: {
    sourceCodeKey: string
    titleKey: string
    priorityKey?: string // ไม่บังคับ — บางเล่ม (เช่น มติ MOM) ไม่มี priority
    descriptionKeys: string[] // เรียงต่อกันเป็น description ของ Task (คอลัมน์ที่ระบุ label เอง)
    docType: 'MOM' | 'BRD' | 'SOW' | 'SRS' | 'PEP' | 'UIR'
    referenceCodeKey?: string
  }
}

export interface ListSectionDef {
  kind: 'list'
  id: string
  title: string
  seedItems?: number
}

export type SectionDef = FieldsSectionDef | TableSectionDef | ListSectionDef

export interface DocTemplateDef {
  templateType: string // 'mom' | 'srs' | ... — คีย์ใน registry
  labelThai: string
  docCodePrefix: string // เช่น 'MOM' -> รหัสจริง "<Codename โปรเจกต์>-MOM-<DDMMYYYY>-<NNN>"
  sections: SectionDef[]
  // ต้องเลือกโปรเจกต์ตอนสร้างไหม (เพื่อ gen เลขที่เอกสารแบบ project-scoped) — ไม่ระบุ = true (ทุก template ตอนนี้ต้องผูกโปรเจกต์)
  requiresProject?: boolean
}

// รูปร่างข้อมูลที่กรอกจริง (เก็บใน doc_template_values.dataJson) — key ตาม section.id ไม่ใช่ชื่อหัวข้อ กันเปลี่ยนชื่อ section แล้วข้อมูลเก่าพัง
export interface TemplateTableRow {
  [columnKey: string]: string
}
export interface TemplateData {
  fields: Record<string, Record<string, string>> // sectionId -> { fieldKey: value }
  tables: Record<string, TemplateTableRow[]> // sectionId -> rows
  lists: Record<string, string[]> // sectionId -> items
}

/** ค่าตั้งต้นตอนสร้างเอกสารใหม่จาก template — ใส่แถว/รายการว่างตาม seedRows/seedItems ให้กรอกได้เลย */
export function emptyTemplateData(def: DocTemplateDef): TemplateData {
  const data: TemplateData = { fields: {}, tables: {}, lists: {} }
  for (const section of def.sections) {
    if (section.kind === 'fields') {
      data.fields[section.id] = Object.fromEntries(section.fields.map((f) => [f.key, '']))
    } else if (section.kind === 'table') {
      const emptyRow = () => Object.fromEntries(section.columns.map((c) => [c.key, '']))
      data.tables[section.id] = Array.from({ length: section.seedRows ?? 1 }, emptyRow)
    } else {
      data.lists[section.id] = Array.from({ length: section.seedItems ?? 1 }, () => '')
    }
  }
  return data
}
