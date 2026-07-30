import type { DocTemplateDef } from './schema'

/**
 * UIR (User Interface Review) — นิยามจากเอกสารจริงชุดล่าสุด `06_UIR.docx` (BNT-UIR-xxx)
 * เอกสารรีวิวหน้าจอ UI ส่งลูกค้า sign-off ก่อนเริ่ม Development — รายการหน้าจอ (UIR-001..NNN) อ้างอิงรหัส Ticket ของ SRS (UIR←SRS ชั้นที่ 6)
 * "1.1 Mapping Table" ของจริงมี 4 คอลัมน์ (หัวข้อ/UIR ID/SOW ID/SRS ID) ต่างจากรุ่นก่อนที่มี FR ID/SCR ID/UIR ID — ปรับตามต้นฉบับ
 * ตาราง "2.3 API Dependency Status" ของรุ่นก่อนไม่มีในเอกสารจริงชุดนี้แล้ว — ตัดออก
 * ตาราง Client Sign-off Matrix (ข้อ 4) มี breakoutToTasks — ไฟล์จริงไม่มีคอลัมน์ "อ้างอิง SRS" ในตารางนี้ (รหัสอยู่ใน Mapping Table ข้อ 1.1) → กรอกเพิ่มในหน้ารีวิว/ฟอร์มได้
 */
export const UIR_TEMPLATE: DocTemplateDef = {
  templateType: 'uir',
  labelThai: 'UIR — รีวิวหน้าจอ UI (User Interface Review)',
  docCodePrefix: 'UIR',
  sections: [
    {
      kind: 'fields',
      id: 'doc_info',
      title: '1. Document Control & References',
      fields: [
        { key: 'document_no', label: 'รหัสเอกสาร (Document No.)', type: 'text' },
        { key: 'project_code', label: 'โครงการ', type: 'text' },
        { key: 'version', label: 'เวอร์ชันเอกสาร', type: 'text' },
        { key: 'ref_sow', label: 'อ้างอิง SOW ต้นทาง', type: 'text' },
        { key: 'ref_srs', label: 'อ้างอิง SRS ต้นทาง', type: 'text' },
        { key: 'additional_ref', label: 'อ้างอิงเพิ่มเติม', type: 'textarea' },
      ],
    },
    {
      kind: 'table',
      id: 'mapping_table',
      title: '1.1 ตารางอ้างอิงกลับไปยังเอกสารต้นทาง (Mapping Table)',
      seedRows: 1,
      columns: [
        { key: 'section_ref', label: 'หัวข้อ', type: 'text' },
        { key: 'src_id', label: 'UIR ID (เล่มนี้)', type: 'text' },
        { key: 'ref_sow', label: 'SOW ID', type: 'text' },
        { key: 'ref_srs', label: 'SRS ID', type: 'text' },
      ],
    },
    {
      kind: 'fields',
      id: 'review_summary',
      title: '2. UI Review Summary',
      fields: [{ key: 'summary', label: 'สรุปภาพรวมรอบรีวิว', type: 'textarea' }],
    },
    {
      kind: 'table',
      id: 'module_summary',
      title: '2.0 สรุปหน้าจอต่อกลุ่ม',
      seedRows: 1,
      columns: [
        { key: 'group', label: 'กลุ่ม', type: 'text' },
        { key: 'screen_count', label: 'จำนวนหน้าจอ', type: 'text' },
        { key: 'items', label: 'รายการ', type: 'text' },
      ],
    },
    {
      kind: 'table',
      id: 'asis_tobe',
      title: '2.1 ขอบเขตการเปลี่ยนแปลง AS-IS → TO-BE (ระดับกลุ่ม)',
      seedRows: 1,
      columns: [
        { key: 'group', label: 'กลุ่ม', type: 'text' },
        { key: 'as_is', label: 'AS-IS (ปัจจุบัน)', type: 'textarea' },
        { key: 'to_be', label: 'TO-BE (เป้าหมาย)', type: 'textarea' },
      ],
    },
    {
      kind: 'table',
      id: 'business_rules',
      title: '2.2 สิ่งที่คงเดิม ไม่กระทบผู้ใช้ (Business Rules)',
      seedRows: 1,
      columns: [
        { key: 'code', label: 'รหัส', type: 'text' },
        { key: 'rule', label: 'กฎทางธุรกิจ', type: 'textarea' },
        { key: 'note', label: 'หมายเหตุ', type: 'text' },
      ],
    },
    {
      kind: 'table',
      id: 'signoff_matrix',
      title: '4. Client Sign-off Matrix (รายการหน้าจอทั้งหมด)',
      seedRows: 1,
      // Tasknista §Document Traceability — รายการหน้าจออ้างอิงรหัส Ticket ของ SRS (ชั้นที่ 6 ของ chain)
      breakoutToTasks: {
        sourceCodeKey: 'src_id',
        titleKey: 'screen',
        descriptionKeys: ['group', 'comment'],
        docType: 'UIR',
        referenceCodeKey: 'ref_srs',
      },
      columns: [
        { key: 'src_id', label: 'UIR ID', type: 'text' },
        { key: 'screen', label: 'หน้าจอ', type: 'text' },
        { key: 'group', label: 'โมดูล', type: 'text' },
        { key: 'approve_status', label: 'สถานะอนุมัติ', type: 'text' },
        { key: 'comment', label: 'คอมเมนต์', type: 'textarea' },
        { key: 'ref_srs', label: 'อ้างอิง SRS (Ticket)', type: 'text' },
      ],
    },
    {
      kind: 'table',
      id: 'approval',
      title: 'การรับรองรายการหน้าจอ (Official Sign-off)',
      seedRows: 3,
      columns: [
        { key: 'role', label: 'บทบาท (Role)', type: 'text' },
        { key: 'name_title', label: 'ชื่อ – ตำแหน่ง', type: 'text' },
        { key: 'signature', label: 'ลายเซ็น', type: 'text' },
        { key: 'date', label: 'วันที่', type: 'date' },
      ],
    },
  ],
}
