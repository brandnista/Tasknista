/** Pronista §Menu Restructure (2026-08-28) — แยกจากแท็บเดิมใน MyTasks.tsx ออกมาเป็น sub-menu ของ "งานของฉัน" (ดู Layout.tsx NAV) */
import { MyNoteTab } from '../components/MyNoteTab'
import { PageHeader } from '../components/PageHeader'

export function MyTasksNotesPage() {
  return (
    <>
      <PageHeader title="My Note" />
      <div className="p-4 sm:p-6">
        <MyNoteTab />
      </div>
    </>
  )
}
