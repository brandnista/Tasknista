/** Pronista §Workspace/Task Jira-alignment (2026-09-04) — URL แชร์ได้เต็มของ task (ไม่มี APP_URL ฝั่ง frontend มาก่อน ใช้ origin ปัจจุบันตรงๆ) */
export function taskUrl(id: string): string {
  return `${window.location.origin}/tasks/${id}`
}

const KIND_LABEL: Record<string, string> = {
  epic: 'Epic',
  story: 'Story',
  task: 'Task',
  subtask: 'Subtask',
  defect: 'Defect',
  backlog: 'Backlog',
  cr: 'CR',
}

/** ข้อความสำหรับ toastAction ตอนสร้างงานสำเร็จ — "สร้าง [ประเภทงาน] [ชื่อ Task] สำเร็จ" */
export function taskCreatedMessage(kind: string, title: string): string {
  return `สร้าง ${KIND_LABEL[kind] ?? 'งาน'} ${title} สำเร็จ`
}
