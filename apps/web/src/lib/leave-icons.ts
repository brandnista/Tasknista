// Pronista §Leave Request Phase 2 (2026-09-22) — แม็ป LEAVE_ICON_NAMES (core, แค่ชื่อ string) → lucide component จริง
// mirror pattern TYPE_ICON ใน apps/web/src/pages/Vault.tsx
import { Baby, Briefcase, Calendar, Clock, HeartPulse, PauseCircle, Plane, ShieldAlert, type LucideIcon } from 'lucide-react'

export const LEAVE_ICON_MAP: Record<string, LucideIcon> = {
  calendar: Calendar,
  'heart-pulse': HeartPulse,
  briefcase: Briefcase,
  'pause-circle': PauseCircle,
  plane: Plane,
  baby: Baby,
  'shield-alert': ShieldAlert,
  clock: Clock,
}

export function leaveIconOf(icon: string | null | undefined): LucideIcon {
  return (icon && LEAVE_ICON_MAP[icon]) || Calendar
}
