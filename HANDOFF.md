# Tasknista (newtask-app) — Development Handoff

> เขียนไว้ให้ทำงานต่อได้ในเครื่อง/session อื่น โดยไม่ต้องไล่อ่าน conversation เดิม
> อัปเดตล่าสุด: 2026-07-30

## 1. โปรเจกต์นี้คืออะไร

**Tasknista** — แอปบริหารงาน (task/project management) ที่ fork มาจาก **SeedOffice** (internal tool ของทีม SeedWebs สำหรับ งาน→ชั่วโมง→เงิน) แล้วต่อยอดเพิ่มระบบ **Backlog + Sprint + Sub-tasks + Product/Project task types + ระบบเอกสาร (Document Management/Traceability)** ที่ไม่มีใน SeedOffice ต้นทาง

- `CLAUDE.md` (root) = กติกาการทำงานเดิมของ SeedOffice (ภาษาไทย, เงิน=สตางค์ integer, Tailwind v4 token ฯลฯ) — **ยังใช้ได้กับ repo นี้เกือบทั้งหมด**
- `SPEC.md`, `tasks/PROGRESS.md`, `tasks/plan.md`, `tasks/todo.md` = เอกสารของ **SeedOffice ต้นทาง** (ก่อน fork) — **ล้าสมัยสำหรับฟีเจอร์ Tasknista** (Sprint/SRS/Docs/Traceability ทั้งหมดด้านล่างไม่ได้ sync เข้าไฟล์พวกนี้) ใช้อ้างอิงเฉพาะ stack/convention/กฎเหล็กเท่านั้น
- เอกสารนี้ (`HANDOFF.md`) คือ source of truth ของสิ่งที่ต่อยอดเพิ่มบน Tasknista

## 2. Stack & โครงสร้าง

pnpm workspaces:
- `apps/web` — React 19 + Vite + React Router 7 + Tailwind v4 (ดูตารางแปลง class v3→v4 + design token ใน `CLAUDE.md`)
- `apps/api` — Hono 4 บน Cloudflare Workers
- `packages/db` — Drizzle ORM + D1 (sqlite) — schema: `packages/db/src/schema.ts`, migrations: `packages/db/migrations/0000...0049*.sql` (hand-written ปนกับ generated — ดู §6)
- `packages/core` — pure domain logic (เทสต์ง่าย ไม่แตะ DB/HTTP)
- ไฟล์แนบ = R2 (binding `FILES`)
- **เป็น git repo แล้ว** (init 2026-07-30) — remote: `https://github.com/thanawatbrandnista-arm/Tasknista` (branch `master`) มี commit เดียว ("Initial commit") ยังไม่มี PR/branch workflow ให้ไล่ ใช้ไฟล์นี้แทนถ้าต้องการ context เชิงฟีเจอร์ (commit history มีแค่ snapshot เดียว ไม่ได้ไล่ตามลำดับ stream)
  - ⚠️ **ไฟล์ที่ไม่ติดไปกับ git** (อยู่ใน `.gitignore` โดยตั้งใจ): `.dev.vars` (secret จริง — คัดลอกจากเครื่องเดิมเอง หรือ copy จาก `.dev.vars.example` แล้วกรอกใหม่), `.wrangler/` (ฐานข้อมูล D1 local ทั้งหมด — เครื่องใหม่จะเริ่มด้วยฐานข้อมูลว่าง ต้อง `pnpm db:migrate` แล้ว seed/สร้างข้อมูลทดสอบเองใหม่ หรือคัดลอกโฟลเดอร์นี้มาจากเครื่องเดิมถ้าอยากได้ข้อมูลเดิม), `node_modules/`
  - ⚠️ **ยังไม่เคย deploy ขึ้น Cloudflare จริง** และ **ยังไม่เคย apply migration ขึ้น D1 remote (production)** — เครื่องที่ต่อยอดต้องรัน `wrangler login` ก่อน (ตอนนี้ `wrangler whoami` ยัง "not authenticated" อยู่) แล้วค่อย `pnpm db:migrate:remote` + `pnpm deploy`

### คำสั่งหลัก
```
pnpm dev            # เริ่ม dev server (web :5173 proxy → api :8787 ผ่าน wrangler dev)
pnpm typecheck       # tsc --noEmit ทั้ง web+api (หรือ pnpm --filter web/api run typecheck แยกได้)
pnpm test            # vitest (core/db/api)
pnpm db:migrate       # wrangler d1 migrations apply seedoffice --local
```
Dev login: `POST /api/auth/dev-login {"email":"bank@team.local"}` (มี dev users อื่นดูใน `packages/db` seed/schema `DEV_AUTH=1` ใน `.dev.vars`)

⚠️ **wrangler d1 execute --local (CLI) กับ wrangler dev ที่รันอยู่แล้ว อาจเห็นข้อมูลไม่ตรงกัน** เจอบั๊กนี้ตอนเคลียร์ข้อมูลรอบล่าสุด (ดู §7) — ถ้าต้องแก้ข้อมูลตรงๆ ให้เชื่อผลจาก `curl localhost:8787/api/...` (ของจริงที่ UI เห็น) มากกว่าผลจาก `wrangler d1 execute` CLI แยก
⚠️ wrangler dev เจอ native crash บน Windows เป็นระยะ (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`) — เป็น known flaky bug ของ wrangler/Windows ไม่เกี่ยวกับโค้ด

## 3. ฟีเจอร์ที่ต่อยอดบน Tasknista (เรียงตามลำดับที่ทำ)

### 3.1 Backlog + Sprint + Board
- Schema: `board_presets` (config), `sprints`, `tasks.sprintId`/`sprintStatus`
- Backend: `apps/api/src/routes/sprints.ts`, board preset settings routes, cron auto-complete overdue sprints
- Frontend: `Board.tsx` (Kanban + Timeline switcher), แท็บ Sprint ใน `ProjectDetail.tsx` (default view), Backlog/Sprint side-by-side layout, drag-to-sprint, `SprintSnapshot.tsx` (ดู sprint history เป็น board snapshot), `BoardPresetSettings.tsx`
- Migration: `0037_sprint_board.sql`, `0038_sprint_report_snapshot.sql`, `0040_sprint_preset_at_start.sql`, `0041_sprint_task_snapshots.sql`

### 3.2 SRS Document Import → แตกเป็น Task อัตโนมัติ
- อัปโหลดเอกสาร SRS (.docx) → parse หัวข้อ/ตาราง requirement → gen task พร้อมรหัสอ้างอิง (SRS ref code) ลง Backlog
- Backend: `apps/api/src/routes/docs-srs.ts`, `lib/srs-tasks.ts`, `lib/srs-code.ts`, `lib/docx-parse.ts`
- Frontend: `SrsImportModal.tsx`, `SrsLinkedTasksSection.tsx`, chip อ้างอิง SRS บน Task card/`TaskDrawer.tsx`
- Migration: `0039_srs_import.sql`

### 3.3 Document Templates (สร้างเอกสารจากฟอร์ม → export DOCX/PDF)
- ระบบ template สำหรับเอกสาร MOM/BRD/SOW/SRS/PEP/UIR — กรอกฟอร์มในเว็บ → gen ทั้งเอกสาร (พร้อมเลขที่เอกสารรันตาม codename โปรเจกต์) → export เป็น .docx (โลโก้/สีตรงแบรนด์) หรือพิมพ์เป็น PDF
- Core: `packages/core/src/doc-templates/{mom,brd,sow,srs,pep,uir}.ts` + `registry.ts` + `schema.ts` (นิยามโครงสร้าง section ของแต่ละประเภท — ไม่เก็บใน DB)
- Backend: doc-template routes ใน `docs.ts` (`POST /api/docs/template`, `PATCH /:id/template-values`), `lib/docx-parse.ts` (parse ตาราง), docx builder + mom-mapper (export)
- Frontend: `TemplateFillForm` + `TemplatePickerModal.tsx` (`components/doc-templates/`), `TemplatePrintView` (พิมพ์ PDF), ปุ่ม "เอกสาร Template" ใน AddMenu ของ `Docs.tsx`
- Folder system: เอกสาร template auto-จัดเข้าโฟลเดอร์ตามประเภท (`findOrCreateTemplateFolder` ใน `docs.ts`)
- Migration: `0042_doc_templates.sql`

### 3.4 Project Estimate
- ประมาณการงบ/ต้นทุนโปรเจกต์ พร้อม cost buffer % (override ได้ต่อ task), ซ่อน timer ระหว่าง sprint active
- Core: `packages/core/src/estimate.ts` (+ `estimate.test.ts`)
- Backend: endpoints ใน `projects.ts`/`task-detail.ts` (permission-tested)
- Frontend: `ProjectEstimateSection` (component ใน ProjectDetail), ฟิลด์ estimate ใน `Admin.tsx` + `TaskDrawer.tsx`
- Migration: `0044_project_estimate_fields.sql`, `0045_task_cost_buffer_override.sql`

### 3.5 Document Traceability (ทั่วไปสำหรับทุกประเภทเอกสาร)
- ขยายจาก SRS-only (§3.2) ให้ครอบคลุม MOM/BRD/SOW/SRS/PEP/UIR — ทุกประเภทอัปโหลด .docx → parse ตารางเป็น task พร้อมรหัสอ้างอิงต้นทาง (`originDocType`/`originCode`/`originRefCode`/`originDocId`) และอ้างอิงข้ามเอกสาร (`task_references` — BR อ้าง MOM, FR อ้าง BR ฯลฯ)
- Backend: `apps/api/src/routes/docs-upload-breakout.ts` (`POST /docs/upload-breakout/parse` + `/confirm`), `lib/doc-breakout-tasks.ts` (สร้าง task + resolve reference codes)
- Frontend: `DocUploadBreakoutModal.tsx` (อัปโหลด → review → confirm), แถวอ้างอิงเอกสารใน `TaskDrawer.tsx` ("การอ้างอิงเอกสาร" section)
- ไฟล์อ้างอิงเพิ่มเติม: `traceability-spec.md` (ถ้ายังอยู่ในโปรเจกต์ — เอกสารออกแบบละเอียดของฟีเจอร์นี้)

### 3.6 Document Attachments + PEP + External Document Version Logging
- `doc_attachments` — แนบเอกสารเข้ากับ task/sub-task (ไม่ใช่แค่ต้นทาง breakout)
- Rename **PROP → PEP** (Project Execution Proposal) ทั่วทั้งระบบ, เพิ่ม **UIR** (เดิมชื่อ SRC) เป็นประเภทเอกสารที่ 6
- **External Document Version Logging** — เอกสารออกแบบภายนอก (Canva/Figma ฯลฯ) ที่ไม่ได้อัปโหลดไฟล์จริงเข้าระบบ แต่ log เป็นเวอร์ชัน append-only ต่อโปรเจกต์ (status draft/under_review/approved + ผูก SOW task ที่เกี่ยวข้อง)
  - Backend: `apps/api/src/routes/external-doc-logs.ts`
  - Frontend: แท็บ **"External Design Assets"** ใน ProjectDetail (`ExternalDesignAssetsSection.tsx`)
- Migration: `0046`, `0047_perfect_scourge.sql` (DOC_TYPES+PROP, doc_attachments), `0048_young_wonder_man.sql` (external_document_logs)

### 3.7 Docs menu UI overhaul (Google-Docs-style)
- เปลี่ยนหน้า "เอกสาร" จากทรีโฟลเดอร์ (MOM/BRD/SOW/... เป็นโฟลเดอร์บังคับ) → **รายการเอกสารแบบแบน** (flat list) + โฟลเดอร์แนะนำเป็นแค่ตัวกรอง (chip ด้านบน คลิกเพื่อกรอง ไม่ใช่ต้นไม้)
- Grid view: การ์ดไอคอนสีตามประเภทไฟล์จริง (Word=น้ำเงิน "W", PDF=แดง "PDF", รูปภาพ) + ผู้แก้ไขล่าสุด/เวลา
- List view: แถวเดิม + badge ประเภทเอกสาร + ชื่อโปรเจกต์
- ไฟล์: `apps/web/src/pages/Docs.tsx` (ใหญ่ที่สุดในระบบเอกสาร), แท็บ "เอกสาร" ใน `ProjectDetail.tsx` (แยกซับแท็บตามประเภทเอกสาร)
- Nav highlight bug fix: `Layout.tsx` ใช้ longest-matching-prefix แทน built-in `isActive` (กัน "เอกสาร" ติดสว่างพร้อม "ประวัติเอกสาร")

### 3.8 เปิด/แก้ไขเอกสาร Word ในระบบ (ไม่ auto-download)
- ไฟล์ Word ที่อัปโหลด (ผ่านอัปโหลดทั่วไป **หรือ** breakout §3.5) เดิม auto-download ตอนกดเปิด → แก้เป็นแสดงเนื้อหาในระบบทันที
- อ่านอย่างเดียว: docx → HTML (escape กัน stored-XSS) แสดงใน `DocWordPreview` (`DocViewer.tsx`)
- แก้ไขได้: กด "แก้ไขเอกสาร" → docx → Markdown (ครั้งแรกเท่านั้น, idempotent) → เปิดใน TipTap editor (`DocEditor`) แก้ทั้งข้อความและ**ตาราง** (extension `@tiptap/extension-table` = TableKit) — ไฟล์ต้นฉบับดาวน์โหลดได้เสมอ ไม่ถูกทับ
- PDF ยังเปิด native ตามเดิม (ไม่ผ่าน flow นี้)
- Backend: `apps/api/src/lib/docx-render.ts` (`renderDocxToHtml`, `renderDocxToMarkdown` — parse zip+regex ไม่ใช้ full DOM parser), `GET /api/docs/:id/preview`, `POST /api/docs/:id/convert-to-editable` ใน `docs.ts`
- ข้อจำกัดที่ทราบ: ตารางที่มี **merged cells** ในไฟล์ Word ต้นฉบับ จะถูกแปลงเป็นตารางปกติ (ไม่รองรับ merge)

### 3.9 Document Version History (ประวัติเอกสารทุกชนิด)
- ก่อนหน้านี้หน้า "ประวัติเอกสาร" (`/docs/history`) โชว์แค่ External Design Assets (§3.6) — ตอนนี้ครอบคลุม**เอกสารภายในทุกชนิด**ด้วย
- โมเดล: **ประเภท (docType) → เล่ม (docNumber) → เวอร์ชัน (docVersion)** — เอกสารไม่มี docNumber = เล่มเดี่ยว keyed by title
- Schema: `docs.docNumber` + `docs.docVersion` (nullable, backfill จาก templateDocNumber/srsDocNumber/srsVersion เดิม) — migration `0049_doc_version_fields.sql`
- อัปโหลดไฟล์ผ่านทั้ง breakout flow (`DocUploadBreakoutModal.tsx`) จับเวอร์ชันจากชื่อไฟล์อัตโนมัติ (`parseFilenameMeta` — regex จับ `v1.0.1` ท้ายชื่อไฟล์) แก้ไขได้ก่อน save
- Backend: `GET /api/document-history` ใน `external-doc-logs.ts` (รวม doc ทุกชนิดที่ผูกโปรเจกต์) + ยังคงมี `GET /api/external-doc-logs` (External assets เดิม) — frontend fetch ทั้งคู่แล้วรวม
- Frontend: `DocumentHistory.tsx` — ตารางแบน (ไม่มี expand/collapse) คอลัมน์ **ประเภท/ชื่อเล่ม/โปรเจกต์/เวอร์ชัน/ผู้อัปโหลด/แก้ไขล่าสุด** ฟิลเตอร์ dropdown ตามประเภท+โปรเจกต์

### 3.10 Pagination (default 20, แก้ได้) — เมนู "เอกสาร" + "ประวัติเอกสาร"
- Component ใช้ร่วม: `apps/web/src/components/Pager.tsx` (`DEFAULT_PAGE_SIZE = 20`, ตัวเลือก 20/50/100/200 + ก่อนหน้า/ถัดไป)
- `Docs.tsx` แบ่งหน้าตาม "เอกสาร", `DocumentHistory.tsx` แบ่งหน้าตาม "เล่ม" (series)

### 3.11 ปุ่มจัดการเอกสาร (⋮ เปลี่ยนชื่อ/ย้ายไปโฟลเดอร์/ลบ)
- ทุกเอกสารในเมนู "เอกสาร" (List/Grid) ที่ user แก้ไขได้ (owner/editor) มีปุ่ม ⋮ hover-only
- 3 action: **เปลี่ยนชื่อ** (PATCH title), **ย้ายไปโฟลเดอร์** (modal เลือกโฟลเดอร์ปลายทางจากทุกโฟลเดอร์ในระบบ พร้อมย่อหน้าตามความลึก — PATCH parentId), **ลบ** (DELETE, soft-delete)
- Backend ไม่ต้องแก้ — ใช้ `PATCH /api/docs/:id` และ `DELETE /api/docs/:id` เดิม (มีอยู่แล้วรองรับ parentId/title/delete)
- Component ใหม่ใน `Docs.tsx`: `DocActionsMenu`, `MoveDocModal`, `buildFolderOptions()`, `DocGridCard`/`DocListRow` (แยกจาก DocsPage รับ prop `onMenu`)

## 3-B. "Back to Basic" — โครงสร้าง Task/Epic/Story/Sprint ใหม่ + Task Detail workflow (2026-07-27 – 2026-07-30)

หลัง §3.1-3.11 (เอกสาร/traceability) เจ้าของโปรเจกต์ขอกลับมาโฟกัสแกนหลัก Task/Epic/Story/Sprint ให้ลื่นไหลจริง งานรอบนี้ทำเป็นหลาย stream ต่อเนื่องกัน สรุปตามหัวข้อ (ไม่ใช่ตามลำดับ stream letter เพราะยาวเกินไป):

### 3-B.1 โครงสร้าง Task hierarchy (structural ไม่ใช่ enum-based)
- **Epic** = แถวแยกในตาราง `epics` (คนละตารางกับ `tasks`) — 1 Epic มีได้หลาย Story
- **Story** = แถวใน `tasks` ที่ `parentId IS NULL` (ระดับบนสุด)
- **Task** = ลูกของ Story (`parentId` ชี้ Story) — รหัสแบบจุด `<parentCode>.N`
- **Subtask** = ลูกของ Task (ชั้นที่ 3) — รหัสแบบจุดต่อกัน `<taskCode>.N`
- `tasks.kind` (`'task' | 'defect' | 'cr' | 'backlog'`) เป็นแค่ตัวบ่งชี้ประเภทงาน **ไม่เกี่ยวกับความลึกของ hierarchy** — Defect/CR ผูกกับ Epic/Story/Task/CR อื่นแบบ**อ้างอิง** (`task_references` table, มีมาตั้งแต่ migration `0046` ทำไว้เพื่อ traceability เอกสาร แล้วเอามาใช้ซ้ำ) ไม่ใช่ลูก-แม่
- `kind='backlog'` (ใหม่ล่าสุด, ดู §3-B.6) = งานทั่วไปที่ยังไม่จัดประเภท ไม่มีผลต่อ hierarchy เช่นกัน

### 3-B.2 เลขรหัส Task รูปแบบใหม่
- Format: `<ProjectCodePrefix>-<TypeLabel>-<ddmmyyyy>-<0001>` เช่น `MAK-Task-30072026-0001`, `MAK-Defect-30072026-0001`, `MAK-Backlog-30072026-0001` — `TypeLabel` ∈ `Epic/Story/Task/Defect/CR/Backlog` นับต่อเนื่องต่อ (โปรเจกต์+ประเภท) ไม่รีเซตรายวัน
- Logic อยู่ที่ `apps/api/src/lib/task-code.ts` (`nextTypedTaskCode`, `nextTypedEpicCode`) — เลขรหัส **regenerate ใหม่ทุกครั้งที่ convert ประเภท** (เก็บ oldCode→newCode ไว้ใน `audit_logs.meta` โผล่เป็น activity log ในหน้า Task Detail อัตโนมัติ ไม่ต้องมี table/endpoint แยก)
- รหัสลูกแบบจุด (Task/Subtask ระดับ 2-3) ยังใช้ `nextSubTaskCode` เดิม ไม่เกี่ยวกับ scheme นี้

### 3-B.3 จัดตำแหน่ง Tab ใหม่ (`ProjectDetail.tsx`)
- Tab บนสุดของหน้าโปรเจกต์เหลือแค่ **Sprint / เอกสาร / ประวัติเอกสาร** (API Document/Project Estimate tab ถอดออกจาก nav แต่ component/backend ยังอยู่ — deferred ไม่ใช่ลบ)
- Epic/Story/Task/Defect/CR ย้ายมาเป็น **sub-tab คงที่ของ Backlog** (`FIXED_BACKLOG_TABS`) ต่อท้าย tab เอกสารเดิม (ทั่วไป/SOW/MOM/...)
- แต่ละ tab มีเมนู "..." เชื่อมโยง/ยกระดับกันได้ (Epic↔Story ผ่าน `epicId`, Story↔Task ผ่าน `parentId`+convert, Defect/CR ผ่าน `task_references` โดยตรง) — component: `ProjectEpicTab`, `ProjectHierarchyTab` (ใช้ร่วม story/task/cr แยกด้วย prop `level`), `ProjectDefectSection`, `LinkOrCreateModal.tsx` (modal เลือก "สร้างใหม่" หรือ "เลือกที่มีอยู่แล้ว" ใช้ซ้ำหลายจุด)
- เพิ่ม sub-tab ใหม่ **"🌳 ภาพรวมโครงสร้าง"** (`ProjectSummaryTab`) — tree view Epic > Story > Task > Subtask ทั้งโปรเจกต์ (ไม่ใช่แค่ SOW) ดูอย่างเดียว ไม่มี drag/checkbox

### 3-B.4 Sprint: หลาย Sprint พร้อมกันได้จริง + Board แยกต่อ Sprint
- เดิมมีบั๊ก 2 ชั้น: (1) Sprint ที่ "รอคิว" ลากงานเข้าไม่ได้เลย (มีแค่ sprint แรกที่ลากได้) — แก้แล้ว ทุก sprint ที่ยังไม่ปิดมี dropzone ของตัวเอง (`GET /projects/:id/sprints/current` คืน `tasks` ของทุก sprint ไม่ใช่แค่ตัวแรก)
- (2) แม้ลากงานเข้าได้ทุกใบ แต่ **Start ได้แค่ 1 sprint ต่อโปรเจกต์พร้อมกัน** (เดิมมี guard `active_sprint_exists`) — **เอา guard นี้ออกแล้ว** Start ได้พร้อมกันหลายใบจริง แต่ละใบแยก **Board เป็นของตัวเอง** ผ่าน route `projects/:id/sprints/:sprintId/board` (เดิม `projects/:id/board` ตัวเดียว) + endpoint ใหม่ `GET /api/sprints/:id/board`
- ไฟล์หลัก: `apps/api/src/routes/sprints.ts`, `apps/web/src/pages/Board.tsx`, ส่วน `SprintSection`/`renderSprintCard` ใน `ProjectDetail.tsx`

### 3-B.5 Task Detail: สร้าง/ผูกเอกสาร + workflow "จ่ายงาน → ส่งงาน → อนุมัติ/ตีกลับ"
- **สร้าง/ผูกเอกสาร**: ปุ่ม "สร้าง/ผูกเอกสาร MOM/BRD/SOW/SRS/PEP/UIR/CR" ในหน้า Task Detail — สร้างจาก Template (reuse `TemplatePickerModal`), อัปโหลดไฟล์ระบุประเภท, หรือผูกเอกสารที่มีอยู่แล้วในโปรเจกต์เดียวกัน (ทั้งหมด reuse endpoint เดิมของเมนู "เอกสาร")
- **ตัดออก**: section "ข้อมูลเพิ่มเติม" (custom fields) และปุ่ม "เปลี่ยนผู้รับผิดชอบ" ที่ซ้ำซ้อนกับ select ด้านบน
- **เกต "จ่ายงาน" (`dispatchedAt`)**: assign คนแล้วงานยัง**ไม่โผล่**ในหน้า "งานของฉัน" ของคนนั้นจนกว่าผู้จ่ายงานจะกดปุ่ม "จ่ายงาน" (`POST /tasks/:id/dispatch` — เฉพาะผู้จ่ายงานเท่านั้น ไม่ใช่ assignee เอง) — เปลี่ยน assigneeId ใหม่ (รวมถึงเคลียร์เป็นว่าง) จะรีเซต `dispatchedAt` กลับเป็น null อัตโนมัติเสมอ
- **คนถูก assign เปลี่ยนสถานะเองได้แค่ผ่านปุ่ม** — dropdown สถานะอิสระถูกล็อกสำหรับ assignee (เห็นแค่ badge อ่านอย่างเดียว) กดปุ่ม "ส่งงาน" ได้ทางเดียว (`on_processing → waiting_for_test`) กระโดดไป Done เองไม่ได้ — ฝั่งผู้จ่ายงานเห็นปุ่ม "อนุมัติ ปิดงาน" (→done) หรือ "ตีกลับ ให้แก้ไข" (→on_processing) เมื่อสถานะเป็น waiting_for_test
- `TASK_STATUS_LABEL.waiting_for_test` label เปลี่ยนจาก "Waiting for Test" → **"Waiting for Review"** (enum value เดิมไม่แตะ กัน migration)
- ไฟล์หลัก: `apps/web/src/pages/TaskDetail.tsx`, `apps/api/src/routes/tasks.ts` (`POST /tasks/:id/dispatch`, `GET /tasks/mine` filter `isNotNull(dispatchedAt)`)

### 3-B.6 Backlog แยกประเภทจริง (`kind='backlog'`)
- ปัญหาที่พบ: แท็บ "ทั่วไป" ของ Backlog ดึงงานที่คีย์ลอยๆ จากแท็บ Story/Defect/CR มาปนด้วย เพราะทางโครงสร้าง งานเหล่านี้ (`parentId=null`, ไม่มี `originDocType`) หน้าตาเหมือนงานทั่วไปเป๊ะ แยกไม่ออก
- แก้ด้วยการเพิ่มค่า `kind='backlog'` ใหม่ (เฉพาะงานที่คีย์จากแท็บ "ทั่วไป" โดยตรง) — `GET /projects/:id/backlog` กรองเฉพาะ `kind='backlog'` หรือมี `originDocType` เท่านั้น ตัด Story/Defect/CR/Task-ลอยออกจากผลลัพธ์นี้ไปเลย (ไปโผล่เฉพาะแท็บของตัวเองผ่าน `/tasks/all`)
- ผลข้างเคียง: **ย้อนกลับ** ปุ่ม "สร้าง Task ลอยๆ" ในแท็บ Task ที่เคยเพิ่มไประหว่างทาง (ทำให้คีย์ Task แล้วดันไปโผล่แท็บ Story เพราะโครงสร้างเหมือนกันเป๊ะ) — แท็บ Task บังคับ "เลือก Story" ก่อนสร้างเหมือนเดิม

### Migrations 0050–0055 (schema เพิ่มของรอบนี้)
| Migration | เนื้อหา |
|---|---|
| `0050_remarkable_overlord.sql` | `notifications` table, `projects.apiDocNotes`, `tasks.assignedBy` |
| `0051_many_peter_parker.sql` | `task_checklist_items` table (เกณฑ์ว่าเสร็จ), `task_comments.isBlocked` |
| `0052_previous_monster_badoon.sql` | `epics` table + `tasks.epicId` |
| `0053_stiff_ezekiel_stane.sql` | `projects.deletedAt` (soft-delete โปรเจกต์) |
| `0054_material_captain_cross.sql` | `sprints.goal` |
| `0055_funny_bloodaxe.sql` | `tasks.dispatchedAt` (เกตจ่ายงาน §3-B.5) |

`tasks.kind` enum ขยายจาก `'task'\|'defect'` → เพิ่ม `'cr'` (ระหว่างทาง) → เพิ่ม `'backlog'` (ล่าสุด) **ไม่มี migration ของทั้งคู่** เพราะคอลัมน์เป็น TEXT ธรรมดาใน SQLite ไม่มี CHECK constraint บังคับ (แก้แค่ TS-level enum ที่ `packages/db/src/schema.ts`)

## 4. Schema/Migration reference (docs-related fields สำคัญ)

`docs` table (ดูเต็มที่ `packages/db/src/schema.ts`):
- `kind`: `'page' | 'link' | 'file' | 'template' | 'folder'`
- `docType`: `'MOM' | 'BRD' | 'SOW' | 'SRS' | 'PEP' | 'UIR' | 'CR'`
- `docNumber` / `docVersion` — เลขที่เอกสาร(เล่ม) + เวอร์ชัน (§3.9)
- `templateDocNumber` — เลขที่เอกสารที่ gen จาก template (§3.3, คนละ concept กับ docNumber แต่ backfill ไปแล้ว)
- `srsDocNumber` / `srsVersion` — ของเดิมก่อนจะ generalize เป็น docNumber/docVersion (ยังอยู่ใน schema เพื่อ backward-compat)
- `r2Key` / `mime` / `filename` — ไฟล์ที่อัปโหลด (R2)
- `contentMarkdown` — สำหรับหน้า wiki ปกติ และเอกสาร Word ที่แปลงเป็น editable แล้ว (§3.8)

ตารางที่เกี่ยวข้อง: `doc_links` (ผูก doc กับ project/task), `doc_members` (private sharing), `doc_attachments` (แนบเข้า task), `doc_template_values`, `doc_images`, `external_document_logs` (+ `external_document_log_sow_tasks` pivot), `task_references`, `sprints`, `board_presets`

Migrations 0037–0049 = ทั้งหมดของงานใน §3 (เรียงตามลำดับเวลา) — บาง migration hand-written (ดู pattern ที่ `CLAUDE.md` ไม่ได้พูดถึงแต่ทำตามมาตลอด: แก้ schema.ts → เขียน .sql มือ → patch `meta/*_snapshot.json` + `_journal.json` → apply ด้วย `wrangler d1 execute --local --file` ถ้า `pnpm db:migrate` ชนบั๊ก wrangler native crash)

## 5. ข้อมูล local dev ปัจจุบัน (2026-07-23 — ⚠️ อาจไม่ตรงกับปัจจุบันแล้ว หลัง §3-B มีการสร้าง/ลบโปรเจกต์ทดสอบเพิ่ม เช่นโปรเจกต์ชื่อ "test" ที่ใช้ verify งานทุก stream ใน §3-B — เชื่อของจริงจาก UI/`GET /api/projects` มากกว่ารายการด้านล่างนี้)

- Local D1 มี **5 โปรเจกต์**: MakantestDoc, ทดสอบโปรเจคเฮอ, Makan App Demo, Makantest, Makan Halal-Route
- เมนู "เอกสาร" **เคลียร์ mock data เก่าทั้งหมดแล้ว** (เดิมมี ~47 เอกสาร demo) เหลือแค่ **5 ไฟล์จริง** ที่อัปโหลดเข้าโปรเจกต์ **MakantestDoc**: `02_BRD_MAKAN_Redesign` (v1.2), `03_SOW_MAKAN_Redesign` (v1.2), `04_SRS_MAKAN_Redesign` (v1.2), `05_PEP_MAKAN_Redesign` (v1.2), `UIR_MAKAN_Redesign` (v1.0.1) — มาจาก `C:\Users\wanna\OneDrive\Desktop\Template เอกสาร BNT\TestDoctasknista\Redesign01` — **ไม่มีไฟล์ MOM** ในโฟลเดอร์ต้นทาง ถ้ามีเพิ่มทีหลังค่อยอัปโหลดเข้า
- Task ของโปรเจกต์อื่น (Makan App Demo/Makan Halal-Route/ทดสอบโปรเจคเฮอ) ที่เคยแตก task มาจาก mock doc เก่า (93 tasks) ยัง**อยู่ครบ** แต่ **chip "การอ้างอิงเอกสาร" ใน TaskDrawer จะไม่มีลิงก์เปิดเอกสารต้นทางแล้ว** (เอกสารต้นทางถูกลบ, ป้าย docType/refCode ยังโชว์ปกติเพราะเก็บแยกใน tasks table)
- Backup ของข้อมูลก่อนเคลียร์อยู่ที่ scratchpad ของ session นั้น (`docs-backup-2026-07-23/*.json`) — เป็น temp folder อาจถูกล้างไปแล้ว อย่าพึ่งพา
- มีโฟลเดอร์ระดับบนสุด 6 อัน (MOM/BRD/SRS/PEP/UIR/SOW) อยู่ว่างๆ ที่ root (parentId null, ไม่มีเอกสารข้างใน) — ไม่แน่ใจสาเหตุที่ยังไม่ถูกลบตอนเคลียร์ข้อมูล (ดูเหมือนเป็น artifact ของ wrangler dev vs wrangler CLI ไม่ sync กัน — ไม่กระทบการใช้งาน ลบทิ้งได้ถ้าไม่ต้องการ ผ่านปุ่ม "ลบโฟลเดอร์" ในหน้าเอกสาร)

## 6. ยังไม่ได้ทำ / ข้อจำกัดที่ทราบ

- ตาราง Word ที่มี merged cells → แปลงเป็นตารางปกติเวลาแก้ไข (§3.8)
- ไม่มี diff/เทียบเนื้อหาระหว่างเวอร์ชันเอกสาร (§3.9) — มีแค่ list เวอร์ชัน
- ไม่มี flow "อัปโหลดเวอร์ชันใหม่" แยกจากอัปโหลดเดิม — ใช้ระบุเลขที่เอกสารเดิม + เวอร์ชันใหม่ตอนอัปโหลดผ่าน breakout modal
- โฟลเดอร์ว่าง 6 อันที่ root (ดู §5) — cosmetic เท่านั้น
- `SPEC.md`/`tasks/*.md` ไม่ได้ sync กับฟีเจอร์ Tasknista เลย (เป็นของ SeedOffice ต้นทาง) — ถ้าจะ sync ต้องเขียนใหม่หรือเพิ่ม section ทั้งหมด ยังไม่ได้ทำ
- **ยังไม่เคย deploy ขึ้น Cloudflare** และ **ยังไม่ apply migration ขึ้น D1 remote** — ต้อง `wrangler login` ก่อนถึงจะรัน `pnpm db:migrate:remote` / `pnpm deploy` ได้ (ดู §2)
- API Document tab / Project Estimate tab ถอดออกจาก nav บนสุดแล้ว (§3-B.3) แต่ component+backend ยังอยู่ครบ — ถ้าจะเอากลับมาแค่เพิ่มกลับเข้า `tabs` array ใน `ProjectDetailPage`
- Defect ที่ convert จาก Backlog "..." menu ตอนนี้ **ไม่บังคับเลือก parent แล้ว** (ผูกแบบอ้างอิงผ่าน `task_references` แทน) — ถ้าเจอ Defect เก่าที่ยังมี `parentId` ตั้งแต่ก่อนแก้ ให้ถือเป็นข้อมูลเดิม ไม่ต้อง migrate ย้อนหลัง

## 7. วิธี resume งานต่อ (เครื่องใหม่)

1. `git clone https://github.com/thanawatbrandnista-arm/Tasknista.git` แล้ว `cd Tasknista`
2. `pnpm install`
3. คัดลอก `.dev.vars` จากเครื่องเดิมมาวางที่ root (ไม่ติดมากับ git — ดู §2) หรือ copy จาก `.dev.vars.example` แล้วกรอกค่าใหม่เอง (`DEV_AUTH=1` ต้องเปิดถึงจะมีปุ่ม dev-login)
4. `pnpm db:migrate` — สร้างตาราง D1 local ให้ตรง schema ล่าสุด (ฐานข้อมูลจะว่างเปล่า ไม่มีข้อมูลทดสอบเดิม เว้นแต่คัดลอกโฟลเดอร์ `.wrangler/` มาจากเครื่องเดิมด้วย — ดู §2)
5. อ่าน `CLAUDE.md` (กฎเหล็ก/stack/design token) + ไฟล์นี้ทั้งหมด (โดยเฉพาะ §3-B ถ้าจะแก้ Task/Epic/Story/Sprint) ก่อนแก้อะไร
6. `pnpm dev` แล้ว dev-login เข้าไปดูของจริงก่อนแก้อะไร
7. ทำทีละจุดเล็กๆ ตามสไตล์เดิม (`CLAUDE.md` §"วิธีทำงานกับเจ้าของ") — `pnpm typecheck` ก่อนรายงานทุกครั้ง เปิด browser preview verify การเปลี่ยนแปลงจริงก่อนบอกว่าเสร็จ
8. ถ้าแก้ schema → ลอง `pnpm db:generate` (drizzle-kit auto-gen จาก diff ของ `schema.ts`) ก่อน ถ้าชนบั๊ก wrangler native crash บน Windows ค่อย hand-write migration ตาม pattern เดิม (§3-B/§4)
9. ถ้าจะ deploy จริง: `wrangler login` ก่อน (ยังไม่เคย auth บนเครื่องไหนเลย ณ จุดที่เขียนไฟล์นี้) แล้ว `pnpm db:migrate:remote` (apply migration ค้าง 0050-0055 ขึ้น production D1) ก่อน `pnpm deploy` เสมอ ไม่งั้น API จะพังเพราะ column ไม่ตรงกับโค้ด
