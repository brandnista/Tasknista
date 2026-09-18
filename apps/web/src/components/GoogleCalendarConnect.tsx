import { AlertTriangle, CalendarClock, RefreshCw, Unplug } from 'lucide-react'
import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { useDialog } from './Dialog'
import { useToast } from './Toast'

/**
 * Pronista §Calendar/Workload (2026-09-18) — เชื่อมต่อ Google Calendar ส่วนตัว (self-service, owner+member เท่านั้น ตรงกับ teamOnly ฝั่ง API)
 * แก้ปัญหาที่อีเมล login ใน Pronista กับอีเมล Google Calendar จริงเป็นคนละอีเมล (เช่นกรณีพี่แบงค์) — เชื่อมได้อิสระจากอีเมล login
 * v1: UI จัดการได้ทีละ 1 บัญชีต่อคน (schema/backend ไม่ได้ปิดทางเชื่อมหลายบัญชีต่อคน — ขยาย UI เป็น list ได้ทีหลังถ้าต้องการ)
 */

interface Connection {
  id: string
  userId: string | null
  googleEmail: string | null
  status: 'connected' | 'disconnected'
  lastSyncAt: number | null
  lastError: string | null
  connectedAt: number | null
}

const fmtDateTime = (t: number | null) =>
  t ? new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export function GoogleCalendarConnect({ userId }: { userId: string }) {
  const toast = useToast()
  const { confirmDialog, alertDialog } = useDialog()
  const [params, setParams] = useSearchParams()
  const { data, reload } = useLoad<{ connections: Connection[] }>(() => api.get('/api/calendar-connect'))
  const myConnection = (data?.connections ?? []).find((c) => c.userId === userId) ?? null

  useEffect(() => {
    if (params.get('gcal') === 'connected') {
      toast('เชื่อมต่อ Google Calendar สำเร็จ')
      params.delete('gcal')
      setParams(params, { replace: true })
    } else if (params.get('gcal_error')) {
      void alertDialog({ title: 'เชื่อมต่อไม่สำเร็จ', message: 'ลองใหม่อีกครั้ง หรือติดต่อ owner ถ้ายังไม่ได้' })
      params.delete('gcal_error')
      setParams(params, { replace: true })
    }
  }, [])

  const sync = async () => {
    if (!myConnection) return
    try {
      await api.post(`/api/calendar-connect/${myConnection.id}/sync`)
      toast('sync แล้ว')
      await reload()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'sync ไม่สำเร็จ' })
    }
  }

  const disconnect = async () => {
    if (!myConnection) return
    if (!(await confirmDialog({ title: 'ยกเลิกการเชื่อมต่อ Google Calendar?', message: 'ประชุมที่ sync เข้ามาจากบัญชีนี้จะหายไปจากปฏิทินทีมงาน/Workload', danger: true }))) return
    await api.delete(`/api/calendar-connect/${myConnection.id}`)
    toast('ยกเลิกการเชื่อมต่อแล้ว')
    await reload()
  }

  return (
    <div className="pt-1">
      <div className="flex items-start gap-2 mb-2 px-1">
        <CalendarClock className="w-3.5 h-3.5 text-muted mt-0.5 shrink-0" />
        <div>
          <div className="text-xs font-semibold text-muted uppercase tracking-wide">เชื่อมต่อ Google Calendar</div>
          <p className="text-[11px] text-muted mt-0.5">
            ให้นัดหมายในปฏิทิน Google ของคุณ (จะใช้อีเมลไหนก็ได้ ไม่ต้องตรงกับอีเมล login) แสดงใน "ปฏิทินทีมงาน" และหักเวลาใน Workload อัตโนมัติ
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-xs p-4">
        {!myConnection ? (
          <a
            href="/api/calendar-connect/connect"
            className="inline-flex items-center gap-2 text-sm bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <CalendarClock className="w-4 h-4" /> เชื่อมต่อ Google Calendar
          </a>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-medium text-strong flex items-center gap-2">
                  {myConnection.googleEmail ?? 'ไม่ทราบอีเมล'}
                  {myConnection.status === 'connected' ? (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-success-100 text-success-700">เชื่อมต่อแล้ว</span>
                  ) : (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-danger-100 text-danger-700">หลุดการเชื่อมต่อ</span>
                  )}
                </div>
                <div className="text-[11px] text-muted mt-0.5">sync ล่าสุด: {fmtDateTime(myConnection.lastSyncAt)}</div>
                {myConnection.lastError && (
                  <div className="text-[11px] text-danger-600 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" /> {myConnection.lastError}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {myConnection.status === 'disconnected' ? (
                  <a href="/api/calendar-connect/connect" className="inline-flex items-center gap-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg">
                    เชื่อมใหม่
                  </a>
                ) : (
                  <button onClick={() => void sync()} className="inline-flex items-center gap-1.5 text-xs font-medium border border-border rounded-lg px-3 py-1.5 hover:bg-hover">
                    <RefreshCw className="w-3.5 h-3.5" /> Sync ตอนนี้
                  </button>
                )}
                <button onClick={() => void disconnect()} className="inline-flex items-center gap-1.5 text-xs font-medium border border-border rounded-lg px-3 py-1.5 text-danger-600 hover:bg-danger-50">
                  <Unplug className="w-3.5 h-3.5" /> ยกเลิกการเชื่อมต่อ
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
