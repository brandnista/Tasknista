import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

/**
 * Toast แจ้งเตือนสำเร็จแบบไม่บล็อก (auto-dismiss) — คนละหน้าที่กับ Dialog.tsx (ที่เป็น modal บล็อกต้องกดปิด)
 * ใช้: const toast = useToast()
 *   toast('บันทึกสำเร็จ')
 */

type ToastFn = (message: string) => void

const Ctx = createContext<ToastFn | null>(null)

const DURATION_MS = 2500

interface ToastItem {
  id: number
  message: string
  closing: boolean
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, closing: true } : it)))
    setTimeout(() => setItems((prev) => prev.filter((it) => it.id !== id)), 150)
  }, [])

  const toast = useCallback<ToastFn>(
    (message) => {
      const id = nextId.current++
      setItems((prev) => [...prev, { id, message, closing: false }])
      setTimeout(() => remove(id), DURATION_MS)
    },
    [remove],
  )

  return (
    <Ctx.Provider value={toast}>
      {children}
      {items.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[80] flex flex-col-reverse gap-2 pointer-events-none">
          {items.map((it) => (
            <div
              key={it.id}
              role="status"
              className={`pointer-events-auto flex items-center gap-2 bg-ink text-white text-sm px-4 py-2.5 rounded-lg shadow-lg ${it.closing ? 'so-fade-out' : 'so-fade-in'}`}
            >
              {it.message}
            </div>
          ))}
        </div>
      )}
    </Ctx.Provider>
  )
}

export function useToast(): ToastFn {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast ต้องอยู่ใต้ ToastProvider')
  return ctx
}
