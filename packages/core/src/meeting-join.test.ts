import { describe, expect, it } from 'vitest'
import { canJoinMeeting } from './meeting-join'

describe('canJoinMeeting — ปุ่ม "เข้าร่วมประชุม": กดได้ตั้งแต่ก่อนเริ่ม 5 นาที ถึงเวลาสิ้นสุดนัดหมาย', () => {
  const start = Date.parse('2026-08-27T11:00:00+07:00')
  const end = Date.parse('2026-08-27T12:00:00+07:00')

  it('ก่อนช่วงกด (เร็วกว่า 5 นาทีก่อนเริ่ม) = กดไม่ได้', () => {
    expect(canJoinMeeting(start, end, start - 6 * 60_000)).toBe(false)
  })
  it('ขอบล่าง: เริ่มกดได้พอดี 10:55', () => {
    expect(canJoinMeeting(start, end, start - 5 * 60_000)).toBe(true)
  })
  it('ระหว่างประชุม = กดได้', () => {
    expect(canJoinMeeting(start, end, start + 30 * 60_000)).toBe(true)
  })
  it('ขอบบน: กดได้พอดีตอน 12:00 (เวลาสิ้นสุด)', () => {
    expect(canJoinMeeting(start, end, end)).toBe(true)
  })
  it('หลังเวลาสิ้นสุด = กดไม่ได้แล้ว', () => {
    expect(canJoinMeeting(start, end, end + 60_000)).toBe(false)
  })
})
