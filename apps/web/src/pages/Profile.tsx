/* Hallmark · redesign · genre: modern-minimal · structure: app profile-header (not a landing macrostructure — see redesign note) · theme: existing project tokens (locked, no new palette) */
import { Check, Loader2, Plug } from 'lucide-react'
import { useState, type ChangeEvent } from 'react'
import { AccessTokens } from '../components/AccessTokens'
import { Avatar } from '../components/Avatar'
import { PageHeader } from '../components/PageHeader'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ROLE_LABEL } from '../lib/role-label'

/** โปรไฟล์ตัวเอง — แก้ ชื่อจริง/นามสกุล/ชื่อเล่น + (owner/member) จัดการ Access Tokens (SPEC §4.1, §4.18) */

const field = 'w-full text-sm bg-white shadow-xs border border-border-subtle rounded-lg px-3 py-2 transition-colors focus:outline-hidden focus:border-brand-400 focus:ring-3 focus:ring-brand-100'
const fieldLabel = 'text-xs font-medium text-muted mb-1 block'

export function ProfilePage() {
  const { user, refresh } = useAuth()
  const [form, setForm] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    nickname: user?.nickname ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  if (!user) return null

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await api.patch('/api/me', form)
      await refresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const inputField = (label: string, k: keyof typeof form) => (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      <input value={form[k]} onChange={set(k)} className={field} />
    </label>
  )

  const canToken = user.role === 'owner' || user.role === 'member'

  return (
    <>
      <PageHeader title="โปรไฟล์" />
      <div className="max-w-3xl space-y-6 p-3 sm:p-6">
        {/* ส่วนเปิด — cover band + avatar ใหญ่ทับขอบ (แพทเทิร์นหน้าโปรไฟล์ทั่วไป) ใช้ gradient brand เดียวกับโลโก้ sidebar เพื่อความสม่ำเสมอ */}
        <div className="so-fade-in bg-white rounded-lg shadow-xs overflow-hidden">
          <div className="relative h-24 sm:h-28 bg-linear-to-br from-brand-500 via-brand-600 to-brand-700 overflow-hidden">
            <div className="absolute -right-6 -top-10 w-36 h-36 rounded-full bg-white/10" aria-hidden />
            <div className="absolute right-20 -bottom-16 w-28 h-28 rounded-full bg-white/10" aria-hidden />
          </div>
          <div className="px-5 sm:px-6 pb-5">
            <div className="flex items-end gap-4 -mt-10 sm:-mt-12">
              <Avatar
                name={user.name}
                avatarUrl={user.avatarUrl}
                className="w-20 h-20 sm:w-24 sm:h-24 text-2xl ring-4 ring-white shadow-sm"
                colorClass="bg-brand-100 text-brand-700"
              />
              <div className="min-w-0 pb-1">
                <div className="text-xl sm:text-2xl font-bold text-ink truncate">{user.name}</div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">
                    {ROLE_LABEL[user.role]}
                  </span>
                  <span className="text-xs text-muted truncate">{user.email}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ข้อมูลส่วนตัว — ส่วนหลักของหน้า */}
        <div className="bg-white rounded-lg shadow-xs overflow-hidden">
          <div className="p-5 border-b border-border-subtle">
            <div className="font-semibold text-ink">ข้อมูลส่วนตัว</div>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {inputField('ชื่อจริง', 'firstName')}
              {inputField('นามสกุล', 'lastName')}
            </div>
            {inputField('ชื่อเล่น (ใช้แสดงทั้งแอป ถ้ามี)', 'nickname')}

            <div className="flex items-center gap-3">
              <button
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex items-center gap-2 text-sm bg-brand-600 hover:bg-brand-700 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 text-white px-4 py-2 rounded-lg transition-all focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-brand-200"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> กำลังบันทึก…
                  </>
                ) : saved ? (
                  <>
                    <Check className="w-4 h-4" /> บันทึกแล้ว
                  </>
                ) : (
                  'บันทึก'
                )}
              </button>
              {error && <span className="text-sm text-danger-600">{error}</span>}
            </div>

            <p className="text-[11px] text-muted border-t border-divider pt-3">
              อีเมล/role แก้ที่นี่ไม่ได้ — ติดต่อ owner · ชื่อที่แสดงทั้งแอป = ชื่อเล่น (ถ้ามี) ไม่งั้น “ชื่อ นามสกุล”
            </p>
          </div>
        </div>

        {/* การเชื่อมต่อขั้นสูง — แยกจากข้อมูลส่วนตัวหลักชัดเจน ไม่ใช่ทุกคนต้องใช้ */}
        {canToken && (
          <div className="pt-1">
            <div className="flex items-start gap-2 mb-2 px-1">
              <Plug className="w-3.5 h-3.5 text-muted mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-muted uppercase tracking-wide">การเชื่อมต่อขั้นสูง</div>
                <p className="text-[11px] text-muted mt-0.5">
                  ให้ Claude หรือสคริปต์ภายนอกเรียก API แทนคุณได้ (อ่าน/สร้าง/แก้งาน + เวลา — ไม่แตะข้อมูลการเงิน) ถ้ายังไม่ได้ใช้งานลักษณะนี้ ข้ามส่วนนี้ได้เลย
                </p>
              </div>
            </div>
            <AccessTokens />
          </div>
        )}
      </div>
    </>
  )
}
