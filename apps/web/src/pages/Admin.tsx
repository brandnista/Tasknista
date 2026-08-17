import { CalendarDays, Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { GcalSettings } from '../components/GcalSettings'
import { PageHeader } from '../components/PageHeader'
import { BoardPresetSettings } from '../components/BoardPresetSettings'
import { ServiceTypeSettings } from '../components/ServiceTypeSettings'
import { ProductTypeSettings } from '../components/ProductTypeSettings'
import { TaskTypeSettings } from '../components/TaskTypeSettings'
import { LabelSettings } from '../components/LabelSettings'
import { ProjectStatusSettings } from '../components/ProjectStatusSettings'
import { SettingsSubNav } from '../components/SettingsSubNav'
import { api } from '../lib/api'
import { useDialog } from '../components/Dialog'
import { useLoad } from '../lib/useLoad'

interface Config {
  cutoffDay: number
  workHourCapMinutes: number
  memberDomain: string
}

/** ลิงก์ subscribe ปฏิทินทีมเป็น ICS feed (SPEC §4.14 · E6) — owner สร้าง/รีเซ็ต/ปิด */
function IcsLinkCard() {
  const { data, reload } = useLoad<{ url: string | null }>(() => api.get('/api/admin/ics-link'))
  const { confirmDialog } = useDialog()
  const [copied, setCopied] = useState(false)
  const url = data?.url ?? null

  const generate = async () => {
    if (
      url &&
      !(await confirmDialog({
        title: 'สร้างลิงก์ใหม่?',
        message: 'ลิงก์เดิมจะใช้ไม่ได้ทันที — คนที่ subscribe ไว้ต้องเปลี่ยนเป็นลิงก์ใหม่',
        confirmLabel: 'สร้างใหม่',
      }))
    )
      return
    await api.post('/api/admin/ics-link/regenerate')
    await reload()
  }
  const disable = async () => {
    if (
      !(await confirmDialog({
        title: 'ปิดลิงก์ปฏิทิน?',
        message: 'feed จะเข้าไม่ได้จนกว่าจะสร้างลิงก์ใหม่',
        confirmLabel: 'ปิดลิงก์',
        danger: true,
      }))
    )
      return
    await api.delete('/api/admin/ics-link')
    await reload()
  }
  const copy = async () => {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="bg-white rounded-lg shadow-xs p-5 max-w-md">
      <div className="flex items-center gap-2 mb-1">
        <CalendarDays className="w-4 h-4 text-brand-600" />
        <div className="font-semibold text-ink">ลิงก์ปฏิทิน (ICS)</div>
      </div>
      <p className="text-[11px] text-muted mb-3">
        ลิงก์ subscribe ปฏิทินทีม (วันลา/ประชุม/วันหยุด + ตัดรอบ/จ่ายเงินเดือน) — เพิ่มใน Google/Apple
        Calendar บนมือถือ · ใครมีลิงก์เห็นได้ทั้งทีม
      </p>
      {url ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 text-xs bg-hover shadow-xs rounded-lg px-3 py-2 text-soft"
            />
            <button
              onClick={() => void copy()}
              className="shrink-0 text-sm px-3 py-2 rounded-lg bg-divider hover:bg-border-subtle flex items-center gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-success-600" /> คัดลอกแล้ว
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" /> คัดลอก
                </>
              )}
            </button>
          </div>
          <div className="flex gap-3 text-xs">
            <button onClick={() => void generate()} className="text-dim hover:text-body underline">
              สร้างลิงก์ใหม่
            </button>
            <button onClick={() => void disable()} className="text-danger-500 hover:text-danger-600 underline">
              ปิดลิงก์
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => void generate()}
          className="text-sm bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg"
        >
          สร้างลิงก์
        </button>
      )}
    </div>
  )
}

export function AdminPage() {
  const { data: cfg, reload: reloadCfg } = useLoad<Config>(() => api.get('/api/config'))

  const saveCfg = async (patch: Partial<Config>) => {
    await api.patch('/api/admin/config', patch)
    await reloadCfg()
  }

  return (
    <>
      <PageHeader title="ตั้งค่า" />
      <div className="p-3 sm:p-6 space-y-5">
        <SettingsSubNav />
        <div className="bg-white rounded-lg shadow-xs p-5 max-w-md">
          <div className="font-semibold text-ink mb-3">ค่าบริษัท</div>
          {cfg && (
            <div className="space-y-3 text-sm">
              <label className="flex items-center justify-between gap-3">
                <span className="text-soft">วันตัดรอบเงินเดือน (งวด = วันนี้ → วันก่อนหน้าเดือนถัดไป)</span>
                <input
                  type="number"
                  min={1}
                  max={28}
                  defaultValue={cfg.cutoffDay}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (v !== cfg.cutoffDay) void saveCfg({ cutoffDay: v })
                  }}
                  className="w-20 text-sm shadow-xs bg-white rounded-lg px-3 py-2 text-right tabular-nums"
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-soft">เพดานชั่วโมงทำงาน/วัน (นาที)</span>
                <input
                  type="number"
                  min={60}
                  max={1440}
                  step={30}
                  defaultValue={cfg.workHourCapMinutes}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (v !== cfg.workHourCapMinutes) void saveCfg({ workHourCapMinutes: v })
                  }}
                  className="w-24 text-sm shadow-xs bg-white rounded-lg px-3 py-2 text-right tabular-nums"
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-soft">โดเมน auto-provision member (ว่าง = ปิด)</span>
                <input
                  type="text"
                  placeholder="@example.com"
                  defaultValue={cfg.memberDomain}
                  onBlur={(e) => {
                    const v = e.target.value.trim().toLowerCase()
                    if (v !== cfg.memberDomain) void saveCfg({ memberDomain: v })
                  }}
                  className="w-44 text-sm shadow-xs bg-white rounded-lg px-3 py-2"
                />
              </label>
              <p className="text-[11px] text-muted">
                ตอนนี้: งวด {cfg.cutoffDay} → {cfg.cutoffDay - 1} · เพดาน{' '}
                {(cfg.workHourCapMinutes / 60).toFixed(1)} ชม./วัน (ชนเพดาน = timer หยุด + บล็อก)
                {cfg.memberDomain
                  ? ` · อีเมล ${cfg.memberDomain} login ได้เองเป็น member`
                  : ' · auto-provision member ปิดอยู่ — เพิ่มผู้ใช้งานเองเท่านั้น'}
              </p>
            </div>
          )}
        </div>

        <IcsLinkCard />

        <ProjectStatusSettings />

        <BoardPresetSettings />

        <ServiceTypeSettings />

        <ProductTypeSettings />

        <TaskTypeSettings />

        <LabelSettings />

        <GcalSettings />
      </div>
    </>
  )
}
