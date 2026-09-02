/** Pronista §Menu Restructure (2026-08-28) — แยกจากแท็บเดิมใน MyTasks.tsx ออกมาเป็น sub-menu ของ "งานของฉัน" (ดู Layout.tsx NAV) */
import { MyFilesTab } from '../components/MyFilesTab'
import { PageHeader } from '../components/PageHeader'

export function MyFilesPage() {
  return (
    <>
      <PageHeader title="ไฟล์ของฉัน" />
      <div className="p-4 sm:p-6">
        <MyFilesTab root="own" />
      </div>
    </>
  )
}
