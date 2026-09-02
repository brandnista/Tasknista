/**
 * เวอร์ชัน datetime-local ของ DateInputTH — แสดงผลเป็น dd/mm/yyyy HH:mm เสมอ ไม่ว่า browser/OS locale จะเป็นอะไร
 * เทคนิคเดียวกัน: native <input type="datetime-local"> โปร่งใสข้างใต้ + <span> ทับด้วยข้อความ format เอง
 * value/onChange ยังเป็น ISO yyyy-mm-ddThh:mm เหมือน input เดิมทุกจุดที่เรียกใช้ — สลับจาก <input type="datetime-local"> ตรงๆ ได้เลย ไม่กระทบ state ฝั่ง caller
 */
export function DateTimeInputTH({
  value,
  onChange,
  className = '',
  placeholder = 'วว/ดด/ปปปป --:--',
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  placeholder?: string
}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  const display = m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : ''
  return (
    <div className="relative">
      <input
        type="datetime-local"
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
