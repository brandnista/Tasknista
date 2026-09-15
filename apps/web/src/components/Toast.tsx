/* Hallmark · component: toast · genre: modern-minimal (existing Pronista system) · theme: existing tokens (success-500/50, ink)
 * states: enter · visible · exit — plain toast: non-interactive, no hover/focus/active/disabled surface
 *         action toast: adds View/Link controls, so it does carry hover/focus states on those two buttons
 * contrast: pass (ink-on-white body text, white-on-success-500 icon badge)
 */
import { Check, CheckCircle2, Eye, Link2, X } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { taskUrl } from '../lib/task-url'

/**
 * Toast แจ้งเตือนสำเร็จแบบไม่บล็อก (auto-dismiss, กลางจอ) — คนละหน้าที่กับ Dialog.tsx (ที่เป็น modal บล็อกต้องกดปิด)
 * ใช้: const toast = useToast()
 *   toast('บันทึกสำเร็จ')
 *
 * Pronista §Workspace/Task Jira-alignment (2026-09-04) — เพิ่ม toastAction สำหรับ "สร้างงานสำเร็จ" มีปุ่ม View/Link
 * ใช้: const toastAction = useToastAction()
 *   toastAction('สร้าง Task ทำ hero section สำเร็จ', taskId)
 * ToastProvider อยู่นอก RouterProvider (App.tsx) จึงใช้ react-router useNavigate() ในนี้ไม่ได้ — ปุ่ม View ใช้ <a href> ธรรมดาแทน
 */

type ToastFn = (message: string) => void
type ToastActionFn = (message: string, taskId: string) => void

const Ctx = createContext<ToastFn | null>(null)
const ActionCtx = createContext<ToastActionFn | null>(null)

const DURATION_MS = 2200
const ACTION_DURATION_MS = 8000 // มีปุ่มให้กด ไม่ควรหายเร็วเท่า toast ข้อความล้วน

interface ToastItem {
  id: number
  message: string
  closing: boolean
  taskId?: string
}

function CopyLinkButton({ taskId }: { taskId: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(taskUrl(taskId)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 text-xs font-medium text-soft bg-hover hover:bg-divider rounded-lg px-2.5 py-1.5"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-success-600" /> : <Link2 className="w-3.5 h-3.5" />}
      {copied ? 'คัดลอกแล้ว' : 'Link'}
    </button>
  )
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-center gap-3 bg-white pl-3 pr-3 py-3 rounded-2xl shadow-2xl ring-1 ring-black/5 ${item.closing ? 'so-toast-out' : 'so-toast-in'}`}
    >
      <span className="shrink-0 w-8 h-8 rounded-full bg-success-500 grid place-items-center">
        <CheckCircle2 className="w-5 h-5 text-white" strokeWidth={2.5} />
      </span>
      <span className="text-sm font-medium text-ink">{item.message}</span>
      {item.taskId && (
        <div className="flex items-center gap-1.5 shrink-0 ml-1">
          <a
            href={`/tasks/${item.taskId}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-2.5 py-1.5"
          >
            <Eye className="w-3.5 h-3.5" /> View
          </a>
          <CopyLinkButton taskId={item.taskId} />
        </div>
      )}
      <button type="button" onClick={onClose} aria-label="ปิด" className="shrink-0 text-muted hover:text-soft">
        <X className="w-4 h-4" />
      </button>
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

  const toastAction = useCallback<ToastActionFn>(
    (message, taskId) => {
      const id = nextId.current++
      setItems((prev) => [...prev, { id, message, closing: false, taskId }])
      setTimeout(() => remove(id), ACTION_DURATION_MS)
    },
    [remove],
  )

  return (
    <Ctx.Provider value={toast}>
      <ActionCtx.Provider value={toastAction}>
        {children}
        {items.length > 0 && (
          <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-2 pointer-events-none px-4">
            {items.map((it) => (
              <ToastCard key={it.id} item={it} onClose={() => remove(it.id)} />
            ))}
          </div>
        )}
      </ActionCtx.Provider>
    </Ctx.Provider>
  )
}

export function useToast(): ToastFn {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast ต้องอยู่ใต้ ToastProvider')
  return ctx
}

export function useToastAction(): ToastActionFn {
  const ctx = useContext(ActionCtx)
  if (!ctx) throw new Error('useToastAction ต้องอยู่ใต้ ToastProvider')
  return ctx
}
