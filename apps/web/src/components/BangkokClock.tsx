import { useEffect, useState } from 'react'
import { TH_MONTHS } from '../lib/project-ui'

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** วันที่แบบไทยเต็ม (พ.ศ. + เดือนย่อ) + เวลา — ใช้ formatToParts เอง (ไม่พึ่ง th-TH locale) กันเบราว์เซอร์ตีความปีพุทธ/คริสต์ไม่ตรงกัน */
function label(now: Date): string {
  const parts = Object.fromEntries(partsFmt.formatToParts(now).map((p) => [p.type, p.value]))
  const day = Number(parts.day)
  const month = Number(parts.month)
  const year = Number(parts.year) + 543
  return `${day} ${TH_MONTHS[month - 1]} ${year} · ${parts.hour}:${parts.minute} น.`
}

/** Pronista §Navbar enrichment (2026-08-27) — วันที่+เวลาปัจจุบันของไทย โผล่ที่ Topbar (แทนที่ปุ่มเพิ่มงานด่วนที่ย้ายออกไปแล้ว) */
export function BangkokClock() {
  const [text, setText] = useState(() => label(new Date()))

  useEffect(() => {
    const id = setInterval(() => setText(label(new Date())), 15_000)
    return () => clearInterval(id)
  }, [])

  return (
    <span className="hidden md:inline-block text-xs font-medium text-muted tabular-nums px-2 whitespace-nowrap" title="วันที่และเวลาปัจจุบัน (ประเทศไทย)">
      {text}
    </span>
  )
}
