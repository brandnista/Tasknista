/** Pronista §Menu Restructure (2026-08-28) — แยกจากแท็บเดิมใน MyTasks.tsx ออกมาเป็น sub-menu ของ "งานของฉัน" (ดู Layout.tsx NAV) */
import { MyFilesTab } from '../components/MyFilesTab'
import { PageHeader } from '../components/PageHeader'

export function SharedFilesPage() {
  return (
    <>
      <PageHeader title="แชร์กับฉัน" />
      <div className="p-3 sm:p-6">
        <MyFilesTab root="shared" />
      </div>
    </>
  )
}
