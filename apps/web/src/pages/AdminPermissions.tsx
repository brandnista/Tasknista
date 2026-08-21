/** Pronista §System Requirements Update — "ตั้งค่าสิทธิ์ผู้ใช้งาน" เมนูย่อยของ ตั้งค่า: เพดานสิทธิ์ต่อประเภทผู้ใช้งาน + ตำแหน่งและสิทธิ์ */
import { PageHeader } from '../components/PageHeader'
import { PermissionCeilingSettings } from '../components/PermissionCeilingSettings'
import { PositionSettings } from '../components/PositionSettings'

export function AdminPermissionsPage() {
  return (
    <>
      <PageHeader title="ตั้งค่าสิทธิ์ผู้ใช้งาน" />
      <div className="p-3 sm:p-6 space-y-4">
        <PermissionCeilingSettings />
        <PositionSettings />
      </div>
    </>
  )
}
