import { DocumentHistoryTable } from '../components/DocumentHistoryTable'
import { PageHeader } from '../components/PageHeader'

/**
 * Pronista §Document Version History — หน้า "ประวัติเอกสาร" ครอบคลุมเอกสารทุกชนิดทุกโปรเจกต์
 * ตัวตารางเอง (group เป็นเล่ม→เวอร์ชัน + filter + compare) ใช้ร่วมกับแท็บ "ประวัติเอกสาร" ในหน้าโปรเจกต์ — ดู DocumentHistoryTable.tsx
 */
export function DocumentHistoryPage() {
  return (
    <>
      <PageHeader title="ประวัติเอกสาร" />
      <div className="p-4 sm:p-6">
        <DocumentHistoryTable />
      </div>
    </>
  )
}
