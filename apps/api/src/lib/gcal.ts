import { addDaysISO } from '@seedoffice/core'

/**
 * Map event จาก Google Calendar API (events.list) → ฟิลด์ของ calendar_events (SPEC §4.14 · E6)
 * pure — ไม่แตะ DB/เครือข่าย/นาฬิกา (รับ event มา map ตรงๆ) เทสต์ด้วย fixture
 * - all-day: start.date / end.date (end เป็น exclusive ของ Google → ลบ 1 วันให้เป็นวันสุดท้ายที่นับรวม)
 * - มีเวลา: start.dateTime / end.dateTime → แปลงเป็นวันที่โซน Asia/Bangkok (+07:00) + เก็บเวลาจริง (startAt/endAt)
 * Pronista §Calendar/Workload (2026-09-18) — เพิ่ม startAt/endAt/allDay/busy/private/declined
 * ที่ Google ส่งมาอยู่แล้วแต่เดิมถูกทิ้งหมด (ใช้คำนวณล็อกชั่วโมงใน Workload + private masking)
 */

export interface GcalEventTime {
  date?: string // YYYY-MM-DD (all-day)
  dateTime?: string // RFC3339 มี offset/Z
}

export interface GcalAttendee {
  self?: boolean
  responseStatus?: string // needsAction | declined | tentative | accepted
}

export interface GcalEvent {
  id: string
  status?: string // confirmed | tentative | cancelled
  summary?: string
  start?: GcalEventTime
  end?: GcalEventTime
  transparency?: 'opaque' | 'transparent' // transparent = ว่าง ไม่หัก Workload
  visibility?: 'default' | 'public' | 'private' | 'confidential'
  attendees?: GcalAttendee[]
}

export interface MappedGcalEvent {
  gcalId: string
  cancelled: boolean
  title: string
  startDate: string // YYYY-MM-DD
  endDate: string | null // วันสุดท้ายที่นับรวม (null = วันเดียว)
  startAt: number | null // ms — มีเฉพาะ event ที่มีเวลา (ไม่ใช่ all-day)
  endAt: number | null
  allDay: boolean
  busy: boolean
  private: boolean
  declined: boolean // ตัวเอง (self attendee) ปฏิเสธแล้ว — ไม่ต้อง sync เข้า
}

/** วันที่ในโซน BKK ของ instant ที่ระบุ (รับ dateTime ที่มี offset แล้ว — deterministic) */
function bkkDate(dateTime: string): string {
  return new Date(new Date(dateTime).getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
}

function startOf(t: GcalEventTime | undefined): string | null {
  if (t?.date) return t.date
  if (t?.dateTime) return bkkDate(t.dateTime)
  return null
}

/** วันสุดท้ายที่นับรวม: all-day end.date เป็น exclusive (−1), timed ใช้วันของ dateTime */
function endInclusiveOf(t: GcalEventTime | undefined): string | null {
  if (t?.date) return addDaysISO(t.date, -1)
  if (t?.dateTime) return bkkDate(t.dateTime)
  return null
}

export function mapGcalEvent(e: GcalEvent): MappedGcalEvent | null {
  const cancelled = e.status === 'cancelled'
  const startDate = startOf(e.start)
  // event ที่ถูกยกเลิกอาจไม่มี start/end (incremental) — ยังคืนเพื่อให้ลบของเดิมได้
  if (cancelled)
    return {
      gcalId: e.id,
      cancelled: true,
      title: '',
      startDate: startDate ?? '',
      endDate: null,
      startAt: null,
      endAt: null,
      allDay: false,
      busy: true,
      private: false,
      declined: false,
    }
  if (!startDate) return null // event ปกติที่ไม่มีวันเริ่ม = ข้าม
  const endInclusive = endInclusiveOf(e.end)
  const allDay = !!e.start?.date
  const declined = (e.attendees ?? []).some((a) => a.self && a.responseStatus === 'declined')
  return {
    gcalId: e.id,
    cancelled: false,
    title: e.summary?.trim() || '(ไม่มีชื่อ)',
    startDate,
    // ซ่อน endDate ถ้าเท่ากับหรือก่อน startDate (event วันเดียว)
    endDate: endInclusive && endInclusive > startDate ? endInclusive : null,
    startAt: !allDay && e.start?.dateTime ? new Date(e.start.dateTime).getTime() : null,
    endAt: !allDay && e.end?.dateTime ? new Date(e.end.dateTime).getTime() : null,
    allDay,
    busy: e.transparency !== 'transparent',
    private: e.visibility === 'private' || e.visibility === 'confidential',
    declined,
  }
}
