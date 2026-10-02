/* Hallmark · redesign · genre: modern-minimal · structure: app profile-header (not a landing macrostructure — see redesign note) · theme: existing project tokens (locked, no new palette) */
import { selfEditableProfileFields, type SelfEditableProfileField } from '@seedoffice/core'
import { useState, type ChangeEvent } from 'react'
import { Avatar } from '../components/Avatar'
import { useDialog } from '../components/Dialog'
import { GoogleCalendarConnect } from '../components/GoogleCalendarConnect'
import { PageHeader } from '../components/PageHeader'
import { SaveBar } from '../components/SaveBar'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { useAuth, type Me } from '../lib/auth'
import { ROLE_LABEL } from '../lib/role-label'
import { useDraftForm } from '../lib/use-draft-form'
import { CLASSIFICATION_TYPE_LABEL } from './UserSettings'

/**
 * โปรไฟล์ตัวเอง — แก้ ชื่อจริง/นามสกุล/ชื่อเล่น + ข้อมูลส่วนตัวตามกลุ่มผู้ใช้ (SPEC §4.1)
 * Pronista §Profile fields (2026-10-02) — ข้อมูลส่วนตัวที่กรอกที่นี่คือชุดเดียวกับหน้า จัดการพนักงาน / จัดการพาร์ทเนอร์ (ตาราง users เดียวกัน) ผู้ใช้ไม่เห็นเมนูตั้งค่า เลยกรอกเองที่นี่ แล้วแอดมินเห็นในหน้านั้นอัตโนมัติ
 * ฟิลด์ที่แอดมิน/HR ดูแล (ตำแหน่ง วันเริ่มงาน รหัสพนักงาน สัญญา ประเภท) แสดงอย่างเดียว · ปุ่ม "บันทึก" + แจ้งผลด้วย toast/popup
 */

const field = 'w-full text-sm bg-white shadow-xs border border-border-subtle rounded-lg px-3 py-2 transition-colors focus:outline-hidden focus:border-brand-400 focus:ring-3 focus:ring-brand-100'
const fieldLabel = 'text-xs font-medium text-muted mb-1 block'
const readOnlyBox = 'w-full text-sm bg-hover text-muted rounded-lg px-3 py-2 min-h-[38px]'

type ProfileForm = Pick<Me, 'firstName' | 'lastName' | 'nickname'> & Record<SelfEditableProfileField, string | null>

const fmtDate = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null)

export function ProfilePage() {
  const toast = useToast()
  const { alertDialog } = useDialog()
  const { user, refresh } = useAuth()
  const [saving, setSaving] = useState(false)
  const form = useDraftForm<ProfileForm>(user ?? undefined)

  if (!user) return null

  const editable = selfEditableProfileFields(user.role)
  const can = (f: SelfEditableProfileField) => editable.includes(f)
  const isPartner = user.role === 'vendor'
  const isJuristic = user.classificationType === 'ordinary_juristic' || user.classificationType === 'extraordinary_juristic'
  const branchType = form.value('branchType')

  const text = (k: keyof ProfileForm) => ({
    value: form.value(k),
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => form.set(k, e.target.value),
  })

  const save = async () => {
    const idCard = form.changes.idCardNumber
    if (typeof idCard === 'string' && !/^\d{13}$/.test(idCard)) {
      await alertDialog({ title: 'บันทึกไม่ได้', message: `${isPartner && isJuristic ? 'เลขทะเบียนนิติบุคคล (Tax ID)' : 'เลขบัตรประชาชน'} ต้องเป็นตัวเลข 13 หลัก` })
      return
    }
    const branchCode = form.changes.branchCode
    if (typeof branchCode === 'string' && !/^\d{5}$/.test(branchCode)) {
      await alertDialog({ title: 'บันทึกไม่ได้', message: 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก' })
      return
    }
    setSaving(true)
    try {
      await api.patch('/api/me', form.changes)
      await refresh()
      form.reset()
      toast('บันทึกสำเร็จ')
    } catch (e) {
      await alertDialog({ title: 'บันทึกไม่สำเร็จ', message: e instanceof ApiError ? e.message : 'กรุณาลองใหม่อีกครั้ง' })
    } finally {
      setSaving(false)
    }
  }

  const inputField = (label: string, k: keyof ProfileForm, props: { placeholder?: string; maxLength?: number; type?: string } = {}) => (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      <input {...text(k)} {...props} className={field} />
    </label>
  )

  const canToken = user.role === 'owner' || user.role === 'member'
  const readOnlyRows: { label: string; value: string | null }[] = isPartner
    ? [
        { label: 'ประเภท', value: user.classificationType ? CLASSIFICATION_TYPE_LABEL[user.classificationType] : null },
        { label: 'เงื่อนไขสัญญาจ้าง', value: user.contractType },
        { label: 'วันหมดสัญญา', value: fmtDate(user.contractExpiryDate) },
      ]
    : editable.length > 0
      ? [
          { label: 'ตำแหน่ง', value: user.jobTitle },
          { label: 'วันเริ่มงาน', value: fmtDate(user.startDate) },
          { label: 'รหัสพนักงาน', value: user.employeeCode },
        ]
      : []

  return (
    <>
      <PageHeader title="โปรไฟล์" />
      <div className="max-w-3xl space-y-6 p-3 sm:p-6">
        {/* ส่วนเปิด — avatar + ชื่อ + role (เอา cover band gradient ออกแล้ว บังเนื้อหา) */}
        <div className="bg-white rounded-lg shadow-xs p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <Avatar
              name={user.name}
              avatarUrl={user.avatarUrl}
              className="w-16 h-16 sm:w-20 sm:h-20 text-xl shrink-0"
              colorClass="bg-brand-100 text-brand-700"
            />
            <div className="min-w-0">
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

        {/* ข้อมูลส่วนตัว — ส่วนหลักของหน้า */}
        <div className="bg-white rounded-lg shadow-xs overflow-hidden">
          <div className="p-5 border-b border-border-subtle">
            <div className="font-semibold text-ink">ข้อมูลส่วนตัว</div>
            {editable.length > 0 && (
              <p className="text-[11px] text-muted mt-0.5">ข้อมูลชุดนี้แอดมินจะเห็นในหน้า {isPartner ? 'จัดการพาร์ทเนอร์' : 'จัดการพนักงาน'} ของคุณอัตโนมัติ</p>
            )}
          </div>
          <div className="p-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {inputField('ชื่อจริง', 'firstName')}
              {inputField('นามสกุล', 'lastName')}
            </div>
            {inputField('ชื่อเล่น (ใช้แสดงทั้งแอป ถ้ามี)', 'nickname')}

            {can('businessName') && inputField('ชื่อธุรกิจ', 'businessName')}
            {editable.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {can('phone') && inputField(isPartner ? 'เบอร์มือถือ' : 'เบอร์โทร', 'phone')}
                {can('prefix') && !isJuristic && inputField('คำนำหน้า', 'prefix', { placeholder: 'นาย/นาง/นางสาว' })}
                {can('idCardNumber') && inputField(isPartner && isJuristic ? 'เลขทะเบียนนิติบุคคล (Tax ID)' : 'เลขบัตรประชาชน', 'idCardNumber', { maxLength: 13, placeholder: 'ตัวเลข 13 หลัก' })}
                {can('specialty') && inputField('ความเชี่ยวชาญ', 'specialty', { placeholder: 'เช่น Frontend, UI/UX, ระบบบัญชี' })}
                {can('bankAccount') && inputField('บัญชีธนาคาร (สำหรับจ่ายเงิน)', 'bankAccount', { placeholder: 'ธนาคาร + เลขบัญชี' })}
                {can('branchType') && isJuristic && (
                  <label className="block">
                    <span className={fieldLabel}>ประเภทสาขา</span>
                    <select
                      value={branchType}
                      onChange={(e) => {
                        form.set('branchType', e.target.value || null)
                        if (e.target.value !== 'branch') form.set('branchCode', null)
                      }}
                      className={field}
                    >
                      <option value="">— ไม่ระบุ —</option>
                      <option value="hq">สำนักงานใหญ่</option>
                      <option value="branch">สาขา</option>
                    </select>
                  </label>
                )}
                {can('branchCode') && isJuristic && branchType === 'branch' && inputField('รหัสสาขา', 'branchCode', { maxLength: 5, placeholder: 'ตัวเลข 5 หลัก' })}
              </div>
            )}
            {can('address') && (
              <label className="block">
                <span className={fieldLabel}>ที่อยู่</span>
                <textarea rows={2} {...text('address')} className={field} />
              </label>
            )}
            {can('emergencyContactName') && (
              <div className="grid gap-3 sm:grid-cols-2">
                {inputField('ผู้ติดต่อฉุกเฉิน (ชื่อ)', 'emergencyContactName')}
                {inputField('ผู้ติดต่อฉุกเฉิน (เบอร์โทร)', 'emergencyContactPhone')}
              </div>
            )}

            <SaveBar inline dirty={form.dirty} saving={saving} onSave={() => void save()} onDiscard={() => form.reset()} />

            <p className="text-[11px] text-muted border-t border-divider pt-3">
              อีเมล/role แก้ที่นี่ไม่ได้ — ติดต่อ owner · ชื่อที่แสดงทั้งแอป = ชื่อเล่น (ถ้ามี) ไม่งั้น “ชื่อ นามสกุล”
            </p>
          </div>
        </div>

        {/* ข้อมูลที่แอดมิน/HR กำหนด — แสดงอย่างเดียว */}
        {readOnlyRows.length > 0 && (
          <div className="bg-white rounded-lg shadow-xs overflow-hidden">
            <div className="p-5 border-b border-border-subtle">
              <div className="font-semibold text-ink">ข้อมูลที่แอดมินกำหนด</div>
              <p className="text-[11px] text-muted mt-0.5">แก้ไม่ได้ที่นี่ — ติดต่อ owner</p>
            </div>
            <div className="p-5 grid gap-3 sm:grid-cols-2">
              {readOnlyRows.map((r) => (
                <div key={r.label}>
                  <span className={fieldLabel}>{r.label}</span>
                  <div className={readOnlyBox}>{r.value || '—'}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pronista §Calendar/Workload (2026-09-18) — เชื่อมต่อ Google Calendar ส่วนตัว (owner+member เท่านั้น ตรงกับ teamOnly ฝั่ง API) */}
        {canToken && <GoogleCalendarConnect userId={user.id} />}

        {/* Pronista (2026-10-02) — ซ่อนส่วน "การเชื่อมต่อขั้นสูง / Access Tokens" จากทุกคน (อาร์มสั่ง กันคำถามจากทีม) — component AccessTokens + API /api/tokens ยังอยู่ครบ ถ้าจะเปิดกลับให้ render <AccessTokens /> ตรงนี้ */}
      </div>
    </>
  )
}
