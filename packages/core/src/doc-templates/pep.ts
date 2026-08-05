import type { DocTemplateDef } from './schema'

/**
 * PEP (Project Execution Proposal) — นิยามจากเอกสารจริงชุดล่าสุด `05_PEP.docx` (BNT-PEP-xxx, 12 หัวข้อ)
 * "3. Budget Summary" ของจริงรวมทุกรายการ SOW พร้อมยอดสรุป (รวม/ส่วนลด/ยอดสุทธิ) ไว้ในตารางเดียว — ไม่ใช่ตาราง "Out of Scope Cost" แยกแบบรุ่นก่อน
 * "4. Payment Milestones" ของจริงไม่มีคอลัมน์รหัสงวดหรืออ้างอิง SOW แยก (ผูกกับ SOW ผ่านข้อความเงื่อนไข) — ใช้ "งวด" เป็น sourceCode แทน
 * Gantt Chart/Delivery Plan ของจริงจัดตาม Sprint ไม่ใช่สัปดาห์ — ปรับตามต้นฉบับ
 */
export const PEP_TEMPLATE: DocTemplateDef = {
  templateType: 'pep',
  labelThai: 'PEP — ข้อเสนอการดำเนินโครงการ (Project Execution Proposal)',
  docCodePrefix: 'PEP',
  sections: [
    {
      kind: 'fields',
      id: 'doc_info',
      title: 'ข้อมูลเอกสาร (Document Control)',
      fields: [
        { key: 'document_no', label: 'รหัสเอกสาร (Document No.)', type: 'text' },
        { key: 'project_code', label: 'โครงการ (Project Code)', type: 'text' },
        { key: 'version', label: 'เวอร์ชันเอกสาร', type: 'text' },
        { key: 'source_docs', label: 'อ้างอิงเอกสารต้นทาง (MOM/BRD/SOW/SRS)', type: 'textarea' },
      ],
    },
    {
      kind: 'fields',
      id: 'proposal_summary',
      title: '1. สรุปข้อเสนอ (Proposal Summary)',
      fields: [{ key: 'summary', label: 'สรุปภาพรวมข้อเสนอ', type: 'textarea' }],
    },
    {
      kind: 'table',
      id: 'reference_documents',
      title: '2. เอกสารอ้างอิง (Reference Documents)',
      seedRows: 4,
      columns: [
        { key: 'doc_type', label: 'เอกสาร', type: 'text' },
        { key: 'doc_code', label: 'รหัส', type: 'text' },
        { key: 'doc_version', label: 'เวอร์ชัน', type: 'text' },
      ],
    },
    {
      kind: 'table',
      id: 'budget_summary',
      title: '3. สรุปงบประมาณ (Budget Summary)',
      seedRows: 1,
      columns: [
        { key: 'sow_id', label: 'SOW ID', type: 'text' },
        { key: 'item', label: 'รายการ', type: 'text' },
        { key: 'manhour', label: 'Manhour', type: 'text' },
        { key: 'cost', label: 'Cost (บาท)', type: 'text' },
      ],
    },
    {
      kind: 'table',
      id: 'payment_milestones',
      title: '4. งวดการชำระเงิน (Payment Milestones)',
      seedRows: 1,
      // Pronista §Document Traceability — เอกสารจริงไม่มีคอลัมน์รหัสงวด/อ้างอิง SOW แยก จึงใช้ "งวด" เป็นรหัสอ้างอิงแทน ไม่ตั้ง referenceCodeKey
      breakoutToTasks: {
        sourceCodeKey: 'installment',
        titleKey: 'condition',
        descriptionKeys: ['percent'],
        docType: 'PEP',
      },
      columns: [
        { key: 'installment', label: 'งวด', type: 'text' },
        { key: 'percent', label: '%', type: 'text' },
        { key: 'condition', label: 'เงื่อนไข', type: 'textarea' },
      ],
    },
    {
      kind: 'fields',
      id: 'timeline',
      title: '5. ระยะเวลาโครงการ (Project Timeline)',
      fields: [{ key: 'timeline', label: 'ระยะเวลาดำเนินโครงการโดยรวม', type: 'textarea' }],
    },
    {
      kind: 'table',
      id: 'gantt',
      title: '6. แผนงานรายสัปดาห์ (Gantt Chart)',
      seedRows: 1,
      columns: [
        { key: 'sprint', label: 'Sprint', type: 'text' },
        { key: 'period', label: 'ช่วงเวลา', type: 'text' },
        { key: 'work', label: 'งานหลัก', type: 'textarea' },
        { key: 'tickets', label: 'Tickets', type: 'text' },
        { key: 'mh', label: 'MH', type: 'text' },
      ],
    },
    {
      kind: 'table',
      id: 'delivery_plan',
      title: '7. แผนการส่งมอบ (Delivery Plan)',
      seedRows: 1,
      columns: [
        { key: 'sprint', label: 'Sprint', type: 'text' },
        { key: 'deliverable', label: 'Deliverable', type: 'textarea' },
      ],
    },
    {
      kind: 'table',
      id: 'resource_plan',
      title: '8. ทีมงานโครงการ (Resource Plan / Project Team)',
      seedRows: 1,
      columns: [
        { key: 'role', label: 'บทบาท', type: 'text' },
        { key: 'duty', label: 'หน้าที่รับผิดชอบ', type: 'textarea' },
      ],
    },
    { kind: 'list', id: 'client_commitment', title: '9. สิ่งที่ลูกค้าต้องเตรียม (Client-side Commitment)', seedItems: 3 },
    { kind: 'list', id: 'key_assumptions', title: '10. สมมติฐานหลักของการประเมิน (Key Assumptions for Estimation)', seedItems: 3 },
    { kind: 'list', id: 'risk_factors', title: '11. ความเสี่ยงด้านงบประมาณและเวลา (Budget & Timeline Risk Factors)', seedItems: 3 },
    { kind: 'list', id: 'next_steps', title: '12. การอนุมัติและขั้นตอนถัดไป (Approval & Next Step)', seedItems: 3 },
    {
      kind: 'fields',
      id: 'validity',
      title: 'หมายเหตุยืนราคา (Estimate Validity)',
      fields: [{ key: 'validity', label: 'เงื่อนไขการยืนราคา', type: 'textarea' }],
    },
    {
      kind: 'table',
      id: 'approval',
      title: 'การลงนามอนุมัติ (Approval)',
      seedRows: 2,
      columns: [
        { key: 'role', label: 'บทบาท (Role)', type: 'text' },
        { key: 'name_title', label: 'ชื่อ – ตำแหน่ง', type: 'text' },
        { key: 'signature', label: 'ลายเซ็น', type: 'text' },
        { key: 'date', label: 'วันที่', type: 'date' },
      ],
    },
  ],
}
