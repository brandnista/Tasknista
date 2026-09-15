# HANDOFF — Pronista (จาก Claude Code ส่งต่อให้ Codex)

วันที่ส่งต่อ: 2026-09-16 · Branch ทำงาน: `staging-deploy` · Repo root: `C:\Users\wanna\newtask-app`

## 1. เป้าหมายสุดท้ายของงาน

Pronista เป็นระบบ PM ภายในของบริษัท (Cloudflare Workers/Hono API + React Router v7 + Drizzle/D1, pnpm monorepo)
งานล่าสุดในเซสชันนี้คือ**แก้บั๊กที่กระทบผู้ใช้งานจริงบน production** — งานที่คีย์ตรงใน Workspace (ไม่ผูกโปรเจกต์)
เมื่อจ่ายให้คนอื่นแล้วหายไปจากเมนู "งานที่จ่ายให้คนอื่น" ของผู้จ่ายงาน — **แก้เสร็จแล้ว ตรวจสอบผ่านหมดแล้ว
ขึ้น staging แล้ว รอแค่คำสั่ง deploy production จากเจ้าของงาน (อาร์ม)**

เกณฑ์ว่าเสร็จ: โค้ด fix ถูก merge เข้า `master` แล้ว deploy ขึ้น production (`pnpm exec wrangler deploy`, D1 database
`seedoffice`) — ปัจจุบันยังอยู่ที่ branch `staging-deploy`/staging เท่านั้น

## 2. สถานะปัจจุบัน

**เสร็จแล้ว** (ทดสอบผ่าน typecheck+lint+test+manual browser ครบ, deploy ขึ้น staging.pronista.com แล้ว):
- Rich text editor สำหรับฟิลด์ "รายละเอียดจากผู้จ่ายงาน" ในหน้า Task Detail (ใช้ Tiptap ที่มีอยู่แล้วในระบบ)
- เปิดให้เลือกสมาชิกโปรเจกต์ได้ทุกประเภทผู้ใช้งาน (Admin/พนักงาน/พาร์ทเนอร์/ลูกค้า) ตั้งแต่ตอนสร้างโปรเจกต์
- **บั๊กหลักที่ต้องส่งต่อ**: `GET /tasks/dispatched-by-me` ใช้ `innerJoin(projects)` ทำให้งาน workspace-native
  (`projectId IS NULL`) หายจากลิสต์ — แก้เป็น `leftJoin` แล้ว fallback ชื่อที่โชว์เป็นชื่อ Workspace room

**กำลังทำ/ยังค้าง**:
- **รอการตัดสินใจของอาร์ม**: deploy fix ล่าสุด (commit `009876d`) ขึ้น production หรือไม่ — บั๊กนี้กระทบงานจริงบน
  production อยู่ตอนนี้ (task id `86c7947e-8b07-4b16-86dd-65ee0275d60b` ใน DB `seedoffice`) แต่ตามกฎของโปรเจกต์
  (ดู CLAUDE.md) ห้าม deploy production โดยไม่ถามก่อนเสมอ — **ยังไม่ได้รับคำตอบ**
- `staging-deploy` ยังไม่ได้ merge เข้า `master` (มี 2 commit ใหม่ที่ยังอยู่แค่ staging-deploy: `26102d5`, `5e0e4b0`,
  `009876d` — ดูหัวข้อ 8)

**ขั้นตอนถัดไปที่แนะนำ**:
1. ถามอาร์มอีกครั้งว่าจะ deploy production ตอนนี้เลยไหม (บั๊กกระทบ production จริง)
2. ถ้าใช่ → merge `staging-deploy` เข้า `master` → รัน verify เต็ม (หัวข้อ 6) → merge `master` เข้า `production`
   branch → `pnpm exec wrangler deploy` (ไม่มี `--env` = production) → push ทั้ง 3 branch ขึ้น `origin` และ
   `bitbucket` remote

## 3. ไฟล์ที่แก้ไขแล้ว (commit ล่าสุด `009876d`, ก่อนหน้า `26102d5`)

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `apps/api/src/routes/tasks.ts` | `GET /tasks/dispatched-by-me`: เปลี่ยน `innerJoin(projects)`→`leftJoin` + เพิ่ม `leftJoin(workspaces)`, fallback `projectName` เป็นชื่อ workspace room เมื่อไม่มีโปรเจกต์ (บั๊กหลัก) · เพิ่ม `.max(10000)` cap ให้ฟิลด์ `description` 2 จุด (เดิมไม่มี cap / cap 2000 เดิมเล็กไปสำหรับ markdown) |
| `apps/api/src/routes/projects.ts` | `POST /:id/members`: เอาเงื่อนไขปฏิเสธ owner ออก (เดิม 400 `owner_has_full_access`) ให้เลือก Admin เป็นสมาชิกได้เหมือน vendor/guest (positionId เป็น null เสมอ ไม่กระทบสิทธิ์จริง เพราะ owner bypass การเช็คสิทธิ์จาก `project_members` อยู่แล้วทุกจุด) · `POST /` (สร้างโปรเจกต์): ทำ insert เป็น role-aware แทน blind-insert เดิม |
| `apps/web/src/pages/TaskDetail.tsx` | ฟิลด์ "รายละเอียดจากผู้จ่ายงาน" เปลี่ยนจาก `<textarea>` เป็น `<RichTextEditor>` (Tiptap, เก็บเป็น Markdown) ทั้งโหมดแก้ไขและอ่านอย่างเดียว |
| `apps/web/src/components/ProjectMembersPicker.tsx` | **ไฟล์ใหม่** — แยกออกมาจาก `ProjectEdit.tsx` เดิม (`MembersSection`) ให้ใช้ร่วมกันได้ทั้งตอนสร้าง/แก้ไขโปรเจกต์ รองรับเลือก Admin ได้แล้ว + prop `teamMode` ควบคุมว่าจะให้เลือกตำแหน่งละเอียด (`'select'`, ใช้ตอนแก้ไข) หรือ checkbox ง่ายๆ (`'checkbox'`, ใช้ตอนสร้าง) |
| `apps/web/src/pages/ProjectEdit.tsx` | ใช้ `ProjectMembersPicker` แทน `MembersSection` เดิมที่ลบออกแล้ว |
| `apps/web/src/pages/Projects.tsx` | `NewProjectModal`: เอาการกรอง `role==='member'` ออก ใช้ `ProjectMembersPicker` (`teamMode="checkbox"`) แทน checklist เดิม |
| `apps/web/src/pages/MyTasksDispatched.tsx` | รองรับ `projectName`/`projectId` เป็น `null` ได้ (งาน workspace-native) — render แบบ `.filter(Boolean).join(' · ')` กันช่องว่างเพี้ยน |
| `apps/api/test/tasks.test.ts` | เพิ่มเทสต์ regression ครอบ `dispatched-by-me` fix + `notifyOnUpdate` gate fix (commit ก่อนหน้า) |
| `apps/api/test/projects.test.ts` | เพิ่มเทสต์ครอบ `POST /:id/members` (owner) และ `POST /` (mixed roles) |

## 4. ไฟล์ที่ Codex ควรอ่านต่อ (ยังไม่ได้แก้ แต่เกี่ยวข้อง)

- `CLAUDE.md` (root) — กฎเหล็กของโปรเจกต์ทั้งหมด (ภาษาไทยเท่านั้น, ห้าม deploy production โดยไม่ถาม, ตรรกะเงิน/เวลาต้องเป็น pure function ใน `packages/core`, ฯลฯ) **ต้องอ่านก่อนแก้อะไรเพิ่ม**
- `apps/api/src/lib/project-role.ts` — `getProjectPermissions`/`getProjectRole` ที่ owner bypass ทุกจุด (สำคัญกับการเปลี่ยนแปลงข้อ 3 เรื่อง project members)
- `apps/web/src/components/RichTextEditor.tsx` — Tiptap wrapper กลาง ใช้ทั้ง Docs/My Note/Task description แล้ว เก็บเป็น Markdown เสมอ (ห้ามเปลี่ยนเป็น HTML ดิบ)
- `apps/api/src/routes/workspace-rooms.ts` — endpoint สร้างงาน workspace-native (`POST /workspaces/:id/backlog`) ที่เกี่ยวกับบั๊กที่เพิ่งแก้

## 5. จุดเริ่มต้นการทำงานต่อ

- `apps/api/src/routes/tasks.ts` — endpoint `.get('/tasks/dispatched-by-me', ...)` (บรรทัด ~485) — จุดที่เพิ่งแก้
- `apps/web/src/pages/MyTasksDispatched.tsx` — หน้า "งานที่จ่ายให้คนอื่น" ทั้งไฟล์ (55 บรรทัด สั้นมาก)
- ถ้าจะ deploy production: ดูขั้นตอนเป๊ะๆ ในหัวข้อ 6

## 6. วิธีตรวจสอบงาน

```bash
pnpm install                          # ติดตั้ง dependencies (ถ้ายังไม่ได้ทำ)
pnpm typecheck && pnpm lint && pnpm test   # ทั้ง monorepo (web+api+mcp)
pnpm --filter @seedoffice/web build   # build production bundle
```

**ผลล่าสุด (ที่ commit `009876d`)**: ทั้งหมดผ่านเขียวหมด — typecheck 5 package ผ่าน, lint ผ่าน,
test 18+57+1 = 76 test files / 532+13 = 545+ tests ผ่านหมด (ไม่มี error ค้าง), build สำเร็จ (bundle ~592KB gzip
— มี warning เรื่อง chunk size ใหญ่ แต่ไม่ใช่ error)

**Deploy staging** (ทำไปแล้ว):
```bash
pnpm exec wrangler deploy --env staging
```

**Deploy production** (ยังไม่ได้ทำ — ต้องได้รับคำสั่งจากอาร์มก่อนเสมอ ตาม CLAUDE.md):
```bash
git checkout master && git merge --no-ff staging-deploy   # เอา 3 commit ใหม่เข้า master
pnpm typecheck && pnpm lint && pnpm test                  # verify ซ้ำบน master
pnpm exec wrangler d1 migrations apply seedoffice --remote # เช็ค pending migration ก่อนเสมอ (ตอนนี้ไม่มีค้าง)
pnpm run deploy                                             # = pnpm build && wrangler deploy (ไม่มี --env = production)
git checkout production && git merge --no-ff master
git push origin production master && git push bitbucket production master
```
หมายเหตุ: `pnpm deploy` เฉยๆ จะชนกับ pnpm built-in command ต้องใช้ `pnpm run deploy` เท่านั้น

## 7. การตัดสินใจและข้อจำกัด

- **ห้าม deploy production โดยไม่ถามอาร์ม (เจ้าของงาน) ก่อนทุกครั้ง** — กฎนี้เขียนไว้ใน CLAUDE.md ชัดเจน
- **Owner ที่ถูกเพิ่มเข้า `project_members`** เป็นแค่ข้อมูลแสดงผล (ให้ขึ้นในรายชื่อ/ไอคอนสมาชิก) **ไม่กระทบสิทธิ์จริงเลย**
  เพราะ `getProjectPermissions`/`getProjectRole` เช็ค `role==='owner'` bypass ก่อนอ่าน `project_members` เสมอ —
  ห้ามเข้าใจผิดว่าต้องเพิ่ม permission logic ใหม่ให้ owner ตรงนี้
- **Rich text เก็บเป็น Markdown เสมอ ไม่ใช่ HTML** — ตาม convention เดิมของ `RichTextEditor.tsx` (ใช้กับ
  Docs/My Note อยู่แล้ว) ห้ามเปลี่ยนไปเก็บ HTML ดิบเพราะจะเสี่ยง XSS และไม่ตรงกับของเดิมในระบบ
  - Tiptap render ผ่าน ProseMirror schema ไม่ใช่ `dangerouslySetInnerHTML` จาก string ดิบ จึงไม่ต้องเพิ่ม
    sanitize library ใหม่ (DOMPurify ฯลฯ) — ตรวจสอบแล้วว่าปลอดภัยโดยธรรมชาติของ pattern นี้
- **แนวทางที่ลองแล้วแต่ไม่ใช้**: ตอนแรกพิจารณาให้ `ProjectMembersPicker` ใช้ UI เดียวกันทั้งตอนสร้าง/แก้ไข
  (position `<select>` ทุกที่) แต่จะทำให้ตอนสร้างโปรเจกต์ซับซ้อนเกินจำเป็น (ของเดิมไม่เคยเลือกตำแหน่งละเอียด
  ตอนสร้าง) จึงเพิ่ม prop `teamMode` แทนเพื่อคงพฤติกรรมเดิมของหน้าสร้างไว้
- **Business Rules Workflow (state machine)**: หลังงานถูก "จ่ายงาน" อย่างเป็นทางการแล้ว (`dispatchedAt` ไม่ว่าง)
  ผู้รับงานจะเปลี่ยนสถานะเองอิสระไม่ได้อีกต่อไป ต้องผ่านปุ่ม "รับงาน"/"ส่งงาน" เท่านั้น (`apps/api/src/routes/tasks.ts`
  `assigneeAllowedNext` ~บรรทัด 562) — **นี่คือพฤติกรรมที่ตั้งใจ ไม่ใช่บั๊ก** ถ้ามีคนแจ้งว่า "ปรับสถานะไม่ได้"
  ให้เช็คก่อนว่าเป็นเคสนี้หรือเป็นบั๊กจริงอื่น

## 8. สถานะ Git

```
Branch ปัจจุบัน: staging-deploy
Tracking: origin/master (ahead 2, behind 1 — ไม่ได้ตั้งใจ track master ตรงๆ เป็นความเพี้ยนของ upstream config เดิม ไม่ต้องแก้)
Working tree: สะอาด (ไม่มีการแก้ไขค้าง ยกเว้นโฟลเดอร์ .scratch/ ที่ untracked ไม่เกี่ยวข้อง)

git log -5 --oneline:
009876d fix(tasks): งานคีย์ตรงใน Workspace หายไปจากเมนู "งานที่จ่ายให้คนอื่น"
26102d5 feat(task,project): rich text ฟิลด์รายละเอียดจากผู้จ่ายงาน + เปิดเลือกสมาชิกโปรเจกต์ได้ทุกประเภทผู้ใช้งาน
5e0e4b0 fix(tasks): ไม่แจ้งเตือน "งานถูกแก้ไข" ก่อนจ่ายงานจริง + แก้ปุ่มให้ตรงบริบท
1bde865 chore(web): ลบหน้า /clients, /inbox, /expenses ที่ไม่มีลิงก์เมนูให้กดแล้ว
4fca517 fix(settings): เพิ่ม Alert/Confirm ก่อน action ที่มีผลกระทบสูง + ดัก error ให้ครบ
```

Branch อื่นที่เกี่ยวข้อง: `master` (ยังไม่มี 3 commit ล่าสุด), `production` (deploy ล่าสุดไปวันนี้ก่อนหน้านี้แล้ว
ถึง commit ที่ต่ำกว่า `master` — ยังไม่มี fix ชุดนี้เลย), `staging` (ไม่ได้ใช้งานจริง เป็น branch เก่า)

Remote: `origin` (github.com/brandnista/Tasknista), `bitbucket` (bitbucket.org/devnista/pronista) — ทั้งคู่ sync
กันปกติ, push ล่าสุดคือตอน deploy production รอบก่อนหน้า (ยังไม่ได้ push commit ของฟีเจอร์/บั๊กรอบนี้)
