import type { DocTemplateDef } from './schema'

/**
 * SRS (Software Requirements Specification) — นิยามจากเอกสารจริงชุดล่าสุด `04_SRS.docx` (BNT-SRS-xxx, 15 หัวข้อ)
 * โครงสร้างเปลี่ยนจากรุ่นก่อนทั้งหมด — เอกสารจริงเรียงเป็นหัวข้อ 1-15 พร้อมตารางล้วน ไม่ใช่ heading+label:value แบบเดิม
 * ตาราง "5. High-level Functional Requirements" มี breakoutToTasks — คอลัมน์รหัสเปลี่ยนจาก "รหัส FR" เป็น "รหัส Ticket" (รหัสเดียวกับที่ BRD/SOW ใช้ไล่ตลอดสาย)
 */
export const SRS_TEMPLATE: DocTemplateDef = {
  templateType: 'srs',
  labelThai: 'SRS — ข้อกำหนดความต้องการของระบบ',
  docCodePrefix: 'SRS',
  sections: [
    {
      kind: 'fields',
      id: 'doc_info',
      title: 'ข้อมูลเอกสาร (Document Control)',
      fields: [
        { key: 'document_no', label: 'รหัสเอกสาร (Document No.)', type: 'text' },
        { key: 'project_code', label: 'โครงการ (Project Code)', type: 'text' },
        { key: 'version', label: 'เวอร์ชันเอกสาร', type: 'text' },
        { key: 'ref_sow', label: 'อ้างอิง SOW ต้นทาง', type: 'text' },
        { key: 'source_docs', label: 'อ้างอิงเอกสารต้นทาง', type: 'textarea' },
      ],
    },
    {
      kind: 'fields',
      id: 'purpose',
      title: '1. Document Purpose',
      fields: [{ key: 'purpose', label: 'วัตถุประสงค์ของเอกสาร', type: 'textarea' }],
    },
    {
      kind: 'fields',
      id: 'system_overview',
      title: '2. System Overview',
      fields: [{ key: 'overview', label: 'ภาพรวมระบบ', type: 'textarea' }],
    },
    {
      kind: 'table',
      id: 'user_roles',
      title: '3. User Roles',
      seedRows: 2,
      columns: [
        { key: 'role', label: 'บทบาท', type: 'text' },
        { key: 'description', label: 'คำอธิบาย', type: 'textarea' },
        { key: 'permissions', label: 'สิทธิ์/การใช้งานหลัก', type: 'textarea' },
      ],
    },
    { kind: 'list', id: 'core_modules', title: '4. Core Modules', seedItems: 3 },
    {
      kind: 'table',
      id: 'functional_requirements',
      title: '5. High-level Functional Requirements',
      seedRows: 1,
      breakoutToTasks: {
        sourceCodeKey: 'source_code',
        titleKey: 'title',
        priorityKey: 'priority',
        descriptionKeys: ['acceptance_criteria'],
        docType: 'SRS',
        referenceCodeKey: 'ref_sow',
      },
      columns: [
        { key: 'source_code', label: 'รหัส Ticket', type: 'text' },
        { key: 'title', label: 'ชื่อความต้องการ', type: 'text' },
        { key: 'priority', label: 'Priority', type: 'text' },
        { key: 'acceptance_criteria', label: 'Acceptance Criteria (ย่อ)', type: 'textarea' },
        { key: 'ref_sow', label: 'อ้างอิง SOW', type: 'text' },
      ],
    },
    {
      kind: 'table',
      id: 'nfr',
      title: '6. High-level Non-functional Requirements',
      seedRows: 1,
      columns: [
        { key: 'category', label: 'หมวด', type: 'text' },
        { key: 'code', label: 'รหัส', type: 'text' },
        { key: 'detail', label: 'รายละเอียด', type: 'textarea' },
      ],
    },
    {
      kind: 'table',
      id: 'integration_requirements',
      title: '7. Integration Requirements',
      seedRows: 1,
      columns: [
        { key: 'item', label: 'ส่วนที่ต้องใช้ API', type: 'text' },
        { key: 'status', label: 'สถานะ', type: 'text' },
        { key: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ],
    },
    { kind: 'list', id: 'data_requirements', title: '8. Data Requirements', seedItems: 3 },
    { kind: 'list', id: 'assumptions', title: '9. Assumptions', seedItems: 2 },
    { kind: 'list', id: 'constraints', title: '10. Constraints', seedItems: 2 },
    {
      kind: 'fields',
      id: 'acceptance_criteria_overview',
      title: '11. High-level Acceptance Criteria',
      fields: [
        { key: 'ticket_level', label: 'ระดับ Ticket', type: 'textarea' },
        { key: 'release_level', label: 'ระดับ Release', type: 'textarea' },
      ],
    },
    { kind: 'list', id: 'out_of_scope', title: '12. Out of Scope', seedItems: 3 },
    { kind: 'list', id: 'open_questions', title: '13. Open Questions / Pending Decisions', seedItems: 2 },
    {
      kind: 'table',
      id: 'traceability_matrix',
      title: '14. Requirement Traceability Matrix',
      seedRows: 1,
      columns: [
        { key: 'source_code', label: 'รหัส Ticket', type: 'text' },
        { key: 'ref_sow', label: 'อ้างอิง SOW', type: 'text' },
        { key: 'ref_br', label: 'อ้างอิง BR', type: 'text' },
        { key: 'nfr', label: 'NFR', type: 'text' },
        { key: 'test_case', label: 'Test Case', type: 'text' },
        { key: 'slide_ref', label: 'สไลด์ (Proposal)', type: 'text' },
      ],
    },
    { kind: 'list', id: 'appendix', title: '15. ภาคผนวก (Appendix)', seedItems: 2 },
  ],
}
