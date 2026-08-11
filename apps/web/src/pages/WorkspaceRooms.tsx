/**
 * Pronista §Workspace Rooms — เมนู Workspace เจอหน้านี้ก่อน: รายชื่อ "ห้อง" ทำงาน (Workspace DEV/HR/Brandnista ฯลฯ)
 * กด "+ สร้าง Workspace" ตั้งชื่อ+เพิ่มสมาชิก → กดเข้าห้อง ไปที่ /workspace/:id (หน้า Backlog/Sprint เดิม)
 */
import { Briefcase, Code2, Grid2x2, Layers, List, Plus, Users, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { PageHeader } from '../components/PageHeader'
import { api, ApiError } from '../lib/api'
import { ROLE_LABEL } from '../lib/role-label'
import { useLoad } from '../lib/useLoad'

type WorkspaceType = 'business' | 'developer'
interface WorkspaceRoom { id: string; name: string; type: WorkspaceType; memberCount: number; createdAt: string }
interface UserOpt { id: string; name: string; role: 'owner' | 'member' | 'vendor' | 'guest'; avatarUrl: string | null }

// Pronista §System Requirements Update — ประเภทห้อง: Business = Backlog เดี่ยว (List/Kanban + Import task) · Developer = Backlog+Sprint เต็มรูปแบบ
export const WORKSPACE_TYPE_LABEL: Record<WorkspaceType, string> = { business: 'Business', developer: 'Developer' }
export const WORKSPACE_TYPE_DESC: Record<WorkspaceType, string> = {
  business: 'คีย์ Backlog มุมมอง List/Kanban + นำเข้างานได้ — ไม่มี Sprint',
  developer: 'คีย์ Backlog + ลากงานเข้า Sprint ได้เต็มรูปแบบ',
}

const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

function CreateWorkspaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { data: users } = useLoad<UserOpt[]>(() => api.get('/api/users'))
  const [name, setName] = useState('')
  const [type, setType] = useState<WorkspaceType>('developer')
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      const created = await api.post<{ id: string }>('/api/workspaces', { name: name.trim(), type, memberIds })
      onCreated(created.id)
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
              <label className={label}>ประเภท Workspace</label>
              <div className="grid grid-cols-2 gap-2">
                {(['developer', 'business'] as WorkspaceType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`text-left rounded-lg border px-3 py-2 transition ${type === t ? 'border-brand-400 bg-brand-50' : 'border-border-subtle hover:bg-hover'}`}
                  >
                    <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
                      {t === 'developer' ? <Code2 className="w-3.5 h-3.5" /> : <Briefcase className="w-3.5 h-3.5" />}
                      {WORKSPACE_TYPE_LABEL[t]}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5">{WORKSPACE_TYPE_DESC[t]}</div>
                  </button>
                ))}
              </div>
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
  // Pronista §System Requirements Update — สลับมุมมอง List/Grid เหมือนเมนูเอกสาร จำค่าไว้ที่เครื่อง
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => (localStorage.getItem('workspace-rooms-view-mode') === 'list' ? 'list' : 'grid'))
  const setView = (v: 'list' | 'grid') => { setViewMode(v); localStorage.setItem('workspace-rooms-view-mode', v) }
  // Pronista §Feedback batch — ค้นหา/กรองรายชื่อห้องด้วยชื่อ + ประเภท
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | WorkspaceType>('all')
  const allRooms = data ?? []
  const q = search.trim().toLowerCase()
  const rooms = allRooms.filter((r) => (typeFilter === 'all' || r.type === typeFilter) && (!q || r.name.toLowerCase().includes(q)))

  return (
    <>
      <PageHeader
        title="Workspace"
        action={
          <div className="flex items-center gap-2">
            {rooms.length > 0 && (
              <div className="flex items-center gap-0.5 bg-hover rounded-lg p-0.5">
                <button
                  onClick={() => setView('list')}
                  title="มุมมองรายการ"
                  className={`w-7 h-7 grid place-items-center rounded-md ${viewMode === 'list' ? 'bg-white shadow-xs text-brand-700' : 'text-muted hover:text-soft'}`}
                >
                  <List className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setView('grid')}
                  title="มุมมองตาราง"
                  className={`w-7 h-7 grid place-items-center rounded-md ${viewMode === 'grid' ? 'bg-white shadow-xs text-brand-700' : 'text-muted hover:text-soft'}`}
                >
                  <Grid2x2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 text-sm bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 font-medium"
            >
              <Plus className="w-4 h-4" /> สร้าง Workspace
            </button>
          </div>
        }
      />
      <div className="p-3 sm:p-6">
        {allRooms.length === 0 ? (
          <div className="bg-white rounded-lg shadow-xs p-10 text-center">
            <Layers className="w-8 h-8 text-muted mx-auto mb-2" />
            <div className="text-sm text-muted mb-3">ยังไม่มี Workspace — สร้างห้องแรกของทีมได้เลย</div>
            <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 text-sm bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 font-medium">
              <Plus className="w-4 h-4" /> สร้าง Workspace
            </button>
          </div>
        ) : (
        <>
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ Workspace…"
            className="text-sm bg-white border border-border rounded-lg px-3 py-1.5 w-56"
          />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'all' | WorkspaceType)} className="text-sm bg-white border border-border rounded-lg px-2.5 py-1.5">
            <option value="all">ทุกประเภท</option>
            {(['developer', 'business'] as WorkspaceType[]).map((t) => <option key={t} value={t}>{WORKSPACE_TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        {rooms.length === 0 ? (
          <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted">ไม่พบ Workspace ตามตัวกรองนี้</div>
        ) : viewMode === 'grid' ? (
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
                <div className="flex items-center gap-1.5">
                  <div className="font-semibold text-ink text-sm truncate">{r.name}</div>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${r.type === 'developer' ? 'bg-info-50 text-info-700' : 'bg-teal-50 text-teal-700'}`}>{WORKSPACE_TYPE_LABEL[r.type]}</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted mt-1">
                  <Users className="w-3 h-3" /> {r.memberCount} คน
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-xs divide-y divide-divider">
            {rooms.map((r) => (
              <button
                key={r.id}
                onClick={() => navigate(`/workspace/${r.id}`)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-hover"
              >
                <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-700 grid place-items-center shrink-0">
                  <Layers className="w-4 h-4" />
                </div>
                <div className="font-medium text-ink text-sm truncate">{r.name}</div>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${r.type === 'developer' ? 'bg-info-50 text-info-700' : 'bg-teal-50 text-teal-700'}`}>{WORKSPACE_TYPE_LABEL[r.type]}</span>
                <div className="flex items-center gap-1 text-[11px] text-muted ml-auto shrink-0">
                  <Users className="w-3 h-3" /> {r.memberCount} คน
                </div>
              </button>
            ))}
          </div>
        )}
        </>
        )}
      </div>

      {creating && (
        <CreateWorkspaceModal
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); void reload(); window.open(`/workspace/${id}`, '_blank') }}
        />
      )}
    </>
  )
}
