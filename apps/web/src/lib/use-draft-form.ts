import { changedFields } from '@seedoffice/core'
import { useCallback, useMemo, useState } from 'react'

/**
 * Pronista §Save button (2026-10-02) — draft ของฟอร์มแก้ข้อมูล: พิมพ์/เลือกแล้วยังไม่บันทึกจนกว่าจะกดปุ่ม "บันทึก"
 * base = ข้อมูลจาก server (โหลดแล้ว) · value(k) = ค่าที่ผู้ใช้เห็น (draft ก่อน ไม่งั้นค่าจาก server) · changes = เฉพาะฟิลด์ที่เปลี่ยนจริง พร้อมส่ง PATCH
 */
export function useDraftForm<T extends object>(base: T | null | undefined) {
  const [draft, setDraft] = useState<Partial<Record<keyof T, unknown>>>({})

  const value = useCallback(
    <K extends keyof T>(key: K): string => {
      const v = key in draft ? draft[key] : base?.[key]
      return v === undefined || v === null ? '' : String(v)
    },
    [draft, base],
  )
  /** ค่าดิบ (ใช้กับฟิลด์แบบรายการ เช่น projectIds) */
  const raw = useCallback(<K extends keyof T>(key: K): T[K] | undefined => (key in draft ? (draft[key] as T[K]) : base?.[key]), [draft, base])
  const set = useCallback(<K extends keyof T>(key: K, v: string | string[] | null) => setDraft((d) => ({ ...d, [key]: v })), [])
  const reset = useCallback(() => setDraft({}), [])

  const changes = useMemo<Partial<Record<keyof T, unknown>>>(() => (base ? changedFields(base, draft) : {}), [base, draft])
  const dirty = Object.keys(changes).length > 0

  return { value, raw, set, reset, changes, dirty }
}
