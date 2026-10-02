/**
 * Pronista §กำหนดต้นทุน — รวมทุกค่าที่ Tab "Project Estimate" (หน้ารายละเอียดโปรเจกต์) ใช้คำนวณต้นทุน
 * PM เลือก "คน" + "Role" ใน Project Estimate แล้วต้นทุน/วันจะดึงมาจากตำแหน่งที่กำหนดไว้ที่นี่ (ไม่ผูกกับตัวคนตายตัว)
 */
import { useState } from 'react'
import { CostRoleSettings } from '../components/CostRoleSettings'
import { useDialog } from '../components/Dialog'
import { PageHeader } from '../components/PageHeader'
import { SaveBar } from '../components/SaveBar'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { useDraftForm } from '../lib/use-draft-form'
import { useLoad } from '../lib/useLoad'

interface CostConfig {
  costBufferPercent: number
  costMarginPercent: number
}

export function AdminCostPage() {
  const { data: cfg, reload: reloadCfg } = useLoad<CostConfig>(() => api.get('/api/admin/config'))
  const { alertDialog } = useDialog()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  // Pronista §Save button (2026-10-02) — แก้ใน draft แล้วกดปุ่ม "บันทึก" (เดิมบันทึกเองตอนคลิกออกจากช่อง มีแจ้งเฉพาะตอนผิดพลาด ไม่มีปุ่ม/แจ้งสำเร็จ)
  const form = useDraftForm<CostConfig>(cfg)

  const saveCostCfg = async () => {
    const payload: Record<string, number> = {}
    for (const [k, v] of Object.entries(form.changes)) {
      if (v === null) {
        await alertDialog({ title: 'บันทึกไม่ได้', message: 'กรุณากรอกตัวเลข' })
        return
      }
      payload[k] = Number(v)
    }
    setSaving(true)
    try {
      await api.patch('/api/admin/config', payload)
      await reloadCfg()
      form.reset()
      toast('บันทึกสำเร็จ')
    } catch (e) {
      await alertDialog({ title: 'บันทึกไม่สำเร็จ', message: e instanceof ApiError ? e.message : 'กรุณาลองใหม่อีกครั้ง' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="กำหนดต้นทุน" />
      <div className="p-3 sm:p-6 space-y-4">
        <div className="bg-white rounded-lg shadow-xs p-5 max-w-md">
          <div className="font-semibold text-ink mb-1">ค่าเริ่มต้นของการคำนวณ</div>
          <p className="text-[11px] text-muted mb-3">ใช้เป็นค่าเริ่มต้นของทุก Task ใน Tab "Project Estimate" (แก้เฉพาะ Task ได้ทีหลัง)</p>
          {cfg && (
            <div className="space-y-3 text-sm">
              <label className="flex items-center justify-between gap-3">
                <span className="text-soft">Buffer % เริ่มต้น (กันเวลาประเมินคลาดเคลื่อน)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.value('costBufferPercent')}
                  onChange={(e) => form.set('costBufferPercent', e.target.value)}
                  className="w-20 text-sm shadow-xs bg-white rounded-lg px-3 py-2 text-right tabular-nums"
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-soft">Margin % เริ่มต้น (กำไรที่บวกเพิ่มจากต้นทุน)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.value('costMarginPercent')}
                  onChange={(e) => form.set('costMarginPercent', e.target.value)}
                  className="w-20 text-sm shadow-xs bg-white rounded-lg px-3 py-2 text-right tabular-nums"
                />
              </label>
              <SaveBar inline dirty={form.dirty} saving={saving} onSave={() => void saveCostCfg()} onDiscard={() => form.reset()} />
            </div>
          )}
        </div>

        <CostRoleSettings />
      </div>
    </>
  )
}
