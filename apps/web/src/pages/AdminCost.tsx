/**
 * Pronista §กำหนดต้นทุน — รวมทุกค่าที่ Tab "Project Estimate" (หน้ารายละเอียดโปรเจกต์) ใช้คำนวณต้นทุน
 * PM เลือก "คน" + "Role" ใน Project Estimate แล้วต้นทุน/วันจะดึงมาจากตำแหน่งที่กำหนดไว้ที่นี่ (ไม่ผูกกับตัวคนตายตัว)
 */
import { CostRoleSettings } from '../components/CostRoleSettings'
import { useDialog } from '../components/Dialog'
import { PageHeader } from '../components/PageHeader'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'

interface CostConfig {
  costBufferPercent: number
  costMarginPercent: number
}

export function AdminCostPage() {
  const { data: cfg, reload: reloadCfg } = useLoad<CostConfig>(() => api.get('/api/admin/config'))
  const { alertDialog } = useDialog()

  // Pronista §Admin UX fix (2026-09-15) — เดิมไม่ดัก error เลย (ค่า default ที่ใช้คำนวณต้นทุนทุก Task ในระบบ) พิมพ์ค่าที่ validate ไม่ผ่านแล้ว blur จะดูเหมือนบันทึกสำเร็จทั้งที่ค่าเดิมยังอยู่ mirror fix เดียวกับ Admin.tsx saveCfg
  const saveCostCfg = async (patch: Partial<CostConfig>) => {
    try {
      await api.patch('/api/admin/config', patch)
      await reloadCfg()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ' })
      await reloadCfg()
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
                  defaultValue={cfg.costBufferPercent}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (v !== cfg.costBufferPercent) void saveCostCfg({ costBufferPercent: v })
                  }}
                  className="w-20 text-sm shadow-xs bg-white rounded-lg px-3 py-2 text-right tabular-nums"
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-soft">Margin % เริ่มต้น (กำไรที่บวกเพิ่มจากต้นทุน)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={cfg.costMarginPercent}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (v !== cfg.costMarginPercent) void saveCostCfg({ costMarginPercent: v })
                  }}
                  className="w-20 text-sm shadow-xs bg-white rounded-lg px-3 py-2 text-right tabular-nums"
                />
              </label>
            </div>
          )}
        </div>

        <CostRoleSettings />
      </div>
    </>
  )
}
