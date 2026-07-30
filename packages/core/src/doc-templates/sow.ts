import type { DocTemplateDef } from './schema'

/**
 * SOW (Scope of Work) — นิยามจากเอกสารจริงชุดล่าสุด `03_SOW.docx` (BNT-SOW-xxx, 11 หัวข้อ)
 * ตาราง "4.4 ตารางรวมทุกรายการ" มี breakoutToTasks — อ้างอิงกลับไป BR ของ BRD ผ่านคอลัมน์ "อ้างอิง BRD"
 * คอลัมน์ "Ticket (Proposal)" เป็นรหัส Ticket เดินเรื่องไปข้างหน้า (SRS ยังไม่เกิดตอนเขียน SOW) — เก็บเป็นข้อความเฉยๆ ไม่ resolve ตอนสร้าง
 * "5. User Roles" / "6. Deliverables" ของจริงใช้หัวคอลัมน์ภาษาอังกฤษ — คงตามต้นฉบับ
 */
export const SOW_TEMPLATE: DocTemplateDef = {
  templateType: 'sow',
  labelThai: 'SOW — ขอบเขตงาน',
  docCodePrefix: 'SOW',
  sections: [
    {
      kind: 'fields',
      id: 'intro_purpose',
      title: '1. บทนำและวัตถุประสงค์ของเอกสาร',
      fields: [{ key: 'purpose', label: 'วัตถุประสงค์ของเอกสาร', type: 'textarea' }],
    },
    {
      kind: 'fields',
      id: 'project_info',
      title: '2. ข้อมูลโครงการ (Project Information)',
      fields: [
        { key: 'document_no', label: 'รหัสเอกสาร (Document No.)', type: 'text' },
        { key: 'project_code', label: 'โครงการ (Project Code)', type: 'text' },
        { key: 'version', label: 'เวอร์ชันเอกสาร', type: 'text' },
        { key: 'ref_brd', label: 'อ้างอิง BRD ต้นทาง', type: 'text' },
        { key: 'customer', label: 'ลูกค้า', type: 'text' },
      ],
    },
    {
      kind: 'fields',
      id: 'executive_overview',
      title: '3. สรุปขอบเขตงานภาพรวม (Executive Overview)',
      fields: [{ key: 'overview', label: 'สรุปขอบเขตงานภาพรวม', type: 'textarea' }],
    },
    {
      kind: 'table',
      id: 'scope_items',
      title: '4.4 ตารางรวมทุกรายการ (High-level System Scope)',
      seedRows: 1,
      // Tasknista §Document Traceability — SOW item อ้างอิงกลับไป BR ของ BRD ผ่านคอลัมน์ "อ้างอิง BRD"
      breakoutToTasks: {
        sourceCodeKey: 'sow_id',
        titleKey: 'item_name',
        descriptionKeys: ['category', 'ticket_ref'],
        docType: 'SOW',
        referenceCodeKey: 'ref_brd',
      },
      columns: [
        { key: 'sow_id', label: 'SOW ID', type: 'text' },
        { key: 'item_name', label: 'ชื่อรายการ', type: 'text' },
        { key: 'category', label: 'ประเภท', type: 'text' },
        { key: 'ref_brd', label: 'อ้างอิง BRD', type: 'text' },
        { key: 'ticket_ref', label: 'Ticket (Proposal)', type: 'text' },
        { key: 'effort', label: 'Effort', type: 'text' },
      ],
    },
    {
      kind: 'table',
      id: 'user_roles',
      title: '5. User Roles',
      seedRows: 1,
      columns: [
        { key: 'role', label: 'User Role', type: 'text' },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'permissions', label: 'Key Permissions', type: 'textarea' },
      ],
    },
    {
      kind: 'table',
      id: 'deliverables',
      title: '6. Deliverables',
      seedRows: 1,
      columns: [
        { key: 'category', label: 'Category', type: 'text' },
        { key: 'deliverable', label: 'Deliverables', type: 'textarea' },
        { key: 'format', label: 'Format/Output', type: 'text' },
      ],
    },
    { kind: 'list', id: 'out_of_scope', title: '7. ขอบเขตที่ไม่รวมในโครงการ (Out of Scope)', seedItems: 3 },
    { kind: 'list', id: 'assumptions', title: '8. สมมติฐานและความสัมพันธ์ระหว่างรายการงาน (Assumptions & Dependencies)', seedItems: 3 },
    {
      kind: 'table',
      id: 'traceability_matrix',
      title: '9. ตารางความเชื่อมโยงเอกสาร (Cross-Document Traceability)',
      seedRows: 1,
      columns: [
        { key: 'brd', label: 'BRD', type: 'text' },
        { key: 'sow', label: 'SOW', type: 'text' },
        { key: 'srs', label: 'SRS (ปลายทาง)', type: 'text' },
      ],
    },
    {
      kind: 'table',
      id: 'approval',
      title: '10. การอนุมัติขอบเขตงาน (SOW Approval)',
      seedRows: 2,
      columns: [
        { key: 'role', label: 'บทบาท (Role)', type: 'text' },
        { key: 'name_title', label: 'ชื่อ – ตำแหน่ง', type: 'text' },
        { key: 'signature', label: 'ลายเซ็น', type: 'text' },
        { key: 'date', label: 'วันที่', type: 'date' },
      ],
    },
    { kind: 'list', id: 'appendix', title: '11. ภาคผนวก (Appendix)', seedItems: 2 },
  ],
}
