/**
 * ช่องกรอกวันที่ที่ "แสดงผล" เป็น dd/mm/yyyy เสมอ ไม่ว่า browser/OS locale จะเป็นอะไร
 * เทคนิค: ใช้ native <input type="date"> จริงข้างใต้ (คง keyboard/mobile/accessibility ของ native picker ไว้ทั้งหมด)
 * แค่ทำตัวอักษรโปร่งใส แล้ววาง <span> ทับด้วยข้อความ dd/mm/yyyy ที่ format เอง (pointer-events ทะลุไปคลิก input ข้างล่างได้ปกติ)
 * value/onChange ยังเป็น ISO yyyy-mm-dd เหมือน input เดิมทุกจุดที่เรียกใช้ — สลับจาก <input type="date"> ตรงๆ ได้เลย ไม่กระทบ state ฝั่ง caller
 */
export function DateInputTH({
  value,
  onChange,
  className = '',
  placeholder = 'วว/ดด/ปปปป',
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  placeholder?: string
}) {
  const display = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : ''
  return (
    <div className="relative">
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${className} text-transparent caret-transparent`}
      />
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-strong">
        {display || <span className="text-muted">{placeholder}</span>}
      </span>
    </div>
  )
}
