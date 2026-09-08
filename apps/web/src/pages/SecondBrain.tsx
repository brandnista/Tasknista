/**
 * Pronista §Second Brain (2026-09-08) — รายการลิงก์ที่ดักจับจากห้องแชท LINE กลุ่มเฉพาะอัตโนมัติ (Phase 1: เก็บอย่างเดียว ไม่มี AI สรุป)
 * ไม่มีปุ่ม "เพิ่มเอง" — ที่มาของรายการคือ LINE เท่านั้นตามขอบเขตงาน
 */
import { BrainCircuit, ExternalLink, Trash2 } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { useDialog } from '../components/Dialog'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'

interface SecondBrainLinkRow {
  id: string
  url: string
  messageText: string | null
  senderDisplayName: string | null
  capturedAt: number
}

export function SecondBrainPage() {
  const { confirmDialog, alertDialog } = useDialog()
  const { data, reload } = useLoad<SecondBrainLinkRow[]>(() => api.get('/api/second-brain/links'))
  const rows = data ?? []

  const remove = async (row: SecondBrainLinkRow) => {
    if (!(await confirmDialog({ title: 'ลบลิงก์นี้?', message: row.url, danger: true, confirmLabel: 'ลบ' }))) return
    try {
      await api.delete(`/api/second-brain/links/${row.id}`)
      void reload()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'ลบไม่สำเร็จ' })
    }
  }

  return (
    <>
      <PageHeader title="Second Brain" />
      <div className="p-4 sm:p-6">
        {!data ? (
          <div className="text-center text-sm text-muted py-10">กำลังโหลด…</div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-lg shadow-xs text-center text-sm text-muted py-14">
            <BrainCircuit className="w-8 h-8 mx-auto mb-2 text-border" />
            ยังไม่มีลิงก์ที่บันทึกไว้ — แชร์ลิงก์ในห้องแชท LINE ที่ตั้งค่าไว้ ระบบจะดึงมาเก็บให้อัตโนมัติ
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-xs overflow-hidden divide-y divide-divider">
            {rows.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <a href={r.url} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline break-all flex items-center gap-1.5">
                    {r.url}
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                  {r.messageText && r.messageText !== r.url && <p className="text-xs text-muted mt-1 line-clamp-2">{r.messageText}</p>}
                  <div className="text-[11px] text-muted mt-1.5">
                    {r.senderDisplayName ?? 'ไม่ทราบชื่อผู้ส่ง'} · {new Date(r.capturedAt).toLocaleString('th-TH')}
                  </div>
                </div>
                <button onClick={() => void remove(r)} className="text-muted hover:text-danger-600 shrink-0 p-1" title="ลบ">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
