import { useEffect, useState, type FocusEvent } from 'react'

/**
 * ช่องกรอกวันที่ที่ "แสดงผล" เป็น dd/mm/yyyy เสมอ ไม่ว่า browser/OS locale จะเป็นอะไร
 * เทคนิค: ใช้ native <input type="date"> จริงข้างใต้ (คง keyboard/mobile/accessibility ของ native picker ไว้ทั้งหมด)
 * แค่ทำตัวอักษรโปร่งใส แล้ววาง <span> ทับด้วยข้อความ dd/mm/yyyy ที่ format เอง (pointer-events ทะลุไปคลิก input ข้างล่างได้ปกติ)
 * รองรับ 2 โหมดเหมือน native input: controlled (value+onChange) กับ uncontrolled/autosave-on-blur (defaultValue+onBlur) — ใช้อย่างใดอย่างหนึ่งต่อจุดเรียกใช้ ห้ามผสมกัน
 */
export function DateInputTH({
  value,
  defaultValue,
  onChange,
  onBlur,
  autoFocus,
  className = '',
  placeholder = 'วว/ดด/ปปปป',
}: {
  value?: string
  defaultValue?: string
  onChange?: (v: string) => void
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void
  autoFocus?: boolean
  className?: string
  placeholder?: string
}) {
  const isControlled = value !== undefined
  const [inner, setInner] = useState(defaultValue ?? '')
  // ค่า defaultValue มาจาก prop ภายนอก (เช่น reload หลัง save) — sync เข้า state ภายในเมื่อเปลี่ยน (โหมด uncontrolled เท่านั้น)
  useEffect(() => {
    if (!isControlled) setInner(defaultValue ?? '')
  }, [defaultValue, isControlled])

  const current = isControlled ? (value ?? '') : inner
  const display = current && /^\d{4}-\d{2}-\d{2}$/.test(current) ? `${current.slice(8, 10)}/${current.slice(5, 7)}/${current.slice(0, 4)}` : ''

  return (
    <div className="relative">
      <input
        type="date"
        autoFocus={autoFocus}
        {...(isControlled ? { value } : { defaultValue })}
        onChange={(e) => {
          if (!isControlled) setInner(e.target.value)
          onChange?.(e.target.value)
        }}
        onBlur={onBlur}
        className={`${className} text-transparent caret-transparent`}
      />
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-strong">
        {display || <span className="text-muted">{placeholder}</span>}
      </span>
    </div>
  )
}
