import { createDb, docLinks, projects, taskReferences, tasks } from '@seedoffice/db'
import { and, eq } from 'drizzle-orm'
import { writeAudit } from './audit'
import { nextOriginRefCode } from './origin-code'
import { nextTaskCode, sanitizeCodePrefix } from './task-code'

export type BreakoutDocType = 'MOM' | 'BRD' | 'SOW' | 'SRS' | 'PEP' | 'UIR'

// กฎ Traceability (docs/traceability-spec.md §2): เล่ม N อ้างอิงได้เฉพาะเล่ม N-1 — ยกเว้น PEP (เดิมชื่อ PROP) ที่อ้างอิงข้ามไป SOW โดยตรง
// UIR (User Interface Review, เดิมใช้รหัส SRC) ต่อจาก SRS เป็นชั้นที่ 6 — รายการหน้าจออ้างอิงรหัส FR ของ SRS
// ใช้กรองตอน resolve referenceCodes กันรหัสชนกันข้ามเล่ม (เช่น BRD เผลอพิมพ์รหัส SRS จะไม่จับคู่ให้ → ขึ้น unresolved เตือนแทน)
const EXPECTED_UPSTREAM: Record<BreakoutDocType, BreakoutDocType | null> = {
  MOM: null,
  BRD: 'MOM',
  SOW: 'BRD',
  SRS: 'SOW',
  PEP: 'SOW',
  UIR: 'SRS',
}

export interface BreakoutItemInput {
  sourceCode: string | null
  title: string
  description: string
  priority: 'low' | 'normal' | 'high' | null
  referenceCodes: string[] // originCode ของ Task ในเล่มก่อนหน้า (โปรเจกต์เดียวกัน) ที่แถวนี้พิมพ์อ้างอิงไว้
}

/**
 * Pronista §Document Traceability — สร้าง Task จริงจากรายการที่แตกออกจากเอกสาร MOM/BRD/SOW/SRS (ผ่านตาราง breakoutToTasks)
 * เวอร์ชัน generic ของ createTasksFromSrsItems (srs-tasks.ts) ที่ยังคงอยู่แยกต่างหากสำหรับ flow SRS เดิมจากหน้าโปรเจกต์ (ไม่แตะ)
 * ใช้ร่วมกัน 2 ทาง: (1) ปุ่ม "แตกเป็น Task" ในฟอร์ม Template (`docs.ts` POST /docs/:id/breakout) (2) อัปโหลดไฟล์ Word จริง (`docs-upload-breakout.ts`)
 * นอกจากเดินเลขที่งาน + รหัสอ้างอิง (origin-code.ts) แล้ว ยัง resolve `referenceCodes[]` → หา Task ในโปรเจกต์เดียวกันที่ originCode ตรงกัน → insert task_references
 * (รหัสที่หาไม่เจอ = ใส่ใน unresolvedReferences คืนกลับไปเตือน ไม่ block การสร้าง — อาจเป็นรหัสพิมพ์ผิดหรือยังไม่แตก Task เล่มก่อนหน้า)
 */
export async function createTasksFromBreakoutItems(
  db: ReturnType<typeof createDb>,
  env: Env,
  params: {
    project: typeof projects.$inferSelect
    docId: string
    docType: BreakoutDocType
    docVersion: string
    items: BreakoutItemInput[]
    createdBy: string
  },
): Promise<{ tasks: (typeof tasks.$inferSelect)[]; duplicateWarnings: string[]; unresolvedReferences: string[] }> {
  const { project, docId, docType, docVersion, items, createdBy } = params
  const codePrefix = sanitizeCodePrefix(project.code, 'TASK')
  const duplicateWarnings: string[] = []
  const unresolvedReferences: string[] = []
  const createdTasks: (typeof tasks.$inferSelect)[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (item.sourceCode) {
      const dup = (
        await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.projectId, project.id), eq(tasks.originCode, item.sourceCode)))
          .limit(1)
      )[0]
      if (dup) duplicateWarnings.push(item.sourceCode)
    }
    const code = await nextTaskCode(db, codePrefix)
    const originRefCode = await nextOriginRefCode(db, codePrefix, docType, docVersion)
    const created = (
      await db
        .insert(tasks)
        .values({
          projectId: project.id,
          groupId: null,
          sortOrder: i,
          code,
          title: item.title,
          description: item.description,
          priority: item.priority ?? 'normal',
          originDocType: docType,
          originCode: item.sourceCode,
          originRefCode,
          originDocId: docId,
          createdBy,
        })
        .returning()
    )[0]!
    createdTasks.push(created)
    await db.insert(docLinks).values({ docId, taskId: created.id, createdBy })
    await writeAudit(env, {
      actorId: createdBy,
      action: 'task.create',
      entity: 'task',
      entityId: created.id,
      meta: { title: created.title, docBreakout: true, docType, originRefCode, originCode: item.sourceCode },
    })

    const expectedUpstream = EXPECTED_UPSTREAM[docType]
    for (const rawRefCode of item.referenceCodes) {
      const refCode = rawRefCode.trim()
      if (!refCode) continue
      const upstream = expectedUpstream
        ? (
            await db
              .select({ id: tasks.id })
              .from(tasks)
              .where(and(eq(tasks.projectId, project.id), eq(tasks.originCode, refCode), eq(tasks.originDocType, expectedUpstream)))
              .limit(1)
          )[0]
        : undefined
      if (!upstream) {
        unresolvedReferences.push(refCode)
        continue
      }
      await db.insert(taskReferences).values({ taskId: created.id, referencesTaskId: upstream.id }).onConflictDoNothing()
    }
  }
  return { tasks: createdTasks, duplicateWarnings, unresolvedReferences }
}
