# Tasknista (newtask-app) — Development Handoff

> เขียนไว้ให้ทำงานต่อได้ในเครื่อง/session อื่น โดยไม่ต้องไล่อ่าน conversation เดิม
> อัปเดตล่าสุด: 2026-07-23

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
- ไม่ใช่ git repo (ไม่มี `.git` ใน `C:\Users\wanna\newtask-app`) — ไม่มี commit history ให้ไล่ ใช้ไฟล์นี้แทน

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

## 5. ข้อมูล local dev ปัจจุบัน (2026-07-23)

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

## 7. วิธี resume งานต่อ

1. อ่าน `CLAUDE.md` (กฎเหล็ก/stack/design token) + ไฟล์นี้ (ฟีเจอร์ที่มี)
2. `pnpm dev` แล้ว dev-login เข้าไปดูของจริงก่อนแก้อะไร
3. ทำทีละจุดเล็กๆ ตามสไตล์เดิม (`CLAUDE.md` §"วิธีทำงานกับเจ้าของ") — `pnpm typecheck` ก่อนรายงานทุกครั้ง เปิด browser preview verify การเปลี่ยนแปลงจริงก่อนบอกว่าเสร็จ
4. ถ้าแก้ schema → hand-write migration ตาม pattern เดิม (§4) เพราะ `pnpm db:migrate` ผ่าน wrangler มีโอกาสชน native crash บน Windows
