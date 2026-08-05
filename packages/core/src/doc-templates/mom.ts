import type { DocTemplateDef } from './schema'

/** MOM (Minutes of Meeting) — นิยามจากเอกสารจริงชุดล่าสุด `01_MOM.docx` (BNT-MOM-2026-xxx, 7 หมวด) */
export const MOM_TEMPLATE: DocTemplateDef = {
  templateType: 'mom',
  labelThai: 'MOM — รายงานการประชุม',
  docCodePrefix: 'MOM',
  sections: [
    {
      kind: 'fields',
      id: 'meeting_info',
      title: '1. ข้อมูลการประชุม',
      fields: [
        { key: 'document_no', label: 'รหัสเอกสาร (MOM No.)', type: 'text' },
        { key: 'project_code', label: 'โครงการ (Project Code)', type: 'text' },
        { key: 'subject', label: 'หัวข้อการประชุม', type: 'text' },
        { key: 'datetime', label: 'วันที่ / เวลา', type: 'text' },
        { key: 'venue', label: 'สถานที่ / ช่องทาง', type: 'text' },
        { key: 'key_agenda', label: 'วาระสำคัญ', type: 'textarea' },
      ],
    },
    {
      kind: 'table',
      id: 'attendees',
      title: '2. ผู้เข้าร่วมประชุม',
      seedRows: 5,
      columns: [
        { key: 'no', label: 'ลำดับ', type: 'text' },
        { key: 'name', label: 'ชื่อ - นามสกุล', type: 'text' },
        { key: 'position', label: 'ตำแหน่ง / บริษัท', type: 'text' },
        { key: 'status', label: 'สถานะ', type: 'text' },
      ],
    },
    { kind: 'list', id: 'agenda', title: '3. วาระการประชุม', seedItems: 4 },
    {
      kind: 'table',
      id: 'decisions',
      title: '4. สรุปประเด็นและมติที่ประชุม',
      seedRows: 1,
      // Pronista §Document Traceability — ต้นสายของ chain MOM→BRD→SOW→SRS: แตกมติแต่ละแถวเป็น Task ให้เอกสารเล่มถัดไป (BRD) อ้างอิงกลับมาได้ผ่าน "รหัสมติ"
      breakoutToTasks: {
        sourceCodeKey: 'decision_id',
        titleKey: 'issue',
        descriptionKeys: ['decision'],
        docType: 'MOM',
      },
      columns: [
        { key: 'decision_id', label: 'รหัสมติ (Decision ID)', type: 'text' },
        { key: 'issue', label: 'ประเด็น / รายละเอียดการหารือ', type: 'textarea' },
        { key: 'decision', label: 'มติ / ข้อสรุป', type: 'textarea' },
      ],
    },
    {
      kind: 'table',
      id: 'action_items',
      title: '5. รายการติดตาม (Action Items)',
      seedRows: 1,
      columns: [
        { key: 'item_id', label: 'รหัส', type: 'text' },
        { key: 'item', label: 'รายการที่ต้องดำเนินการ', type: 'textarea' },
        { key: 'owner', label: 'ผู้รับผิดชอบ', type: 'member' },
        { key: 'due_date', label: 'กำหนดเสร็จ', type: 'date' },
        { key: 'status', label: 'สถานะ', type: 'text' },
      ],
    },
    {
      kind: 'fields',
      id: 'next_meeting',
      title: '6. กำหนดการประชุมครั้งถัดไป',
      fields: [
        { key: 'datetime', label: 'วันที่ / เวลา', type: 'text' },
        { key: 'venue', label: 'สถานที่ / ช่องทาง', type: 'text' },
        { key: 'agenda', label: 'วาระสำคัญ', type: 'textarea' },
      ],
    },
    {
      kind: 'fields',
      id: 'remarks',
      title: 'หมายเหตุ (Remarks)',
      // ช่องเขียนอิสระท้ายเล่มแบบ Rich Text (เก็บ markdown) — ส่วนแนบลิงก์/ไฟล์/รูปไม่ต้องประกาศที่นี่ TemplateFillForm แนบท้ายให้ทุกเล่มเสมอ
      fields: [{ key: 'remarks', label: 'หมายเหตุเพิ่มเติม', type: 'richtext' }],
    },
    {
      kind: 'table',
      id: 'approval',
      title: '7. การรับรองรายงานการประชุม',
      seedRows: 2,
      columns: [
        { key: 'role', label: 'บทบาท', type: 'text' },
        { key: 'name_title', label: 'ชื่อ – ตำแหน่ง', type: 'text' },
        { key: 'signature', label: 'ลายเซ็น', type: 'text' },
        { key: 'date', label: 'วันที่', type: 'date' },
      ],
    },
  ],
}
