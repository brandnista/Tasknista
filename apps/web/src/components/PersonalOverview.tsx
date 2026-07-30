import { useNavigate } from 'react-router'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { MyWorkSummary, type MyWorkTask } from './MyWorkSummary'

/** ภาพรวมงานของฉัน — สรุปงานที่ตัวเองรับผิดชอบข้ามทุกโปรเจกต์ เห็นเฉพาะพนักงาน (member) วางเหนือ "งานวันนี้"/"งานเร็วๆ นี้" เดิม */
export function PersonalOverview() {
  const navigate = useNavigate()
  const { data, loading } = useLoad<MyWorkTask[]>(() => api.get('/api/tasks/mine'))

  if (loading || !data) return null

  return (
    <div className="mb-6">
      <div className="text-sm font-semibold text-body mb-3">ภาพรวมงานของฉัน</div>
      <MyWorkSummary tasks={data} onOpenTask={(t) => navigate(`/projects/${t.projectId}?task=${t.id}`)} />
    </div>
  )
}
