/* Hallmark · component: toast · genre: modern-minimal (existing Pronista system) · theme: existing tokens (success-500/50, ink)
 * states: enter · visible · exit — non-interactive notification, no hover/focus/active/disabled surface
 * contrast: pass (ink-on-white body text, white-on-success-500 icon badge)
 */
import { CheckCircle2 } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

/**
 * Toast แจ้งเตือนสำเร็จแบบไม่บล็อก (auto-dismiss, กลางจอ) — คนละหน้าที่กับ Dialog.tsx (ที่เป็น modal บล็อกต้องกดปิด)
 * ใช้: const toast = useToast()
 *   toast('บันทึกสำเร็จ')
 */

type ToastFn = (message: string) => void

const Ctx = createContext<ToastFn | null>(null)

const DURATION_MS = 2200

interface ToastItem {
  id: number
  message: string
  closing: boolean
}

function ToastCard({ message, closing }: { message: string; closing: boolean }) {
  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-center gap-3 bg-white pl-3 pr-5 py-3 rounded-2xl shadow-2xl ring-1 ring-black/5 ${closing ? 'so-toast-out' : 'so-toast-in'}`}
    >
      <span className="shrink-0 w-8 h-8 rounded-full bg-success-500 grid place-items-center">
        <CheckCircle2 className="w-5 h-5 text-white" strokeWidth={2.5} />
      </span>
      <span className="text-sm font-medium text-ink">{message}</span>
    </div>
  )
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
        <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-2 pointer-events-none px-4">
          {items.map((it) => (
            <ToastCard key={it.id} message={it.message} closing={it.closing} />
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
