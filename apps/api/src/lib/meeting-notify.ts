// Pronista §Meeting Schedule Tab (2026-08-27) — ข้อความแจ้งเตือนแบบละเอียด (ชื่อ+เวลา+Agenda+ผู้เข้าร่วม) ใช้ทั้งตอนนัดประชุม (meeting_scheduled) และเตือนล่วงหน้าก่อนเริ่ม (meeting_reminder)
// เก็บเป็นบรรทัดแยกใน message เดียว (multi-line) — NotificationCenter.tsx render ด้วย whitespace-pre-line อยู่แล้ว ไม่ต้องเพิ่ม schema/endpointใหม่

const dtFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

function fmtThaiDate(ms: number): { date: string; time: string } {
  const parts = Object.fromEntries(dtFmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  const day = Number(parts.day)
  const month = Number(parts.month)
  const year = Number(parts.year) + 543
  return { date: `${day} ${TH_MONTHS[month - 1]} ${year}`, time: `${parts.hour}:${parts.minute}` }
}

export function formatMeetingDetailMessage(
  headline: string,
  meeting: { startAt: number | Date; endAt: number | Date; agenda: string | null },
  participantNames: string[],
): string {
  const start = fmtThaiDate(new Date(meeting.startAt).getTime())
  const end = fmtThaiDate(new Date(meeting.endAt).getTime())
  const timeLine = start.date === end.date ? `${start.date} ${start.time}-${end.time} น.` : `${start.date} ${start.time} น. - ${end.date} ${end.time} น.`
  return [headline, `เวลา: ${timeLine}`, `Agenda: ${meeting.agenda?.trim() || '-'}`, `ผู้เข้าร่วม: ${participantNames.join(', ') || '-'}`].join('\n')
}
