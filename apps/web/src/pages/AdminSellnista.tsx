/**
 * Pronista §System Enhancements — "Sellnista" เมนูย่อยใต้ "บริการ" (owner-only เหมือน "จัดการโดเมน")
 * รายการบริการที่ Subscribe กับระบบ Sellnista + วันหมดอายุ — แจ้งเตือนอัตโนมัติ 30/15/7/1 วันก่อนหมดอายุ ทำใน apps/api/src/scheduled.ts:notifySellnistaExpiry
 * ระบบแยกต่างหากจาก "จัดการโดเมน"/productTypes โดยตั้งใจ — โครงหน้าก็อป AdminDomains.tsx เป๊ะ แต่ตัดฟิลด์ registrar/ผู้รับผิดชอบ/โปรเจกต์ออก (สเปกมีแค่ ชื่อบริการ/วันหมดอายุ/แจ้งเตือน)
 */
import { AlertTriangle, Plus, Store, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { DateInputTH } from '../components/DateInputTH'
import { useDialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { URGENCY_BORDER_CLASS, dueUrgency } from '../lib/due-urgency'
import { useLoad } from '../lib/useLoad'
import { fmtDate } from './AdminDomains'

interface SellnistaRow {
  id: string
  name: string
  expiryDate: string
  notifyEnabled: boolean
}

const PAGE_SIZE = 10

function SellnistaModal({ item, onClose, onDone }: { item: SellnistaRow | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const { alertDialog } = useDialog()
  const [name, setName] = useState(item?.name ?? '')
  const [expiryDate, setExpiryDate] = useState(item?.expiryDate ?? '')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim() || !expiryDate) return
    setBusy(true)
    try {
      const payload = { name: name.trim(), expiryDate }
      if (item) await api.patch(`/api/admin/sellnista/${item.id}`, payload)
      else await api.post('/api/admin/sellnista', payload)
      toast('บันทึกสำเร็จ')
      onDone()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ' })
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden'
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <span className="font-semibold text-ink text-sm">{item ? 'แก้ไขบริการ' : 'เพิ่มบริการ Sellnista'}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-hover text-dim"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-[11px] text-muted block mb-0.5">ชื่อบริการ</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น Sellnista Pro Plan" className={input} />
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-0.5">วันหมดอายุ</label>
            <DateInputTH value={expiryDate} onChange={setExpiryDate} className={input} />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle">
          <button onClick={onClose} className="text-sm px-3.5 py-2 rounded-lg text-soft hover:bg-hover">ยกเลิก</button>
          <button onClick={() => void submit()} disabled={!name.trim() || !expiryDate || busy} className="text-sm font-medium text-white px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40">
            {item ? 'บันทึก' : 'เพิ่มบริการ'}
          </button>
        </div>
      </div>
    </div>
  )
}

function NotifyToggle({ item, onChanged }: { item: SellnistaRow; onChanged: () => void }) {
  const [saving, setSaving] = useState(false)
  const toggle = async () => {
    setSaving(true)
    try {
      await api.patch(`/api/admin/sellnista/${item.id}`, { notifyEnabled: !item.notifyEnabled })
      onChanged()
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={item.notifyEnabled}
        onClick={() => void toggle()}
        disabled={saving}
        className={`relative w-[38px] h-[22px] rounded-full shrink-0 transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:outline-offset-2 ${item.notifyEnabled ? 'bg-brand-600' : 'bg-border'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow-xs transition-transform ${item.notifyEnabled ? 'translate-x-4' : ''}`} />
      </button>
      <span className={`text-xs font-medium ${item.notifyEnabled ? 'text-brand-700' : 'text-dim'}`}>{item.notifyEnabled ? 'On' : 'Off'}</span>
    </div>
  )
}

export function AdminSellnistaPage() {
  const { data, reload } = useLoad<SellnistaRow[]>(() => api.get('/api/admin/sellnista'))
  const { confirmDialog } = useDialog()
  const toast = useToast()
  const [modalItem, setModalItem] = useState<SellnistaRow | null | 'new'>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const list = data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? list.filter((d) => d.name.toLowerCase().includes(q)) : list
  }, [list, search])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages)
  const pageItems = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)

  const remove = async (item: SellnistaRow) => {
    if (!(await confirmDialog({ title: `ลบ "${item.name}"?`, message: 'กู้คืนไม่ได้', danger: true }))) return
    await api.delete(`/api/admin/sellnista/${item.id}`)
    toast('บันทึกสำเร็จ')
    void reload()
  }

  return (
    <>
      <PageHeader
        title="Sellnista"
        action={
          <button onClick={() => setModalItem('new')} className="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> เพิ่มบริการ
          </button>
        }
      />
      <div className="p-4 sm:p-6">
        {!data ? (
          <div className="text-center text-sm text-muted py-10">กำลังโหลด…</div>
        ) : list.length === 0 ? (
          <div className="bg-white rounded-lg shadow-xs text-center text-sm text-muted py-14">
            <Store className="w-8 h-8 mx-auto mb-2 text-border" />
            ยังไม่มีบริการ Sellnista ในระบบ — กด "เพิ่มบริการ" เพื่อเริ่มติดตามวันหมดอายุ
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-xs overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-divider">
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="ค้นหาชื่อบริการ…"
                className="w-full max-w-xs text-sm bg-hover rounded-lg px-3 py-1.5 focus:outline-hidden"
              />
              <span className="text-xs text-muted shrink-0">{filtered.length} บริการ</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-muted border-b border-divider">
                    <th className="px-4 py-2.5 font-medium">ชื่อบริการ</th>
                    <th className="px-4 py-2.5 font-medium">วันหมดอายุ</th>
                    <th className="px-4 py-2.5 font-medium">แจ้งเตือนหมดอายุ</th>
                    <th className="px-4 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {pageItems.map((item) => {
                    const urgency = dueUrgency(item.expiryDate, false, 30)
                    return (
                      <tr key={item.id} className={URGENCY_BORDER_CLASS[urgency]}>
                        <td className="px-4 py-2.5 font-medium text-body">{item.name}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1 ${urgency === 'overdue' ? 'text-danger-600 font-medium' : urgency === 'soon' ? 'text-warning-700' : 'text-body'}`}>
                            {urgency === 'overdue' && <AlertTriangle className="w-3.5 h-3.5" />}
                            {fmtDate(item.expiryDate)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5"><NotifyToggle item={item} onChanged={reload} /></td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-4 justify-end whitespace-nowrap">
                            <button onClick={() => setModalItem(item)} className="text-[12px] text-dim hover:text-brand-700">แก้ไข</button>
                            <button onClick={() => void remove(item)} className="text-[12px] text-dim hover:text-danger-600">ลบ</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t border-divider text-xs text-muted">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageSafe <= 1} className="disabled:opacity-30 hover:text-body">« ก่อนหน้า</button>
              <span>หน้า {pageSafe} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageSafe >= totalPages} className="disabled:opacity-30 hover:text-body">ถัดไป »</button>
            </div>
          </div>
        )}
      </div>

      {modalItem && (
        <SellnistaModal
          item={modalItem === 'new' ? null : modalItem}
          onClose={() => setModalItem(null)}
          onDone={() => { setModalItem(null); void reload() }}
        />
      )}
    </>
  )
}
