import type { DocTemplateDef } from './schema'

/**
 * BRD (Business Requirement Document) — นิยามจากเอกสารจริงชุดล่าสุด `02_BRD.docx` (BNT-BRD-xxx, 9 หัวข้อ + ภาคผนวก)
 * โครงสร้างเรียบง่ายกว่ารุ่นก่อน — ไม่มี Executive Summary แยก, เพิ่มหัวข้อ Target Users + Expected Business Benefits,
 * Risks/Glossary/เอกสารที่เกี่ยวข้องย้ายไปรวมเป็นภาคผนวก (13.1-13.3) ท้ายเล่ม
 * ตาราง Business Requirements (8.) มี breakoutToTasks — เอกสารจริงไม่มีคอลัมน์อ้างอิงกลับ MOM แล้ว (ผูกผ่าน "อ้างอิง Ticket" แทน ยังไม่ resolve อัตโนมัติ)
 */
export const BRD_TEMPLATE: DocTemplateDef = {
  templateType: 'brd',
  labelThai: 'BRD — เอกสารความต้องการทางธุรกิจ',
  docCodePrefix: 'BRD',
  sections: [
    {
      kind: 'fields',
      id: 'doc_info',
      title: 'ข้อมูลเอกสาร (Document Control)',
      fields: [
        { key: 'document_no', label: 'รหัสเอกสาร (Document No.)', type: 'text' },
        { key: 'project_code', label: 'โครงการ (Project Code)', type: 'text' },
        { key: 'version', label: 'เวอร์ชันเอกสาร', type: 'text' },
        { key: 'prepared_by', label: 'จัดทำโดย', type: 'text' },
        { key: 'source_ref', label: 'อ้างอิงต้นทาง', type: 'textarea' },
        { key: 'sponsor', label: 'เจ้าของโครงการ (Sponsor)', type: 'text' },
        { key: 'project_type', label: 'ประเภทโครงการ', type: 'text' },
      ],
    },
    {
      kind: 'fields',
      id: 'background',
      title: '1. Project Background',
      fields: [{ key: 'background', label: 'ความเป็นมาของโครงการ', type: 'textarea' }],
    },
    {
      kind: 'table',
      id: 'business_problem',
      title: '2. Business Problem',
      seedRows: 1,
      columns: [
        { key: 'point', label: 'จุดที่มีปัญหา', type: 'text' },
        { key: 'pain_point', label: 'ปัญหา AS-IS', type: 'textarea' },
        { key: 'impact', label: 'ผลกระทบทางธุรกิจ', type: 'textarea' },
      ],
    },
    {
      kind: 'table',
      id: 'business_objectives',
      title: '3. Business Objectives',
      seedRows: 1,
      columns: [
        { key: 'bo_code', label: 'รหัส', type: 'text' },
        { key: 'objective', label: 'วัตถุประสงค์', type: 'textarea' },
        { key: 'kpi', label: 'ตัวชี้วัด (KPI)', type: 'text' },
        { key: 'ref', label: 'อ้างอิง', type: 'text' },
      ],
    },
    {
      kind: 'table',
      id: 'target_users',
      title: '4. Target Users',
      seedRows: 1,
      columns: [
        { key: 'role', label: 'บทบาท', type: 'text' },
        { key: 'description', label: 'คำอธิบาย', type: 'textarea' },
        { key: 'permissions', label: 'สิทธิ์/การใช้งานหลัก', type: 'textarea' },
      ],
    },
    {
      kind: 'fields',
      id: 'as_is',
      title: '5. Current Process (AS-IS)',
      fields: [{ key: 'as_is', label: 'กระบวนการปัจจุบัน', type: 'textarea' }],
    },
    {
      kind: 'fields',
      id: 'to_be',
      title: '6. Proposed Solution (TO-BE)',
      fields: [{ key: 'to_be', label: 'กระบวนการที่เสนอ', type: 'textarea' }],
    },
    { kind: 'list', id: 'business_benefits', title: '7. Expected Business Benefits', seedItems: 3 },
    {
      kind: 'table',
      id: 'business_requirements',
      title: '8. High-level Business Requirements',
      seedRows: 1,
      // Tasknista §Document Traceability — เอกสารจริงไม่มีคอลัมน์อ้างอิงกลับ MOM แยกแล้ว (มีแต่ "อ้างอิง Ticket" ที่เป็นรหัสเดินเรื่องไปข้างหน้า) จึงไม่ตั้ง referenceCodeKey
      breakoutToTasks: {
        sourceCodeKey: 'br_code',
        titleKey: 'requirement',
        descriptionKeys: ['requirement'],
        docType: 'BRD',
      },
      columns: [
        { key: 'br_code', label: 'รหัส BR', type: 'text' },
        { key: 'requirement', label: 'ความต้องการทางธุรกิจ', type: 'textarea' },
        { key: 'ref_bo', label: 'อ้างอิง BO', type: 'text' },
        { key: 'ref_ticket', label: 'อ้างอิง Ticket', type: 'text' },
      ],
    },
    { kind: 'list', id: 'success_criteria', title: '9. Success Criteria', seedItems: 3 },
    {
      kind: 'table',
      id: 'stakeholders',
      title: '10. Key Stakeholders',
      seedRows: 1,
      columns: [
        { key: 'type', label: 'ประเภท', type: 'text' },
        { key: 'stakeholder', label: 'ผู้มีส่วนได้ส่วนเสีย', type: 'text' },
        { key: 'role_interest', label: 'บทบาทและความสนใจ', type: 'textarea' },
      ],
    },
    { kind: 'list', id: 'assumptions', title: '11. Assumptions', seedItems: 2 },
    { kind: 'list', id: 'constraints', title: '12. Constraints', seedItems: 2 },
    {
      kind: 'table',
      id: 'risks',
      title: '13.1 ความเสี่ยง (Risks)',
      seedRows: 1,
      columns: [
        { key: 'risk_code', label: 'รหัส', type: 'text' },
        { key: 'risk', label: 'ความเสี่ยง', type: 'textarea' },
        { key: 'level', label: 'ระดับ', type: 'text' },
        { key: 'mitigation', label: 'แนวทางจัดการ (Mitigation)', type: 'textarea' },
      ],
    },
    {
      kind: 'table',
      id: 'glossary',
      title: '13.2 อภิธานศัพท์ (Glossary)',
      seedRows: 1,
      columns: [
        { key: 'term', label: 'คำศัพท์ / ตัวย่อ', type: 'text' },
        { key: 'meaning', label: 'ความหมาย', type: 'textarea' },
      ],
    },
    {
      kind: 'fields',
      id: 'next_steps',
      title: '13.3 เอกสารที่เกี่ยวข้อง / ขั้นตอนถัดไป',
      fields: [{ key: 'next_steps', label: 'เอกสารที่เกี่ยวข้อง / ขั้นตอนถัดไป', type: 'textarea' }],
    },
  ],
}
