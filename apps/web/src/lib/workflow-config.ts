import { useEffect, useState } from 'react'
import { api } from './api'

/**
 * Pronista §Task status workflow phase 3 (2026-10-02) — สถานะ "เปิด flow ใหม่หรือยัง" ที่หน้าเว็บทุกหน้าใช้ร่วมกัน
 * (คอลัมน์ Kanban 7 ช่อง/ตัวกรองสถานะ/กติกาลากสถานะ) · โหลดครั้งเดียวต่อการโหลดหน้าเว็บ แล้วแชร์ผ่านโมดูลนี้ — ตั้งค่าเปลี่ยนแล้วรีเฟรชหน้าถึงมีผล
 * ล้มเหลว = ถือว่าปิด (พฤติกรรมเดิมของระบบ) ไม่ทำให้หน้าพัง
 */
export interface WorkflowClientConfig {
  enabled: boolean
  /** ประเภทงานที่ใช้ flow Document (ที่เหลือ/ไม่เลือกประเภท = flow Deployment) */
  documentTypeIds: string[]
}

const OFF: WorkflowClientConfig = { enabled: false, documentTypeIds: [] }
let current: WorkflowClientConfig = OFF
let inflight: Promise<void> | null = null
let loaded = false
const listeners = new Set<(c: WorkflowClientConfig) => void>()

function load(): Promise<void> {
  if (!inflight) {
    inflight = api
      .get<WorkflowClientConfig>('/api/tasks/workflow-config')
      .then((c) => {
        current = { enabled: c.enabled === true, documentTypeIds: Array.isArray(c.documentTypeIds) ? c.documentTypeIds : [] }
      })
      .catch(() => {
        current = OFF
      })
      .finally(() => {
        loaded = true
        for (const l of listeners) l(current)
      })
  }
  return inflight
}

/** บังคับโหลดใหม่ (เรียกหลังบันทึกหน้าตั้งค่า) */
export function refreshWorkflowConfig(): Promise<void> {
  inflight = null
  return load()
}

export function useWorkflowConfig(): WorkflowClientConfig {
  const [cfg, setCfg] = useState<WorkflowClientConfig>(current)
  useEffect(() => {
    listeners.add(setCfg)
    if (loaded) setCfg(current)
    else void load()
    return () => {
      listeners.delete(setCfg)
    }
  }, [])
  return cfg
}

/** งานชิ้นนี้ใช้ flow Deployment หรือไม่ (สวิตช์เปิด + ประเภทงานไม่ใช่ประเภทที่ตั้งเป็น Document) — งานย่อยที่ไม่มีประเภทเองถือเป็น Deployment (ตัดสินแน่นอนที่ server) */
export const isDeploymentTask = (cfg: WorkflowClientConfig, task: { taskType?: string | null }): boolean =>
  cfg.enabled && !(task.taskType && cfg.documentTypeIds.includes(task.taskType))
