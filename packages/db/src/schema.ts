import { sqliteTable, text, integer, index, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

/**
 * Conventions (SPEC §5/§9)
 * - เงิน = integer สตางค์ · เวลา = integer นาที — ห้าม REAL
 * - instant (สร้างเมื่อ/หมดอายุ) = integer epoch **ms** (UTC)
 * - calendar date ในบริบทไทย (effectiveFrom, workDate, dueDate) = text 'YYYY-MM-DD' (Asia/Bangkok)
 * - id = text (crypto.randomUUID) · ชื่อคอลัมน์ snake_case / ฝั่ง TS camelCase
 */

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

// Pronista §ตั้งค่า — ทีม/แผนก (จัดกลุ่มผู้ใช้ในหน้าจัดการผู้ใช้ ไม่เกี่ยวกับสิทธิ์)
export const teams = sqliteTable('teams', {
  id: id(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const users = sqliteTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(), // ชื่อที่แสดงทั้งแอป — derive จาก nickname || "firstName lastName" ตอนแก้โปรไฟล์
  firstName: text('first_name'), // ชื่อจริง (แก้เองหน้าโปรไฟล์)
  lastName: text('last_name'), // นามสกุล
  nickname: text('nickname'), // ชื่อเล่น (ถ้ามี = ใช้เป็น display name)
  googleSub: text('google_sub').unique(),
  // Pronista §User Role — guest มีสิทธิ์เข้าถึงเหมือน vendor ทุกอย่าง (external, view-only, ไม่เห็นการเงิน) แค่แยก label ไว้จัดกลุ่มคนละประเภท
  role: text('role', { enum: ['owner', 'member', 'vendor', 'guest'] }).notNull(),
  status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
  avatarUrl: text('avatar_url'),
  teamId: text('team_id').references(() => teams.id),
  // Pronista §Project Estimate — ตำแหน่ง/role แสดงในตารางประเมินต้นทุน (คนละอย่างกับ users.role ที่เป็น permission)
  jobTitle: text('job_title'),
  // Pronista §Project Estimate — ต้นทุน/วันสำหรับใบเสนอราคา (satang) แยกจาก `rates` เดิมที่ปิด UI ไปแล้ว (ไม่มีประวัติ owner แก้ค่าปัจจุบันได้ตรงๆ)
  costPerDaySatang: integer('cost_per_day_satang'),
  // Pronista §User Settings — ฟิลด์เฉพาะ role='guest' (ลูกค้า) ตามฟอร์ม CRM อ้างอิง (นิติบุคคล/บุคคลธรรมดา + ชื่อธุรกิจ + เบอร์มือถือ)
  // "ชื่อผู้ติดต่อ"/"อีเมล" ใช้ name/email เดิมร่วมกับ role อื่นเลย ไม่แยกคอลัมน์ซ้ำ
  contactType: text('contact_type', { enum: ['juristic', 'individual'] }),
  businessName: text('business_name'),
  phone: text('phone'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

// Pronista §Workspace Rooms — "ห้อง" ทำงานของทีม (ชื่อ + สมาชิก) คนละเรื่องกับ projects — เข้าไปแล้วเจอหน้า Workspace (Backlog/Sprint) เดิม
// ยังไม่ผูกกับ projects ใดๆ (การกรองโปรเจกต์/สมาชิกในนั้นทำผ่านฟิลเตอร์ของหน้า Workspace เดิม ไม่เกี่ยวกับห้องนี้)
export const workspaces = sqliteTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  // Pronista §System Requirements Update — ประเภทห้อง: 'business' = Backlog เดี่ยว (List/Kanban + Import task) ไม่มี Sprint · 'developer' = Backlog+Sprint เต็มรูปแบบ (มีปุ่ม +Sprint)
  type: text('type', { enum: ['business', 'developer'] }).notNull().default('developer'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    addedAt: integer('added_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex('workspace_members_unique').on(t.workspaceId, t.userId)],
)

/** Pronista §Workspace Rooms (ต่อยอด) — โปรเจกต์ที่ถูก "ดึงเข้าห้อง" นี้แล้ว (ห้องใหม่ = ว่างเปล่า จนกว่าจะเพิ่ม)
 * คุมว่า Backlog Grid/Sprint ของห้องนี้อ่านโปรเจกต์ไหนบ้าง (แคบกว่า accessibleProjects เดิมที่เห็นทุกโปรเจกต์) */
export const workspaceProjects = sqliteTable(
  'workspace_projects',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    addedAt: integer('added_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex('workspace_projects_unique').on(t.workspaceId, t.projectId)],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: id(), // = session token (random 256-bit hex — ไม่ใช่ uuid เดาง่าย, สร้างใน api)
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

/** scope ที่ PAT ใช้ได้ (SPEC §4.18) — งาน+เวลาเท่านั้น, ไม่มี scope การเงิน */
export const API_TOKEN_SCOPES = ['tasks:read', 'tasks:write', 'time:read', 'time:write', 'projects:read'] as const

/**
 * Personal Access Token (SPEC §4.18) — ให้ Claude/automation เรียก API
 * id = SHA-256 hash ของ token (เหมือน `sessions` — token หลุดจาก DB ใช้ไม่ได้) · token เต็ม prefix `sko_` โชว์ครั้งเดียวตอนสร้าง (สร้าง+hash ใน api/lib/api-token)
 * scope = งาน+เวลาเท่านั้น · เพิกถอน = ใส่ revokedAt (soft) — route การเงินรับ cookie เท่านั้น PAT แตะไม่ได้
 */
export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: id(), // = SHA-256 hash ของ token (override default uuid ตอน insert)
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('api_tokens_user_idx').on(t.userId)],
)

/** rate แบบ effective-dated — เปลี่ยน rate = insert แถวใหม่ ไม่แก้ของเก่า (SPEC §4.2) */
export const rates = sqliteTable(
  'rates',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    rateSatangPerHour: integer('rate_satang_per_hour').notNull(),
    effectiveFrom: text('effective_from').notNull(), // YYYY-MM-DD (Asia/Bangkok)
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('rates_user_idx').on(t.userId, t.effectiveFrom)],
)

/** config ระดับบริษัท — แถวเดียว (id=1) · SPEC §5: ไม่ hardcode */
export const companyConfig = sqliteTable('company_config', {
  id: integer('id').primaryKey().default(1),
  cutoffDay: integer('cutoff_day').notNull().default(25), // งวด 25→24 จ่าย 26
  workHourCapMinutes: integer('work_hour_cap_minutes').notNull().default(480), // 8 ชม./วัน
  // โดเมน auto-provision member (SPEC §4.1) — '' = ปิด · default ตอน migrate กัน production เดิมพัง
  memberDomain: text('member_domain').notNull().default('@seedwebs.com'),
  // token ลับสำหรับ ICS feed สาธารณะ (SPEC §4.14 · E6) — null = ปิดลิงก์ · owner สร้าง/รีเซ็ต
  // ห้ามส่งออกทาง GET /api/config (อ่านได้ทุก role) — เห็นเฉพาะ owner ผ่าน /api/admin/ics-link
  icsToken: text('ics_token'),
  // สถานะโปรเจกต์ปรับเองได้ (SPEC §4.3) — null = ใช้ DEFAULT (resolve ใน core)
  // ชุดสำหรับ category='project'
  projectStatuses: text('project_statuses', { mode: 'json' }).$type<
    { id: string; name: string; color: string; kind: 'active' | 'archived'; sortOrder: number }[]
  >(),
  // ชุดสำหรับ category='product' (Pronista — แยกชุดสถานะตามประเภทงาน)
  productStatuses: text('product_statuses', { mode: 'json' }).$type<
    { id: string; name: string; color: string; kind: 'active' | 'archived'; sortOrder: number }[]
  >(),
  // Pronista §Sprint & Board — preset คอลัมน์ของ Sprint Board ปรับเองได้ (null = ใช้ DEFAULT 2 ชุด — resolve ใน core/board-preset)
  boardPresets: text('board_presets', { mode: 'json' }).$type<
    { id: string; name: string; columns: { id: string; name: string; color: string; sortOrder: number }[] }[]
  >(),
  // Pronista §Project Estimate — % buffer/margin default ใช้คำนวณต้นทุน (owner แก้ได้ที่ตั้งค่า ไม่ hardcode)
  costBufferPercent: integer('cost_buffer_percent').notNull().default(20),
  costMarginPercent: integer('cost_margin_percent').notNull().default(30),
  // Pronista §Position-based permission — แคตตาล็อกตำแหน่งต่อโปรเจกต์ (BA/PM/ฯลฯ) ชุดเดียวทั้งบริษัท (null = ใช้ DEFAULT — resolve ใน core/permissions)
  // project_members.positionId อ้าง id ที่นี่ (ไม่มี DB-level FK — เหมือน sprints.boardPresetId อ้าง boardPresets)
  positions: text('positions', { mode: 'json' }).$type<
    {
      id: string
      name: string
      sortOrder: number
      permissions: {
        tabs: Record<string, boolean>
        actions: Record<string, { create: boolean; edit: boolean; delete: boolean }>
      }
    }[]
  >(),
  // Pronista §Subscription Notify — แคตตาล็อกประเภทโปรเจกต์ (Website Dev/Mobile App/ฯลฯ) แก้ไขได้ที่ตั้งค่า (null = ใช้ DEFAULT — resolve ใน core/subscription)
  // projects.serviceType อ้าง id ที่นี่ (ไม่มี DB-level FK — เหมือน positions)
  serviceTypes: text('service_types', { mode: 'json' }).$type<{ id: string; name: string; sortOrder: number }[]>(),
  // Pronista §Subscription Notify (Product Type) — แคตตาล็อกชื่อผลิตภัณฑ์ (Sellnista/Paynista/ฯลฯ) ใช้เมื่อ category='product' (null = ใช้ DEFAULT — resolve ใน core/subscription)
  // projects.productType อ้าง id ที่นี่ (ไม่มี DB-level FK — เหมือน serviceTypes)
  productTypes: text('product_types', { mode: 'json' }).$type<{ id: string; name: string; sortOrder: number }[]>(),
  // Pronista §Workspace — แคตตาล็อกแท็กสีของ Task (bug/urgent/blocked/ฯลฯ) ชุดเดียวทั้งบริษัท (null = ใช้ DEFAULT — resolve ใน core/labels)
  // tasks.labelIds อ้าง id ที่นี่ (array, ไม่มี DB-level FK — เหมือน positions/serviceTypes) · สีใช้ค่าเดียวกับ BOARD_COLOR_KEYS
  labels: text('labels', { mode: 'json' }).$type<{ id: string; name: string; color: string; sortOrder: number }[]>(),
})

/** ลูกค้า (CRM §4.17 — entity จริงตั้งแต่ T08 เลี่ยง refactor) */
export const clients = sqliteTable('clients', {
  id: id(),
  name: text('name').notNull(),
  logo: text('logo'), // emoji
  contactName: text('contact_name'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  note: text('note'),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

/** slug เริ่มต้น (default config) — status ปรับเองได้แล้ว ไม่ใช่ enum ตายตัวใน DB (ดู core/project-status) */
export const PROJECT_STATUSES = ['design', 'dev', 'staging', 'golive', 'ma', 'archived'] as const

/** โปรเจกต์ 2 ประเภท (SPEC §4.3): project = fixed-price มีกำหนดส่ง · recurring = ดูแลรายเดือน/ปี */
export const projects = sqliteTable(
  'projects',
  {
    id: id(),
    code: text('code'),
    name: text('name').notNull(),
    description: text('description'), // Pronista — คำโปรยสั้นๆ ใต้ชื่อโปรเจกต์ (การ์ดหัวโปรเจกต์)
    url: text('url'), // Pronista §2.11 — ลิงก์เว็บไซต์จริงของโปรเจกต์/โปรดักต์ (ถ้ามี)
    logo: text('logo'), // emoji
    clientId: text('client_id').references(() => clients.id),
    // Pronista §Back to Basic (ต่อยอด) — Project Lead / หัวหน้าโครงการ เลือกได้ 1 คนตอนสร้างโปรเจกต์ (ไม่บังคับ)
    leadId: text('lead_id').references(() => users.id),
    type: text('type', { enum: ['project', 'recurring'] }).notNull(),
    // ประเภทงาน (Pronista §F1): กำหนดว่าใช้ชุดสถานะไหน (product → productStatuses · project → projectStatuses)
    category: text('category', { enum: ['product', 'project'] }).notNull().default('project'),
    status: text('status').notNull().default('dev'), // อ้าง id ในชุดสถานะตาม category (configurable)
    quotedSatang: integer('quoted_satang'), // ราคาขาย (fixed) — vendor ห้ามเห็น (ตัดที่ serializer)
    billingType: text('billing_type', { enum: ['fixed', 'recurring'] }).notNull().default('fixed'),
    recurringPeriod: text('recurring_period', { enum: ['monthly', 'yearly'] }),
    startDate: text('start_date'), // YYYY-MM-DD
    dueDate: text('due_date'),
    // Pronista §F1/§2.11 — sprint (free text รอบแรก) · priority · tags (ชุดบริการ/สถานะย่อย — ใช้ได้ทั้ง product และ project)
    sprint: text('sprint'),
    priority: text('priority', { enum: ['low', 'normal', 'high'] }).notNull().default('normal'),
    tags: text('tags', { mode: 'json' }).$type<string[]>(),
    // Pronista §Project Estimate — จำนวนวันทำงานรวมของโปรเจกต์ที่ owner เลือกยืนยัน (ใช้หาร quotedSatang เป็น Estimate Project Cost/Day)
    estimateNetWorkingDays: integer('estimate_net_working_days'),
    // Pronista §Project Refactor — เนื้อหา richtext อิสระต่อโปรเจกต์ สำหรับแท็บ "API Document" (developer API docs/technical specs)
    apiDocNotes: text('api_doc_notes'),
    // Pronista §Subscription Notify — ประเภทโปรเจกต์ (อ้าง id ใน company_config.serviceTypes) + ช่วงเวลาให้บริการ (null = lifetime ไม่มีวันหมดอายุ)
    serviceType: text('service_type'),
    // Pronista §Subscription Notify (Product Type) — ใช้เมื่อ category='product' เท่านั้น (อ้าง id ใน company_config.productTypes) — คนละแกนกับ serviceType (ใช้ตอน category='project')
    productType: text('product_type'),
    serviceStartDate: text('service_start_date'), // YYYY-MM-DD
    serviceEndDate: text('service_end_date'), // YYYY-MM-DD — null = lifetime
    notifyBeforeDays: integer('notify_before_days'), // แจ้งเตือนล่วงหน้ากี่วันก่อนหมดอายุ
    // กันแจ้งเตือนซ้ำทุกวันหลังเข้าเกณฑ์ — reset เป็น null ทุกครั้งที่ serviceEndDate เปลี่ยน (ต่ออายุ)
    expiryNotifiedAt: integer('expiry_notified_at', { mode: 'timestamp_ms' }),
    // Pronista §Project Refactor — soft-delete เท่านั้น (กฎเหล็ก) — ลบได้เฉพาะ owner (Admin)
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('projects_type_idx').on(t.type, t.status), index('projects_client_idx').on(t.clientId)],
)

export const PROJECT_MEMBER_ROLES = ['viewer', 'editor'] as const

/** สมาชิกในโปรเจกต์ (Pronista §F1) — assign ได้หลายคนต่อโปรเจกต์
 * Pronista §permission — สิทธิ์ระดับโปรเจกต์ของ 'member' เท่านั้น (owner เห็น/แก้ได้ทุกอย่างเสมอ · vendor คือ 'viewer' เสมอ ไม่ผ่าน column นี้)
 * editor = แก้ไข task ทั้งหมด + ข้อมูลโปรเจกต์ได้ · viewer = อ่านอย่างเดียว (รวมถึงงานที่ตัวเอง assign) · default 'viewer' (ปลอดภัยกว่าสำหรับสมาชิกใหม่)
 * Pronista §Position-based permission — `role` เดิม deprecated แล้ว (คงไว้เผื่อ rollback ไม่อ่าน/ไม่เขียนอีกต่อไป) แทนที่ด้วย `positionId`
 * (อ้าง id ใน company_config.positions ไม่มี DB-level FK — เหมือน sprints.boardPresetId) null = ยังไม่ตั้ง (fallback = ดูอย่างเดียว) */
export const projectMembers = sqliteTable(
  'project_members',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: PROJECT_MEMBER_ROLES }).notNull().default('viewer'),
    positionId: text('position_id'),
  },
  (t) => [uniqueIndex('project_members_uq_idx').on(t.projectId, t.userId)],
)

/** กลุ่มงานในโปรเจกต์ (SPEC §4.4) — เรียงด้วย sortOrder */
export const taskGroups = sqliteTable(
  'task_groups',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('task_groups_project_idx').on(t.projectId, t.sortOrder)],
)

/** Epic (Pronista §Epic Layer) — ครอบกลุ่ม Task หลายตัวที่แตกมาจากเอกสาร SOW เดียวกัน/เฟสเดียวกัน
 * สร้างอัตโนมัติตอน confirm แตกเอกสาร SOW (1 เอกสาร = 1 Epic) — ผู้ใช้แก้ชื่อได้ทีหลัง ไม่มีปุ่มสร้างเองในเวอร์ชันแรก */
export const epics = sqliteTable(
  'epics',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    title: text('title').notNull(),
    code: text('code'), // รหัสเอกสารต้นทาง เช่น "BNT-SOW-14072026-001" — null ถ้าไม่ได้มาจากเอกสาร
    sourceDocId: text('source_doc_id').references((): AnySQLiteColumn => docs.id),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('epics_project_idx').on(t.projectId, t.sortOrder), index('epics_source_doc_idx').on(t.sourceDocId)],
)

// Pronista §Sprint & Board — planned (สร้างแล้ว ยังไม่ Start) → active (กด Start Sprint แล้ว) → completed (ครบกำหนด/ปิดเอง)
// ทีละ 1 sprint ที่ไม่ completed ต่อโปรเจกต์เท่านั้น (เช็คที่ API — ต้องปิดตัวเก่าก่อนสร้างใหม่)
export const SPRINT_STATUSES = ['planned', 'active', 'completed'] as const

/** Sprint ต่อโปรเจกต์ (Pronista §Sprint & Board) — boardPresetId อ้าง id ใน company_config.boardPresets
 * Pronista §Workspace Sprint (ต่อยอด) — Sprint เป็นได้ 2 แบบ: ผูกโปรเจกต์เดียว (projectId ตั้ง, workspaceId ว่าง — งานในนั้นทุกตัวเป็นของโปรเจกต์นั้น)
 * หรือผูกห้อง Workspace (workspaceId ตั้ง, projectId ว่าง — task ที่ลากเข้ามาแต่ละตัวยังพกโปรเจกต์ของตัวเองแยกกันได้) — เช็คว่าตั้งอย่างใดอย่างหนึ่งเท่านั้นที่ชั้น route */
export const sprints = sqliteTable(
  'sprints',
  {
    id: id(),
    projectId: text('project_id').references(() => projects.id),
    workspaceId: text('workspace_id').references(() => workspaces.id),
    name: text('name'), // ว่าง = auto-label "Sprint N" ฝั่ง web ตามลำดับ
    startDate: text('start_date').notNull(), // YYYY-MM-DD — Pronista §Project Refactor: ตอนสร้างด่วน (กด "+ Sprint") ฝั่ง backend เติมค่าเริ่มต้นให้ (วันนี้..+7) ยังไม่ให้ user กรอก จนกว่าจะกด "เริ่ม Sprint" ค่อยเปลี่ยนเป็นค่าจริง
    endDate: text('end_date').notNull(),
    goal: text('goal'), // เป้าหมาย Sprint — กรอกตอน "เริ่ม Sprint" เช่นเดียวกับวันที่
    boardPresetId: text('board_preset_id'), // ว่างระหว่าง planned — เลือกตอนกด "เริ่ม Sprint" เท่านั้น
    status: text('status', { enum: SPRINT_STATUSES }).notNull().default('planned'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    // snapshot ตอนปิด sprint (SPEC Sprint & Board §report) — task ที่ไม่ done จะถูกเด้งกลับ backlog (sprint_id เคลียร์)
    // ต้อง snapshot ไว้ก่อนเคลียร์ ไม่งั้นดูรายงานของ sprint ที่ปิดแล้วไม่ได้ (นับใหม่จาก tasks ไม่ได้อีกต่อไป)
    doneCount: integer('done_count'),
    notDoneCount: integer('not_done_count'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('sprints_project_idx').on(t.projectId, t.status)],
)

/** สำเนา task แบบ point-in-time ตอนปิด sprint (Pronista §Sprint & Board — ดู Detail Board ย้อนหลัง)
 *  แยกจาก tasks เพราะ task ตัวจริงถูกเด้งกลับ backlog (sprintId/sprintStatus เคลียร์ทิ้ง) หลังปิด sprint — ถ้าไม่ snapshot ไว้ตรงนี้ก่อน ข้อมูลตำแหน่งบนบอร์ดตอนปิดจะหายไปถาวร */
export const sprintTaskSnapshots = sqliteTable(
  'sprint_task_snapshots',
  {
    id: id(),
    sprintId: text('sprint_id')
      .notNull()
      .references(() => sprints.id),
    taskId: text('task_id').notNull(),
    taskCode: text('task_code'),
    taskTitle: text('task_title').notNull(),
    statusIdAtClose: text('status_id_at_close'),
    priority: text('priority'),
    srsRefCode: text('srs_ref_code'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('sprint_task_snapshots_sprint_idx').on(t.sprintId)],
)

// Pronista §Document Traceability — ประเภทเอกสารสำหรับฟิลเตอร์หน้าเอกสาร + origin ของ task ที่แตกออกมา (แยกจาก kind/templateType)
// MOM/BRD/SOW/SRS auto-set ตอนสร้างจาก Template, CR/อื่นๆ ให้ผู้ใช้เลือกเองตอนอัปโหลดไฟล์ — ประกาศไว้ก่อน tasks/docs เพราะทั้งคู่อ้างถึง
// PEP = Project Execution Proposal (เดิมใช้รหัส PROP — เอกสารชุด v1.1.1 เปลี่ยนชื่อทางการเป็น PEP แล้ว) · UIR = User Interface Review (เล่มที่ 6, เดิมใช้รหัส SRC)
// Pronista §Project Refactor — เพิ่ม 'API' สำหรับแท็บ "API Document" (อัปโหลดไฟล์ developer API docs/technical specs แทน richtext เดิม)
export const DOC_TYPES = ['MOM', 'BRD', 'SOW', 'SRS', 'PEP', 'UIR', 'CR', 'API'] as const

// Pronista §2.12 — สถานะ task ตายตัว 4 ค่า (Kanban ทุกโปรเจกต์ ไม่ว่า Product/Project) แทนที่ todo/doing/done เดิม
export const TASK_STATUSES = ['non_start', 'on_processing', 'waiting_for_test', 'done'] as const
// Pronista §5 (2026-07-03) — Defect มีชุดสถานะของตัวเอง แยกจาก TASK_STATUSES (ใช้เฉพาะเมื่อ kind==='defect')
export const DEFECT_STATUSES = ['reported', 'fixing', 'waiting_verify', 'closed'] as const

export const tasks = sqliteTable(
  'tasks',
  {
    id: id(),
    // Pronista §F2 — Backlog: task ลอยได้ (ยังไม่ผูกโปรเจค/กลุ่ม) → projectId/groupId = null
    projectId: text('project_id').references(() => projects.id),
    groupId: text('group_id').references(() => taskGroups.id),
    // Pronista §Epic Layer — Epic ที่ Task นี้สังกัด (null = ยังไม่ได้สังกัด Epic ใด เช่น task สร้างมือ)
    epicId: text('epic_id').references(() => epics.id),
    // Pronista §2.5 — Jira-style auto code: BL-N ใน backlog → <projectCode>-N เมื่อผูกโปรเจกต์ · sub-task → <parentCode>.N
    code: text('code'),
    // Pronista §2.6 — ย้าย backlog เป็น Sub-task ของ task ที่มีอยู่แล้ว (self-ref)
    parentId: text('parent_id').references((): AnySQLiteColumn => tasks.id),
    // Pronista §Back to Basic (ต่อยอด) — คีย์ Task ลอยๆ ได้โดยไม่ต้องมี Story แม่ก่อน (parentId ยังว่างได้)
    // ต้องมี flag แยกเพราะ kind='task'+parentId=null ปกติแปลว่า Story (โครงสร้างเดิม) — flag นี้บอกว่า "ตั้งใจให้เป็น Task ลอย" ไปโผล่แท็บ Task ไม่ใช่แท็บ Story
    isStandaloneTask: integer('is_standalone_task', { mode: 'boolean' }).notNull().default(false),
    // Pronista §2.6 — ย้าย backlog เป็น Defect: kind แยกประเภทงาน · reporterType = ผู้แจ้ง
    // Pronista §Project Refactor — เพิ่ม 'cr' (Change Request ระดับ task แยกจาก doc type 'CR') สำหรับแท็บ CR ในหน้าโปรเจกต์
    // Pronista §Back to Basic (ต่อยอด) — เพิ่ม 'backlog' แยกงานที่คีย์จากแท็บ "ทั่วไป" ออกจาก Story (kind='task' ระดับบนสุดเหมือนกันแต่คนละความหมาย) ให้เด็ดขาด
    kind: text('kind', { enum: ['task', 'defect', 'cr', 'backlog'] }).notNull().default('task'),
    reporterType: text('reporter_type', { enum: ['customer', 'self'] }),
    // Pronista §5 — สถานะเฉพาะ Defect (รอเริ่ม/กำลังแก้/รอ Verify/ปิด) — null สำหรับ kind==='task'
    defectStatus: text('defect_status', { enum: DEFECT_STATUSES }),
    // Pronista §4 (2026-07-03) — ล็อค task ใน Company Backlog (owner เท่านั้นที่ล็อค/ปลดล็อคได้ · ล็อคแล้ว member แก้ไข/ย้าย/ลบไม่ได้เลย)
    locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
    // Pronista §SRS import — โยง task กับข้อ SRS ที่แตกออกมา (แยกจาก docLinks ทั่วไป เพราะต้องรู้ "ข้อไหน" ไม่ใช่แค่ "เอกสารไหน")
    srsRefCode: text('srs_ref_code'), // รหัสที่ระบบสร้างให้ "<projectCode>-SRS-v<version>-<NNN>" — คงที่ตลอดชีพ task
    srsSourceCode: text('srs_source_code'), // รหัสเดิมในเอกสาร เช่น "MKD-01" — null ถ้าเพิ่มด้วยมือไม่มีรหัสต้นฉบับ
    srsDocId: text('srs_doc_id').references((): AnySQLiteColumn => docs.id), // เอกสาร SRS ต้นทาง
    // Pronista §Document Traceability — เวอร์ชัน generic ของ 3 ฟิลด์ srs* ด้านบน ใช้กับ MOM/BRD/SOW/SRS ทุกประเภท (ทางฝั่ง SRS เดิมยังคงเขียน srs* คู่ขนานไปไม่เปลี่ยนพฤติกรรมเดิม)
    originDocType: text('origin_doc_type', { enum: DOC_TYPES }), // เล่มต้นทางของ task นี้ — null = ไม่ได้มาจากการแตกเอกสาร
    originCode: text('origin_code'), // รหัสเดิมในเอกสาร เช่น "BR-F03", "MAK001-SOW-001"
    originRefCode: text('origin_ref_code'), // รหัสที่ระบบสร้างให้ "<projectCode>-<DOCTYPE>-v<version>-<NNN>"
    originDocId: text('origin_doc_id').references((): AnySQLiteColumn => docs.id), // เอกสารต้นทาง
    // Pronista §Sprint & Board — แกนสถานะคู่ขนานกับ status: อยู่ใน sprint ไหน + คอลัมน์ไหนในบอร์ด (อ้าง id preset ของ sprint นั้น)
    // null ทั้งคู่ = อยู่ใน Backlog ของโปรเจกต์ (ใช้ pool เดียวกับ backlog เดิม — SPEC Sprint & Board: "ใช้ pool เดียวกัน เปลี่ยนชื่อ UI")
    sprintId: text('sprint_id').references(() => sprints.id),
    sprintStatus: text('sprint_status'),
    sortOrder: integer('sort_order').notNull().default(0),
    title: text('title').notNull(),
    // Pronista §Back to Basic (ต่อยอด) — "รายละเอียดของผู้จ่ายงาน" แก้ได้เฉพาะผู้จ่ายงาน (canEdit && !isAssignee)
    description: text('description'),
    // Pronista §Back to Basic (ต่อยอด) — "รายละเอียดของผู้รับงาน" คนละฟิลด์กับ description เด็ดขาด แก้ได้เฉพาะ assignee เอง และแก้ไม่ได้แล้วหลังส่งงาน (status=waiting_for_test/done) — ผู้จ่ายงานอ่านได้อย่างเดียว แก้ไม่ได้เลย
    assigneeNotes: text('assignee_notes'),
    assigneeId: text('assignee_id').references(() => users.id),
    // Pronista §My Work/Notification — คนที่กด assign ล่าสุด (ผู้มอบหมาย) ใช้แจ้งเตือนกลับตอน subtask เสร็จ
    assignedBy: text('assigned_by').references(() => users.id),
    // Pronista §Back to Basic (ต่อยอด) — เกตจ่ายงาน: null = ยังไม่จ่าย (ไม่โผล่ในหน้า "งานของฉัน" ของ assignee) — เคลียร์กลับเป็น null ทุกครั้งที่เปลี่ยน assigneeId
    dispatchedAt: integer('dispatched_at', { mode: 'timestamp_ms' }),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('non_start'),
    priority: text('priority', { enum: ['low', 'normal', 'high'] }).notNull().default('normal'),
    // Pronista §Workspace — แท็กสี (อ้าง id ใน company_config.labels, ไม่มี DB-level FK) เลือกได้หลายอัน
    labelIds: text('label_ids', { mode: 'json' }).$type<string[]>(),
    estimateMinutes: integer('estimate_minutes'),
    // Pronista §Project Estimate — กี่นาที/วันที่ assignee แบ่งเวลามาทำ task นี้ (null = ใช้ company_config.workHourCapMinutes) → หา Estimate Day
    costWorkMinutesPerDay: integer('cost_work_minutes_per_day'),
    // Pronista §Project Estimate — % buffer เฉพาะ task นี้ (null = ใช้ company_config.costBufferPercent) — PM ปรับได้ตรงจาก Tab Project Estimate
    costBufferPercent: integer('cost_buffer_percent'),
    startDate: text('start_date'), // YYYY-MM-DD → ไทม์ไลน์ต่อกลุ่ม
    dueDate: text('due_date'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    // Pronista §My Work UX — เวลาที่กด "ส่งงาน" ล่าสุด (status → waiting_for_test) ใช้เช็ค "ส่งตรวจวันนี้" ในสรุปผลงานประจำวัน
    submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('tasks_project_idx').on(t.projectId),
    index('tasks_group_idx').on(t.groupId, t.sortOrder),
    index('tasks_epic_idx').on(t.epicId),
    index('tasks_assignee_idx').on(t.assigneeId, t.status),
    index('tasks_sprint_idx').on(t.sprintId),
    index('tasks_srs_ref_idx').on(t.srsRefCode),
    index('tasks_origin_ref_idx').on(t.originRefCode),
    index('tasks_origin_code_idx').on(t.projectId, t.originCode),
  ],
)

/** ติดดาว "ทำวันนี้" ต่อคนต่อวัน (SPEC §4.4) — feed งานวันนี้ + standup */
export const taskStars = sqliteTable(
  'task_stars',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    forDate: text('for_date').notNull(), // YYYY-MM-DD (Asia/Bangkok)
  },
  (t) => [index('task_stars_user_date_idx').on(t.userId, t.forDate)],
)

export const taskComments = sqliteTable(
  'task_comments',
  {
    id: id(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    // Pronista §Task Detail redesign — คอมเมนต์ที่ตั้งใจแจ้ง "ติดขัด" (blocked) โชว์เด่นเป็นแท็กแดงในฟีดรวม แยกจากคอมเมนต์ปกติแค่ flag นี้
    isBlocked: integer('is_blocked', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('task_comments_task_idx').on(t.taskId)],
)

// Pronista §attachment links — ลิงก์ภายนอกที่แนบใน task ได้ (นอกเหนือจากอัปโหลดไฟล์) auto-detect จาก hostname ฝั่ง API
export const TASK_LINK_TYPES = ['google_docs', 'figma', 'canva', 'other'] as const

/** ไฟล์แนบบน R2 หรือลิงก์ภายนอก — เก็บเฉพาะ metadata, ตัวไฟล์อยู่ R2 (SPEC §6)
 * 1 แถวเป็นได้ทั้งไฟล์ (r2Key มีค่า, externalUrl null) หรือลิงก์ (externalUrl มีค่า, r2Key null) ไม่ปนกัน */
export const taskAttachments = sqliteTable(
  'task_attachments',
  {
    id: id(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    r2Key: text('r2_key'),
    filename: text('filename').notNull(),
    mime: text('mime'),
    sizeBytes: integer('size_bytes'),
    externalUrl: text('external_url'),
    linkType: text('link_type', { enum: TASK_LINK_TYPES }),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('task_attachments_task_idx').on(t.taskId)],
)

/** Pronista §2.12 — custom field ยืดหยุ่น (label/value เอง) บนหน้า Task Detail */
export const taskCustomFields = sqliteTable(
  'task_custom_fields',
  {
    id: id(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    label: text('label').notNull(),
    value: text('value').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('task_custom_fields_task_idx').on(t.taskId, t.sortOrder)],
)

/** Pronista §Task Detail redesign — เกณฑ์ว่า "เสร็จ" คือแบบไหน (Acceptance Criteria) แยกจาก description อิสระ ให้ติ๊กเช็คทีละข้อได้ */
export const taskChecklistItems = sqliteTable(
  'task_checklist_items',
  {
    id: id(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    text: text('text').notNull(),
    done: integer('done', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('task_checklist_items_task_idx').on(t.taskId, t.sortOrder)],
)

/** งวดงาน → กำไร/ขาดทุนต่องวด (SPEC §4.8) */
export const milestones = sqliteTable(
  'milestones',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    budgetSatang: integer('budget_satang'),
    dueDate: text('due_date'),
    status: text('status', { enum: ['planned', 'active', 'done'] }).notNull().default('planned'),
  },
  (t) => [index('milestones_project_idx').on(t.projectId, t.sortOrder)],
)

/** เงินลูกค้าจ่ายเป็นงวด → % บน card (SPEC §4.8) — owner+member เท่านั้น */
export const payments = sqliteTable(
  'payments',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    installmentNo: integer('installment_no').notNull(),
    label: text('label'),
    amountSatang: integer('amount_satang').notNull(),
    dueDate: text('due_date'),
    paidAt: text('paid_at'), // YYYY-MM-DD ที่รับเงิน (null = ยังไม่จ่าย)
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('payments_project_idx').on(t.projectId, t.installmentNo)],
)

/** เวลา = หัวใจลูปเงิน (SPEC §4.5) — snapshot rate ตอนสร้าง · soft-delete เท่านั้น */
export const timeEntries = sqliteTable(
  'time_entries',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    workDate: text('work_date').notNull(), // YYYY-MM-DD (Asia/Bangkok)
    minutes: integer('minutes').notNull(),
    note: text('note'),
    rateSnapshotSatang: integer('rate_snapshot_satang').notNull(),
    source: text('source', { enum: ['timer', 'manual'] }).notNull(),
    editCount: integer('edit_count').notNull().default(0),
    lastEditedBy: text('last_edited_by'),
    editedAt: integer('edited_at', { mode: 'timestamp_ms' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('time_entries_user_date_idx').on(t.userId, t.workDate),
    index('time_entries_task_idx').on(t.taskId),
    index('time_entries_project_idx').on(t.projectId),
  ],
)

/** timer ที่กำลังเดิน — คนละ 1 ตัว (start ใหม่ = ปิดตัวเก่า) · startedAt = epoch ms ดิบ (คณิตเวลา + ส่งให้ FE เดินนาฬิกา) */
export const timerSessions = sqliteTable('timer_sessions', {
  id: id(),
  userId: text('user_id').notNull().unique(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id),
  startedAt: integer('started_at').notNull(),
})

export const SERVICE_CATEGORIES = ['hosting', 'domain', 'ma', 'server', 'ssl', 'other'] as const

/** บริการต่อเนื่อง (SPEC §4.17) → MRR/ARR + ใกล้หมดอายุ */
export const recurringServices = sqliteTable(
  'recurring_services',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    projectId: text('project_id').references(() => projects.id),
    label: text('label').notNull(),
    category: text('category', { enum: SERVICE_CATEGORIES }).notNull().default('other'),
    period: text('period', { enum: ['monthly', 'yearly'] }).notNull(),
    amountSatang: integer('amount_satang').notNull(),
    nextDueDate: text('next_due_date'), // YYYY-MM-DD วันต่ออายุถัดไป
    status: text('status', { enum: ['active', 'cancelled'] }).notNull().default('active'),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('recurring_client_idx').on(t.clientId, t.status)],
)

/** โน้ต/ข้อควรจำต่อลูกค้า (วันวางบิล/ที่อยู่ส่งเอกสาร ฯลฯ) */
export const clientNotes = sqliteTable(
  'client_notes',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    body: text('body').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('client_notes_client_idx').on(t.clientId)],
)

// Pronista §merge (2026-07-03) — "เอกสาร" ดูดรวม "คลังเอกสาร" (item 3) เข้ามาเป็นเมนูเดียว: 1 โหนดในทรีเป็นได้ทั้งหน้าวิกิ (kind='page'), ลิงก์ Google Docs (kind='link'), หรือไฟล์อัปโหลด (kind='file')
export const DOC_KINDS = ['page', 'link', 'file', 'template', 'folder'] as const
export const DOC_MEMBER_ROLES = ['viewer', 'editor'] as const

/** เอกสาร/wiki tree (SPEC §4.16) — sub-page ลึกได้ · เก็บ markdown · soft-delete ทั้ง subtree · +สิทธิ์ private/team + ลิงก์/ไฟล์ (จาก "คลังเอกสาร" เดิม) */
export const docs = sqliteTable(
  'docs',
  {
    id: id(),
    parentId: text('parent_id'), // self-ref (FK บังคับที่ API — เลี่ยง circular type)
    sortOrder: integer('sort_order').notNull().default(0),
    icon: text('icon'), // emoji (ตาม mockup)
    title: text('title').notNull(),
    contentMarkdown: text('content_markdown').notNull().default(''),
    kind: text('kind', { enum: DOC_KINDS }).notNull().default('page'),
    externalUrl: text('external_url'), // kind='link' — Google Docs/Drive URL อื่นๆ
    r2Key: text('r2_key'), // kind='file'
    filename: text('filename'), // kind='file'
    mime: text('mime'), // kind='file'
    sizeBytes: integer('size_bytes'), // kind='file'
    isTemplate: integer('is_template', { mode: 'boolean' }).notNull().default(false),
    // Pronista §SRS import — เมื่อ kind='file' และเป็นเอกสาร SRS ที่แตก task ออกมา: เวอร์ชัน+เลขเอกสาร (ใช้ประกอบรหัสอ้างอิงงาน) — null สำหรับไฟล์ทั่วไป
    srsDocNumber: text('srs_doc_number'), // เช่น "BNT-SRS-2026-004" — free text จากเอกสาร ไม่ parse โครงสร้าง
    srsVersion: text('srs_version'), // เช่น "1.0" — ใช้ประกอบรหัส "<projectCode>-SRS-v<version>-<NNN>"
    // Pronista §Document Template — เมื่อ kind='template': ประเภท template (คีย์ใน DOC_TEMPLATES registry ฝั่ง @seedoffice/core) + รหัสเอกสารที่ gen ครั้งเดียวตอนสร้าง (immutable)
    templateType: text('template_type'), // เช่น 'mom' — null สำหรับ doc ที่ไม่ใช่ template
    templateDocNumber: text('template_doc_number'), // เช่น "MFL-MOM-07072026-001"
    // Pronista §Document Version History — เลขที่เอกสาร (ระบุ "เล่ม") + เวอร์ชัน ใช้ได้กับทุกประเภท/ทุก kind — เล่มเดียวกัน = docType+docNumber เท่ากัน, เวอร์ชันต่างกันคือ revision ในเล่มเดียวกัน (v1.0/v1.1/v2.0) · backfill จาก template_doc_number/srs_* ตอน migrate
    docNumber: text('doc_number'), // เช่น "BNT-MOM-2026-014" — null = ไฟล์ทั่วไปที่ไม่ได้ระบุเล่ม (นับเป็นเล่มเดี่ยว)
    docVersion: text('doc_version'), // เช่น "1.0"
    // Pronista §Document Traceability — ประเภทเอกสารสำหรับฟิลเตอร์ (ดู DOC_TYPES) — null = ไม่ระบุ/ไม่เข้าพวก
    docType: text('doc_type', { enum: DOC_TYPES }),
    ownerId: text('owner_id').references(() => users.id), // เจ้าของ (สิทธิ์เต็มเสมอ) — เติมจาก createdBy ตอน migrate ของเก่า
    // private = เห็นเฉพาะเจ้าของ+คนใน docMembers · team = ทุกคน (owner/member) เห็นอย่างน้อย viewer — ของเก่าทั้งหมด default 'team' กัน regression (วิกิเดิมทุกคนเห็นหมดอยู่แล้ว)
    visibility: text('visibility', { enum: ['private', 'team'] }).notNull().default('team'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('docs_parent_idx').on(t.parentId, t.sortOrder)],
)

// สิทธิ์ต่อโหนด private (mirror project_members / เดิม library_folder_members) — เจ้าของ+company owner เข้าถึงได้เต็มโดยไม่ต้องมีแถว
export const docMembers = sqliteTable(
  'doc_members',
  {
    id: id(),
    docId: text('doc_id')
      .notNull()
      .references(() => docs.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: DOC_MEMBER_ROLES }).notNull().default('viewer'),
  },
  (t) => [uniqueIndex('doc_members_uq_idx').on(t.docId, t.userId)],
)

// ผูกเอกสาร (ทุก kind รวมหน้าวิกิด้วย) กับ project/task/sub-task — ผูกได้ทีละอย่าง (projectId หรือ taskId)
export const docLinks = sqliteTable(
  'doc_links',
  {
    id: id(),
    docId: text('doc_id')
      .notNull()
      .references(() => docs.id),
    projectId: text('project_id').references(() => projects.id),
    taskId: text('task_id').references(() => tasks.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('doc_links_doc_idx').on(t.docId),
    index('doc_links_task_idx').on(t.taskId),
    index('doc_links_project_idx').on(t.projectId),
  ],
)

// Pronista §Document Traceability — task นี้ "อ้างอิงถึง" task ต้นทางเล่มก่อนหน้า (เช่น Task ของ BR-F03 อ้างถึง Task ของมติ MOM-20260620-D01)
// resolve อัตโนมัติตอนแตก Task จากคอลัมน์ "อ้างอิง XXX" ในตาราง breakoutToTasks (ดู doc-breakout-tasks.ts) — 1 task อ้างอิงต้นทางได้หลายอัน
export const taskReferences = sqliteTable(
  'task_references',
  {
    id: id(),
    taskId: text('task_id')
      .notNull()
      .references((): AnySQLiteColumn => tasks.id),
    referencesTaskId: text('references_task_id')
      .notNull()
      .references((): AnySQLiteColumn => tasks.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('task_references_task_idx').on(t.taskId),
    index('task_references_ref_idx').on(t.referencesTaskId),
    uniqueIndex('task_references_uq_idx').on(t.taskId, t.referencesTaskId),
  ],
)

// ข้อมูลที่กรอกจริงของเอกสาร kind='template' หนึ่งรายการ (1:1 กับ docs) — โครงสร้าง template เองอยู่ในโค้ด (@seedoffice/core doc-templates) ไม่ใช่ตารางนี้
export const docTemplateValues = sqliteTable(
  'doc_template_values',
  {
    id: id(),
    docId: text('doc_id')
      .notNull()
      .references(() => docs.id),
    templateType: text('template_type').notNull(), // denormalized จาก docs.templateType เพื่อ query ง่าย
    dataJson: text('data_json').notNull().default('{}'), // TemplateData (จาก @seedoffice/core) — serialize เป็น string
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex('doc_template_values_doc_uq_idx').on(t.docId)],
)

export const docImages = sqliteTable(
  'doc_images',
  {
    id: id(),
    docId: text('doc_id'),
    r2Key: text('r2_key').notNull(),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('doc_images_doc_idx').on(t.docId)],
)

// Pronista §Document Attachments — ส่วนแนบท้ายเอกสาร template ทุกประเภท: ลิงก์ภายนอก (เช่น ลิงก์บันทึกประชุม Google Meet) หรือไฟล์/รูปใน R2
export const DOC_ATTACHMENT_KINDS = ['link', 'file'] as const
export const docAttachments = sqliteTable(
  'doc_attachments',
  {
    id: id(),
    docId: text('doc_id')
      .notNull()
      .references(() => docs.id),
    kind: text('kind', { enum: DOC_ATTACHMENT_KINDS }).notNull(),
    label: text('label').notNull(), // ชื่อที่แสดง (ลิงก์ = ชื่อลิงก์, ไฟล์ = ชื่อไฟล์เดิมถ้าไม่ตั้งเอง)
    url: text('url'), // เฉพาะ kind='link'
    filename: text('filename'), // เฉพาะ kind='file'
    mime: text('mime'),
    sizeBytes: integer('size_bytes'),
    r2Key: text('r2_key'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('doc_attachments_doc_idx').on(t.docId)],
)

// Pronista §External Document Version Logging — log เวอร์ชันเอกสารภายนอก (เช่น เล่ม UI Design บน Canva) ต่อโปรเจกต์
// append-only: อัปเดตเวอร์ชัน = เพิ่มแถวใหม่เสมอ ไม่เขียนทับ เพื่อดูประวัติย้อนหลังได้ · ผูกกับ SOW Task ผ่าน pivot ด้านล่างเพื่อทำ Traceability
export const EXTERNAL_DOC_LOG_STATUSES = ['draft', 'under_review', 'approved'] as const
export const externalDocumentLogs = sqliteTable(
  'external_document_logs',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    documentName: text('document_name').notNull(), // เช่น "User Interface Design"
    externalUrl: text('external_url').notNull(), // ลิงก์ Canva/Figma ฯลฯ
    version: text('version').notNull(), // เช่น "v1.0"
    startDate: text('start_date'), // YYYY-MM-DD วันที่เริ่มทำ
    endDate: text('end_date'), // YYYY-MM-DD วันที่สิ้นสุด/ส่งมอบ
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id), // ผู้จัดทำ (เลือกได้ในฟอร์ม ไม่จำเป็นต้องเป็นคนกดบันทึก)
    reviewedBy: text('reviewed_by').references(() => users.id), // ผู้ตรวจรีวิว
    status: text('status', { enum: EXTERNAL_DOC_LOG_STATUSES }).notNull().default('draft'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('external_doc_logs_project_idx').on(t.projectId)],
)

export const externalDocumentLogSowTasks = sqliteTable(
  'external_document_log_sow_tasks',
  {
    id: id(),
    logId: text('log_id')
      .notNull()
      .references(() => externalDocumentLogs.id),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
  },
  (t) => [index('external_doc_log_sow_log_idx').on(t.logId), uniqueIndex('external_doc_log_sow_uq_idx').on(t.logId, t.taskId)],
)

/** Pronista §Version Release — แท็บ "Version Release" ต่อโปรเจกต์ (อยู่ต่อจาก "ประวัติเอกสาร") log เวอร์ชันที่ปล่อยจริงพร้อม release note
 * sortOrder ใช้แสดง "ลำดับ" ในตาราง — เรียงจากค่ามากไปน้อย (เวอร์ชันล่าสุดอยู่บนสุด) กำหนดค่าใหม่ตอนสร้าง = max(sortOrder ที่มี)+1 */
export const projectReleases = sqliteTable(
  'project_releases',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    version: text('version').notNull(), // เช่น "v2.1.0 (230)"
    notes: text('notes').notNull(), // markdown — เขียนผ่าน RichTextField เดียวกับ field richtext ของ doc-templates
    sortOrder: integer('sort_order').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('project_releases_project_idx').on(t.projectId)],
)

export const ADJUSTMENT_KINDS = [
  'allowance',
  'depreciation',
  'bonus',
  'other_income',
  'sso',
  'wht',
  'other_deduction',
] as const

/**
 * รายการรายได้/หัก ต่อคนต่องวด (SPEC §4.7) — owner กรอกเหมือนที่ทำมือ
 * งวดอ้างด้วย cycleStart (YYYY-MM-DD วันที่ 25) แทน pay_cycles id — งวดเปิดไม่ต้องมีแถวล่วงหน้า
 * bonus = ความลับ (เจ้าตัว + owner เท่านั้น — บังคับที่ API)
 */
export const payAdjustments = sqliteTable(
  'pay_adjustments',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    cycleStart: text('cycle_start').notNull(),
    kind: text('kind', { enum: ADJUSTMENT_KINDS }).notNull(),
    amountSatang: integer('amount_satang').notNull(), // เก็บบวกเสมอ kind บอกทิศ
    note: text('note'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('pay_adjustments_user_cycle_idx').on(t.userId, t.cycleStart)],
)

/** โน้ต owner → พนักงาน ต่องวด (เตือน/ชม) — เจ้าตัว + owner เท่านั้น (SPEC §4.7) */
export const payNotes = sqliteTable(
  'pay_notes',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    cycleStart: text('cycle_start').notNull(),
    body: text('body').notNull(),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => users.id),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('pay_notes_user_cycle_idx').on(t.userId, t.cycleStart)],
)

/** snapshot ตอนปิดงวด — หลักฐานถาวร ไม่เปลี่ยนย้อนหลัง (SPEC §4.7) */
export const payslips = sqliteTable(
  'payslips',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    cycleStart: text('cycle_start').notNull(),
    cycleEnd: text('cycle_end').notNull(),
    payDate: text('pay_date').notNull(),
    minutesTotal: integer('minutes_total').notNull(),
    baseSatang: integer('base_satang').notNull(),
    incomeSatang: integer('income_satang').notNull(),
    deductionSatang: integer('deduction_satang').notNull(),
    netSatang: integer('net_satang').notNull(),
    linesJson: text('lines_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    ownerNote: text('owner_note'),
    closedAt: integer('closed_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('payslips_user_cycle_idx').on(t.userId, t.cycleStart)],
)

/** ทะเบียนงวดที่ปิดแล้ว — กันแก้เวลา/adjustment ย้อนหลังในงวดปิด */
export const payCycleClosures = sqliteTable('pay_cycle_closures', {
  cycleStart: text('cycle_start').primaryKey(),
  cycleEnd: text('cycle_end').notNull(),
  closedBy: text('closed_by')
    .notNull()
    .references(() => users.id),
  closedAt: integer('closed_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const EXPENSE_CATEGORIES = ['hosting', 'travel', 'equipment', 'software', 'other'] as const
export const EXPENSE_STATUSES = ['pending', 'approved', 'rejected', 'reimbursed'] as const

/** เงินสดย่อย (SPEC §4.9) — pending → approved/rejected → reimbursed (owner อนุมัติ) */
export const expenses = sqliteTable(
  'expenses',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    expenseDate: text('expense_date').notNull(), // YYYY-MM-DD
    amountSatang: integer('amount_satang').notNull(),
    category: text('category', { enum: EXPENSE_CATEGORIES }).notNull().default('other'),
    description: text('description').notNull(),
    receiptKey: text('receipt_key'), // R2
    paidBy: text('paid_by', { enum: ['company', 'self'] }).notNull().default('self'),
    projectId: text('project_id').references(() => projects.id),
    status: text('status', { enum: EXPENSE_STATUSES }).notNull().default('pending'),
    approvedBy: text('approved_by'),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('expenses_user_idx').on(t.userId, t.status), index('expenses_date_idx').on(t.expenseDate)],
)

export const CALENDAR_EVENT_TYPES = ['holiday', 'leave', 'meeting', 'deadline', 'other'] as const

/** ปฏิทินทีม (SPEC §4.14) — เก็บเฉพาะ event ที่สร้างเอง · ตัดรอบ/จ่ายเงินเดือน = virtual จาก config */
export const calendarEvents = sqliteTable(
  'calendar_events',
  {
    id: id(),
    title: text('title').notNull(),
    startDate: text('start_date').notNull(), // YYYY-MM-DD (all-day ระบุเวลาในชื่อได้ตามสไตล์ mockup)
    endDate: text('end_date'), // ช่วงหลายวัน (รวมวันสุดท้าย)
    type: text('type', { enum: CALENDAR_EVENT_TYPES }).notNull().default('other'),
    userId: text('user_id').references(() => users.id), // วันลาของใคร → team activity
    projectId: text('project_id').references(() => projects.id),
    source: text('source', { enum: ['local', 'gcal'] }).notNull().default('local'), // gcal = P3
    gcalId: text('gcal_id'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('calendar_events_date_idx').on(t.startDate)],
)

/** Pronista §1 (2026-07-03) — ผู้เข้าร่วมประชุม (หลายคนต่อ event) แยกจาก calendarEvents.userId (ใช้เฉพาะ "วันลาของใคร" อยู่แล้ว) */
export const calendarEventAttendees = sqliteTable(
  'calendar_event_attendees',
  {
    id: id(),
    eventId: text('event_id')
      .notNull()
      .references(() => calendarEvents.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [index('calendar_event_attendees_event_idx').on(t.eventId)],
)

/**
 * [P3 §4.12] thread ในอีเมลกลาง — folder (unassigned/mine/assigned/closed/spam) derive จาก assignee+status
 * unread = true เมื่อมีเมลเข้าใหม่ (sync) · เปิดอ่านในระบบ → false · เมลเข้าบน thread closed → เปิดใหม่
 */
export const inboxThreads = sqliteTable(
  'inbox_threads',
  {
    id: id(),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => inboxMailboxes.id),
    gmailThreadId: text('gmail_thread_id').notNull(),
    subject: text('subject').notNull().default(''),
    contactEmail: text('contact_email'), // คู่สนทนา (อีเมลเปล่า lowercase) — ผูกการ์ดลูกค้า/ประวัติ
    status: text('status', { enum: ['open', 'snoozed', 'closed', 'spam'] })
      .notNull()
      .default('open'),
    unread: integer('unread', { mode: 'boolean' }).notNull().default(false),
    assigneeId: text('assignee_id').references(() => users.id),
    tags: text('tags', { mode: 'json' }).$type<string[]>(),
    lastMessageAt: integer('last_message_at', { mode: 'timestamp_ms' }).notNull(),
    snoozeUntil: integer('snooze_until', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('inbox_threads_mailbox_gmail_idx').on(t.mailboxId, t.gmailThreadId),
    index('inbox_threads_mailbox_last_idx').on(t.mailboxId, t.lastMessageAt),
    index('inbox_threads_folder_idx').on(t.status, t.assigneeId),
  ],
)

/** [P3 §4.12] ข้อความในอีเมลกลาง — metadata ใน D1, body เต็มอยู่ R2 เสมอ (กัน D1 บวม — §13) */
export const inboxMessages = sqliteTable(
  'inbox_messages',
  {
    id: id(),
    threadId: text('thread_id')
      .notNull()
      .references(() => inboxThreads.id),
    gmailMessageId: text('gmail_message_id').notNull(),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    fromAddr: text('from_addr').notNull().default(''), // header เต็ม "ชื่อ <email>" ไว้แสดงผล
    toAddr: text('to_addr').notNull().default(''),
    ccAddr: text('cc_addr'),
    snippet: text('snippet').notNull().default(''),
    bodyKey: text('body_key'), // R2 key (contentType อยู่ใน R2 metadata) — null = เมลไม่มี body
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }).notNull(), // = internalDate ของ Gmail
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('inbox_messages_thread_gmail_idx').on(t.threadId, t.gmailMessageId),
    index('inbox_messages_thread_sent_idx').on(t.threadId, t.sentAt),
  ],
)

/** [P3 §4.12] ไฟล์แนบ — เก็บ metadata ตอน sync · ตัวไฟล์โหลด lazy ครั้งแรกที่เปิดแล้ว cache ลง R2 */
export const inboxAttachments = sqliteTable(
  'inbox_attachments',
  {
    id: id(),
    messageId: text('message_id')
      .notNull()
      .references(() => inboxMessages.id),
    gmailAttachmentId: text('gmail_attachment_id').notNull(),
    r2Key: text('r2_key'), // null = ยังไม่เคยโหลด
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('inbox_attachments_message_idx').on(t.messageId)],
)

/** [P3 §4.12] โน้ตภายในบน thread — ทีมเห็นกันเอง ไม่ส่งถึงลูกค้า */
export const inboxNotes = sqliteTable(
  'inbox_notes',
  {
    id: id(),
    threadId: text('thread_id')
      .notNull()
      .references(() => inboxThreads.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('inbox_notes_thread_idx').on(t.threadId, t.createdAt)],
)

/** [P3 §4.12] ข้อความสำเร็จรูป (canned replies) — ทีมสร้าง/ใช้ร่วมกัน · soft-delete */
export const inboxCanned = sqliteTable('inbox_canned', {
  id: id(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
})

/** [P3 §4.12] สถานะ sync ราย mailbox — lastHistoryId เป็น text (uint64) · lastError โชว์ใน ตั้งค่า */
export const gmailSyncState = sqliteTable(
  'gmail_sync_state',
  {
    id: id(),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => inboxMailboxes.id),
    lastHistoryId: text('last_history_id'),
    lastSyncAt: integer('last_sync_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
  },
  (t) => [uniqueIndex('gmail_sync_state_mailbox_idx').on(t.mailboxId)],
)

/**
 * [P3 §4.14 · E6] บัญชี Google Calendar ที่เชื่อมเพื่อ sync ขาเข้า (read-only)
 * ใช้ OAuth client (Internal) ตัวเดียวกับอีเมลกลางฝั่ง SeedWebs (scope calendar.readonly)
 * event ที่ sync เข้ามาอยู่ใน calendar_events (source='gcal', gcalId) · syncToken = incremental
 */
export const calendarConnections = sqliteTable('calendar_connections', {
  id: id(),
  clientId: text('client_id')
    .notNull()
    .references(() => inboxGoogleClients.id),
  googleEmail: text('google_email'),
  googleAccountId: text('google_account_id'),
  refreshTokenEnc: text('refresh_token_enc'),
  status: text('status', { enum: ['connected', 'disconnected'] })
    .notNull()
    .default('disconnected'),
  syncToken: text('sync_token'), // Google incremental sync token (หมดอายุ → full resync)
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp_ms' }),
  lastError: text('last_error'),
  connectedAt: integer('connected_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

/**
 * [P3 §4.12] OAuth client (Internal) ของอีเมลกลาง — ต่อบริษัท/Workspace
 * เพิ่มผ่านหน้า ตั้งค่า เท่านั้น (repo public — ห้าม hardcode/seed) · secret เข้ารหัส AES-GCM ก่อนเก็บ
 */
export const inboxGoogleClients = sqliteTable('inbox_google_clients', {
  id: id(),
  label: text('label').notNull(), // ชื่อเรียก เช่นชื่อบริษัท — ใช้เลือกตอนเพิ่มกล่อง
  clientId: text('client_id').notNull(),
  clientSecretEnc: text('client_secret_enc').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }), // soft-delete (SPEC §9)
})

/**
 * [P3 §4.12] กล่องเมลที่เชื่อม — สร้างผ่าน ตั้งค่า แล้วกด "เชื่อม Gmail"
 * emailAddress/gmailAccountId มาจากบัญชีที่ consent จริง (ไม่ให้พิมพ์เอง) · refresh token เข้ารหัส
 */
export const inboxMailboxes = sqliteTable(
  'inbox_mailboxes',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => inboxGoogleClients.id),
    companyLabel: text('company_label').notNull(), // text อิสระ ไม่ใช่ enum — จัดกลุ่ม dropdown กล่อง
    name: text('name').notNull(), // ชื่อกล่องที่ทีมเห็น
    emailAddress: text('email_address'),
    gmailAccountId: text('gmail_account_id'),
    refreshTokenEnc: text('refresh_token_enc'),
    status: text('status', { enum: ['connected', 'disconnected', 'disabled'] })
      .notNull()
      .default('disconnected'),
    connectedAt: integer('connected_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('inbox_mailboxes_status_idx').on(t.status)],
)

/** log การเปลี่ยนข้อมูลการเงิน/เวลา (SPEC §11: ทุก manual/แก้/ลบ + การเงิน) — meta เก็บ before→after */
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: id(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(), // เช่น 'rate.create' · 'time_entry.update' · 'pay_cycle.close'
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
    at: integer('at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('audit_entity_idx').on(t.entity, t.entityId),
    index('audit_actor_idx').on(t.actorId),
  ],
)

// Pronista §My Work/Notification — แจ้งเตือนในระบบ (ไม่ส่งอีเมล) ตอน assign/complete Subtask
// Pronista §Task lifecycle notifications — เพิ่ม 4 ค่าสำหรับ task หลัก (ไม่ใช่แค่ subtask) ตลอด flow จ่ายงาน→ส่งงาน→ปิดงาน/ตีกลับ (คอลัมน์เป็น TEXT ธรรมดา ไม่มี CHECK constraint → ไม่ต้อง migration)
export const NOTIFICATION_TYPES = [
  'subtask_assigned',
  'subtask_completed',
  'task_dispatched',
  'task_submitted',
  'task_approved',
  'task_bounced',
  // Pronista §Subscription Notify — เตือน Project Lead ก่อนโปรเจกต์ใกล้หมดอายุบริการ (คอลัมน์ TEXT ธรรมดา ไม่ต้อง migration)
  'expiry_reminder',
] as const

export const notifications = sqliteTable(
  'notifications',
  {
    id: id(),
    userId: text('user_id') // ผู้รับแจ้งเตือน
      .notNull()
      .references(() => users.id),
    type: text('type', { enum: NOTIFICATION_TYPES }).notNull(),
    taskId: text('task_id').references((): AnySQLiteColumn => tasks.id),
    projectId: text('project_id').references(() => projects.id),
    message: text('message').notNull(),
    isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.isRead, t.createdAt)],
)

export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type ApiToken = typeof apiTokens.$inferSelect
export type Rate = typeof rates.$inferSelect
export type CompanyConfig = typeof companyConfig.$inferSelect
export type AuditLog = typeof auditLogs.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type Client = typeof clients.$inferSelect
export type Project = typeof projects.$inferSelect
export type TaskGroup = typeof taskGroups.$inferSelect
export type Sprint = typeof sprints.$inferSelect
export type Task = typeof tasks.$inferSelect
export type TaskComment = typeof taskComments.$inferSelect
export type TaskAttachment = typeof taskAttachments.$inferSelect
export type TaskStar = typeof taskStars.$inferSelect
export type TimeEntry = typeof timeEntries.$inferSelect
export type TimerSession = typeof timerSessions.$inferSelect
export type Milestone = typeof milestones.$inferSelect
export type Payment = typeof payments.$inferSelect
export type PayAdjustment = typeof payAdjustments.$inferSelect
export type PayNote = typeof payNotes.$inferSelect
export type Payslip = typeof payslips.$inferSelect
export type Doc = typeof docs.$inferSelect
export type DocImage = typeof docImages.$inferSelect
export type RecurringService = typeof recurringServices.$inferSelect
export type ClientNote = typeof clientNotes.$inferSelect
export type Expense = typeof expenses.$inferSelect
export type CalendarEvent = typeof calendarEvents.$inferSelect
export type InboxGoogleClient = typeof inboxGoogleClients.$inferSelect
export type InboxMailbox = typeof inboxMailboxes.$inferSelect
export type InboxThread = typeof inboxThreads.$inferSelect
export type InboxMessage = typeof inboxMessages.$inferSelect
export type InboxNote = typeof inboxNotes.$inferSelect
export type InboxCanned = typeof inboxCanned.$inferSelect
export type InboxAttachment = typeof inboxAttachments.$inferSelect
export type GmailSyncState = typeof gmailSyncState.$inferSelect
export type CalendarConnection = typeof calendarConnections.$inferSelect
export type DocMember = typeof docMembers.$inferSelect
export type DocLink = typeof docLinks.$inferSelect
