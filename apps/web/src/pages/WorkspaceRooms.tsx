/**
 * Pronista §Workspace Rooms — เมนู Workspace เจอหน้านี้ก่อน: รายชื่อ "ห้อง" ทำงาน (Workspace DEV/HR/Brandnista ฯลฯ)
 * กด "+ สร้าง Workspace" ตั้งชื่อ+เพิ่มสมาชิก → กดเข้าห้อง ไปที่ /workspace/:id (หน้า Backlog/Sprint เดิม)
 */
import { Layers, Plus, Users, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { PageHeader } from '../components/PageHeader'
import { api, ApiError } from '../lib/api'
import { ROLE_LABEL } from '../lib/role-label'
import { useLoad } from '../lib/useLoad'

interface WorkspaceRoom { id: string; name: string; memberCount: number; createdAt: string }
interface UserOpt { id: string; name: string; role: 'owner' | 'member' | 'vendor' | 'guest'; avatarUrl: string | null }

const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

function CreateWorkspaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: users } = useLoad<UserOpt[]>(() => api.get('/api/users'))
  const [name, setName] = useState('')
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      await api.post('/api/workspaces', { name: name.trim(), memberIds })
      onCreated()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'สร้าง Workspace ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
  const label = 'text-xs font-medium text-muted mb-1 block'

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-14 mx-auto w-full max-w-sm px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-ink text-sm">สร้าง Workspace</div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
          </div>
          {error && <div className="bg-danger-50 text-danger-700 text-xs rounded-lg px-3 py-2 mb-3">{error}</div>}
          <div className="space-y-3">
            <div>
              <label className={label}>ชื่อ Workspace</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น Workspace DEV" className={input} autoFocus />
            </div>
            <div>
              <label className={label}>สมาชิก (เลือกได้หลายคน — ตัวเองเข้าห้องอัตโนมัติอยู่แล้ว)</label>
              <div className="border border-border-subtle rounded-lg max-h-48 overflow-y-auto divide-y divide-divider">
                {(users ?? []).map((u) => (
                  <label key={u.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-hover">
                    <input type="checkbox" checked={memberIds.includes(u.id)} onChange={() => setMemberIds(toggle(memberIds, u.id))} />
                    <span className="text-body">{u.name}</span>
                    <span className="text-[11px] text-muted ml-auto">{ROLE_LABEL[u.role]}</span>
                  </label>
                ))}
              </div>
              {memberIds.length > 0 && <div className="text-[11px] text-brand-700 mt-1">เลือก {memberIds.length} คน</div>}
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={onClose} className="flex-1 text-sm border border-border-subtle rounded-lg px-3 py-2 text-dim hover:bg-hover">ยกเลิก</button>
            <button onClick={() => void create()} disabled={!name.trim() || busy} className="flex-1 text-sm bg-brand-600 text-white rounded-lg px-3 py-2 hover:bg-brand-700 font-medium disabled:opacity-40">
              {busy ? 'กำลังสร้าง…' : 'สร้าง'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function WorkspaceRoomsPage() {
  const navigate = useNavigate()
  const { data, reload } = useLoad<WorkspaceRoom[]>(() => api.get('/api/workspaces'))
  const [creating, setCreating] = useState(false)
  const rooms = data ?? []

  return (
    <>
      <PageHeader
        title="Workspace"
        action={
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 text-sm bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 font-medium"
          >
            <Plus className="w-4 h-4" /> สร้าง Workspace
          </button>
        }
      />
      <div className="p-3 sm:p-6">
        {rooms.length === 0 ? (
          <div className="bg-white rounded-lg shadow-xs p-10 text-center">
            <Layers className="w-8 h-8 text-muted mx-auto mb-2" />
            <div className="text-sm text-muted mb-3">ยังไม่มี Workspace — สร้างห้องแรกของทีมได้เลย</div>
            <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 text-sm bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 font-medium">
              <Plus className="w-4 h-4" /> สร้าง Workspace
            </button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rooms.map((r) => (
              <button
                key={r.id}
                onClick={() => navigate(`/workspace/${r.id}`)}
                className="bg-white rounded-lg shadow-xs p-4 text-left hover:shadow-sm hover:border-brand-300 border border-transparent transition"
              >
                <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 grid place-items-center mb-2">
                  <Layers className="w-5 h-5" />
                </div>
                <div className="font-semibold text-ink text-sm truncate">{r.name}</div>
                <div className="flex items-center gap-1 text-[11px] text-muted mt-1">
                  <Users className="w-3 h-3" /> {r.memberCount} คน
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {creating && (
        <CreateWorkspaceModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); void reload() }}
        />
      )}
    </>
  )
}
