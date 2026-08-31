// Pronista §Meeting Schedule Tab (2026-08-27) — กฎช่วงเวลาปุ่ม "เข้าร่วมประชุม": กดได้ตั้งแต่ก่อนเริ่ม 5 นาที จนถึงเวลาสิ้นสุดนัดหมาย (fix ตายตัว ไม่ใช่ค่าที่ตั้งได้ — คนละอันกับ meetingReminderMinutes ที่ตั้งได้ต่อคน)
export const MEETING_JOIN_LEAD_MINUTES = 5

export function canJoinMeeting(startAt: number, endAt: number, now: number): boolean {
  return now >= startAt - MEETING_JOIN_LEAD_MINUTES * 60_000 && now <= endAt
}

// Pronista §Meeting Schedule Tab (2026-08-27) — นาทีล่วงหน้าก่อนประชุมเริ่มที่จะเตือน ถ้าผู้ใช้ยังไม่ตั้งเอง (users.meetingReminderMinutes เป็น null)
export const DEFAULT_MEETING_REMINDER_MINUTES = 5
