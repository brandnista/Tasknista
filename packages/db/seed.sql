-- Seed ข้อมูลตัวอย่าง (ตรงกับ persona ใน mockup — anonymized แล้ว)
-- ใช้เฉพาะ dev/preview · production เริ่มว่าง (นโยบาย launch: fresh start)
-- รัน: pnpm db:seed

INSERT OR REPLACE INTO company_config (id, cutoff_day, work_hour_cap_minutes, member_domain) VALUES (1, 25, 480, '@example-co.test');

-- users — id คงที่ ไว้อ้างในเทสต์/e2e
INSERT OR REPLACE INTO users (id, email, name, google_sub, role, status, avatar_url, created_at) VALUES
  ('u_owner', 'owner@example-co.test',            'เมธ',    NULL, 'owner',  'active', NULL, 1767200000000),
  ('u_pond',  'pond@example-co.test',             'ปอนด์',  NULL, 'member', 'active', NULL, 1767200000000),
  ('u_nam',   'nam@example-co.test',              'น้ำ',    NULL, 'member', 'active', NULL, 1767200000000),
  ('u_beam',  'beam@example-co.test',             'บีม',    NULL, 'member', 'active', NULL, 1767200000000),
  ('u_korn',  'korn@example-co.test',             'กร',     NULL, 'member', 'active', NULL, 1767200000000),
  ('u_jay',   'jay@example-co.test',              'เจ',     NULL, 'member', 'active', NULL, 1767200000000),
  ('u_fah',   'fah@example-co.test',              'ฟ้า',    NULL, 'member', 'active', NULL, 1767200000000),
  ('u_praew', 'praew@example-co.test',            'แพรว',   NULL, 'member', 'active', NULL, 1767200000000),
  ('u_toon',  'toon@example-co.test',             'ตูน',    NULL, 'member', 'active', NULL, 1767200000000),
  ('u_mint',  'mint@example-co.test',             'มิ้นท์', NULL, 'member', 'active', NULL, 1767200000000),
  ('u_somchai','somchai.freelance@example.com','สมชาย',  NULL, 'vendor', 'active', NULL, 1767200000000);

-- clients (ตรง mockup CRM)
INSERT OR REPLACE INTO clients (id, name, logo, contact_name, contact_email, contact_phone, note, status, created_at) VALUES
  ('c_sapcharoen','ทรัพย์เจริญ พร็อพเพอร์ตี้','🏢','คุณสมพร','somporn@sapcharoen.example','02-444-7788',NULL,'active',1767200000000),
  ('c_bloom','Bloom Studio','🛍️','คุณแนน','nan@bloom.example','089-111-2233',NULL,'active',1767200000000),
  ('c_dentcare','คลินิกทันตกรรม ยิ้มสวย','🦷','หมอแอน','ann@dentcare.example','02-712-3030',NULL,'active',1767200000000),
  ('c_skillup','SkillUp Academy','🎓','คุณเจษ','jed@skillup.example','086-700-4545',NULL,'active',1767200000000),
  ('c_bright','BrightMedia','📰','คุณบี','b@brightmedia.example','02-555-0199',NULL,'active',1767200000000),
  ('c_campus','CampusLink','🏫','คุณกอล์ฟ','golf@campuslink.example','02-300-1212',NULL,'active',1767200000000),
  ('c_baansuan','ร้านกาแฟ บ้านสวน','☕','คุณฝน','fon@baansuan.example','081-234-5678',NULL,'active',1767200000000),
  ('c_glow','คลินิกความงาม Glow','💄','คุณมุก','mook@glow.example','02-660-7700',NULL,'active',1767200000000),
  ('c_somwang','บจก. สมหวัง Logistics','🚚','คุณวิทย์','wit@somwang.example','02-390-6611',NULL,'active',1767200000000),
  ('c_daoden','โรงเรียนอนุบาลดาวเด่น','🏫','ครูแอน','ann@daoden.example','02-901-2345',NULL,'active',1767200000000);

-- projects: 6 งานโปรเจกต์ + 5 งานต่อเนื่อง + 2 archived (เงิน = สตางค์)
INSERT OR REPLACE INTO projects (id, code, name, logo, client_id, type, status, quoted_satang, billing_type, recurring_period, start_date, due_date, created_at) VALUES
  ('p_sap',  'SAP', 'เว็บไซต์ ทรัพย์เจริญ',        '🏢','c_sapcharoen','project','staging',18000000,'fixed',NULL,'2026-01-01','2026-06-30',1767200000000),
  ('p_bloom','BLM', 'ร้านค้าออนไลน์ Bloom',        '🛍️','c_bloom','project','dev',    25000000,'fixed',NULL,'2026-03-01','2026-08-31',1767200000000),
  ('p_dent', 'DNT', 'ระบบจองคิว คลินิกหมอฟัน',     '🦷','c_dentcare','project','staging',22000000,'fixed',NULL,'2026-02-01','2026-06-30',1767200000000),
  ('p_skill','SKL', 'คอร์สออนไลน์ SkillUp',        '📚','c_skillup','project','dev',   30000000,'fixed',NULL,'2026-05-01','2026-07-31',1767200000000),
  ('p_bright','BRM','แพลตฟอร์มข่าว BrightMedia',   '📰','c_bright','project','golive', 70000000,'fixed',NULL,'2026-01-01','2026-06-30',1767200000000),
  ('p_campus','CPL','พอร์ทัลนักศึกษา CampusLink',  '🎓','c_campus','project','ma',     24000000,'fixed',NULL,'2026-01-01','2026-04-30',1767200000000),
  ('p_baansuan',NULL,'ร้านกาแฟ บ้านสวน',           '☕','c_baansuan','recurring','ma', NULL,'recurring','monthly',NULL,NULL,1767200000000),
  ('p_glow',  NULL,'คลินิกความงาม Glow',           '💄','c_glow','recurring','ma',     NULL,'recurring','monthly',NULL,NULL,1767200000000),
  ('p_somwang',NULL,'บจก. สมหวัง Logistics',       '🚚','c_somwang','recurring','ma',  NULL,'recurring','yearly',NULL,NULL,1767200000000),
  ('p_daoden',NULL,'โรงเรียนอนุบาลดาวเด่น',        '🏫','c_daoden','recurring','ma',   NULL,'recurring','monthly',NULL,NULL,1767200000000),
  ('p_fitzone',NULL,'ฟิตเนส FitZone',              '🏋️',NULL,'recurring','ma',        NULL,'recurring','monthly',NULL,NULL,1767200000000),
  ('p_thairung',NULL,'เว็บเก่า บจก. ไทยรุ่งเรือง', '🗂️',NULL,'project','archived',    9000000,'fixed',NULL,'2024-01-01','2024-06-30',1767200000000),
  ('p_songkran',NULL,'Landing แคมเปญ Songkran 67','🎪',NULL,'project','archived',     3500000,'fixed',NULL,'2024-03-01','2024-04-15',1767200000000);

-- task groups + tasks ของ ทรัพย์เจริญ (ตาม mockup project detail)
INSERT OR REPLACE INTO task_groups (id, project_id, name, sort_order) VALUES
  ('g_sap_design','p_sap','Design',0),
  ('g_sap_fe','p_sap','Frontend',1),
  ('g_sap_be','p_sap','Backend',2),
  ('g_sap_stg','p_sap','Staging',3),
  ('g_sap_uat','p_sap','UAT',4),
  ('g_sap_live','p_sap','Go Live',5),
  ('g_sap_ma','p_sap','MA',6),
  ('g_bloom_fe','p_bloom','Frontend',0),
  ('g_bloom_be','p_bloom','Backend',1),
  ('g_baansuan_ma','p_baansuan','งานประจำ',0),
  ('g_glow_ma','p_glow','งานประจำ',0),
  ('g_somwang_ma','p_somwang','งานประจำ',0),
  ('g_daoden_ma','p_daoden','งานประจำ',0);

INSERT OR REPLACE INTO tasks (id, project_id, group_id, sort_order, title, description, assignee_id, status, priority, estimate_minutes, start_date, due_date, created_by, created_at, completed_at) VALUES
  ('t_sap_hero','p_sap','g_sap_design',0,'Hero section',NULL,'u_nam','done','normal',1320,'2026-01-05','2026-02-10','u_owner',1767200000000,1767300000000),
  ('t_sap_about','p_sap','g_sap_design',1,'หน้า About + ทีม',NULL,'u_nam','on_processing','normal',480,'2026-02-01','2026-06-11','u_owner',1767200000000,NULL),
  ('t_sap_product','p_sap','g_sap_fe',0,'หน้า Product','ทำหน้า product listing + filter ตาม design ใน Figma รองรับ responsive','u_owner','on_processing','high',1860,'2026-02-10','2026-06-15','u_owner',1767200000000,NULL),
  ('t_sap_api','p_sap','g_sap_fe',1,'เชื่อม API สินค้า',NULL,'u_pond','non_start','normal',NULL,'2026-03-01','2026-06-10','u_owner',1767200000000,NULL),
  ('t_sap_resp','p_sap','g_sap_fe',2,'ปรับ responsive มือถือ',NULL,'u_beam','non_start','normal',720,'2026-03-15','2026-06-12','u_owner',1767200000000,NULL),
  ('t_sap_setup','p_sap','g_sap_be',0,'เซ็ตอัพ API + DB schema',NULL,'u_korn','done','normal',1680,'2026-02-10','2026-03-15','u_owner',1767200000000,1767300000000),
  ('t_sap_auth','p_sap','g_sap_be',1,'ระบบสมาชิก / auth',NULL,'u_korn','done','normal',1440,'2026-03-01','2026-04-01','u_owner',1767200000000,1767300000000),
  ('t_sap_pay','p_sap','g_sap_be',2,'เชื่อม payment gateway',NULL,'u_pond','on_processing','high',1200,'2026-04-01','2026-06-13','u_owner',1767200000000,NULL),
  ('t_sap_stg1','p_sap','g_sap_stg',0,'ขึ้น staging server',NULL,'u_korn','done','normal',360,'2026-04-16','2026-05-01','u_owner',1767200000000,1767300000000),
  ('t_sap_stg2','p_sap','g_sap_stg',1,'ทดสอบ regression',NULL,'u_beam','on_processing','normal',720,'2026-05-01','2026-06-20','u_owner',1767200000000,NULL),
  ('t_sap_uat1','p_sap','g_sap_uat',0,'ลูกค้าทดสอบ + เก็บ feedback',NULL,'u_owner','non_start','normal',NULL,'2026-05-07','2026-06-21','u_owner',1767200000000,NULL),
  ('t_sap_live1','p_sap','g_sap_live',0,'ย้ายขึ้น production',NULL,'u_korn','non_start','high',NULL,'2026-06-21','2026-06-30','u_owner',1767200000000,NULL),
  ('t_bloom_checkout','p_bloom','g_bloom_fe',0,'ทำหน้า checkout',NULL,'u_pond','on_processing','high',2400,'2026-04-01','2026-06-30','u_owner',1767200000000,NULL),
  ('t_bloom_api','p_bloom','g_bloom_be',0,'API สินค้า',NULL,'u_korn','on_processing','normal',1800,'2026-04-01','2026-07-15','u_owner',1767200000000,NULL),
  ('t_baansuan_menu','p_baansuan','g_baansuan_ma',0,'อัปเดตเมนูหน้าร้าน',NULL,'u_nam','non_start','normal',120,NULL,'2026-06-11','u_owner',1767200000000,NULL),
  ('t_glow_banner','p_glow','g_glow_ma',0,'แก้แบนเนอร์โปรโมชัน',NULL,'u_fah','non_start','normal',90,NULL,'2026-06-09','u_owner',1767200000000,NULL),
  ('t_somwang_ssl','p_somwang','g_somwang_ma',0,'ต่ออายุ SSL + domain',NULL,'u_korn','non_start','normal',60,NULL,'2026-06-12','u_owner',1767200000000,NULL),
  ('t_daoden_news','p_daoden','g_daoden_ma',0,'เพิ่มข่าวรับสมัคร',NULL,'u_praew','non_start','normal',60,NULL,'2026-06-15','u_owner',1767200000000,NULL);

-- milestones + payments (ตรง mockup CRM: ทรัพย์เจริญ จ่ายแล้ว 50% · คลินิก 70% overdue งวด 3)
INSERT OR REPLACE INTO milestones (id, project_id, name, sort_order, budget_satang, due_date, status) VALUES
  ('m_sap_1','p_sap','งวด 1 · ออกแบบ + โครงเว็บ',0,6000000,'2026-03-15','done'),
  ('m_sap_2','p_sap','งวด 2 · พัฒนา + ขึ้น staging',1,7000000,'2026-05-15','active'),
  ('m_sap_3','p_sap','งวด 3 · ส่งมอบ + go live',2,5000000,'2026-06-30','planned'),
  ('m_bloom_1','p_bloom','งวด 1 · มัดจำเริ่มงาน',0,7500000,'2026-03-15','done'),
  ('m_bloom_2','p_bloom','งวด 2 · ระบบร้านค้า',1,10000000,'2026-06-30','active');

INSERT OR REPLACE INTO payments (id, project_id, installment_no, label, amount_satang, due_date, paid_at, created_at) VALUES
  ('pay_sap_1','p_sap',1,'งวด 1 · มัดจำ 50%',9000000,'2026-02-01','2026-02-03',1767200000000),
  ('pay_sap_2','p_sap',2,'งวด 2 · 50% (ส่งมอบ)',9000000,'2026-06-30',NULL,1767200000000),
  ('pay_bloom_1','p_bloom',1,'งวด 1 · มัดจำ 30%',7500000,'2026-03-01','2026-03-02',1767200000000),
  ('pay_bloom_2','p_bloom',2,'งวด 2 · 40%',10000000,'2026-07-15',NULL,1767200000000),
  ('pay_bloom_3','p_bloom',3,'งวด 3 · 30% (ส่งมอบ)',7500000,'2026-08-31',NULL,1767200000000),
  ('pay_dent_1','p_dent',1,'งวด 1 · 40%',8800000,'2026-03-01','2026-03-01',1767200000000),
  ('pay_dent_2','p_dent',2,'งวด 2 · 30%',6600000,'2026-05-01','2026-05-02',1767200000000),
  ('pay_dent_3','p_dent',3,'งวด 3 · 30%',6600000,'2026-05-24',NULL,1767200000000);

-- recurring services + client notes (ตรง mockup CRM)
INSERT OR REPLACE INTO recurring_services (id, client_id, project_id, label, category, period, amount_satang, next_due_date, status, note, created_at) VALUES
  ('rs_sap_host','c_sapcharoen','p_sap','Hosting','hosting','monthly',150000,'2026-07-05','active',NULL,1767200000000),
  ('rs_bright_server','c_bright','p_bright','Server (VPS) + ดูแล','server','monthly',800000,'2026-06-20','active',NULL,1767200000000),
  ('rs_dent_ma','c_dentcare','p_dent','ดูแลระบบรายเดือน (MA)','ma','monthly',500000,'2026-07-10','active',NULL,1767200000000),
  ('rs_somwang_ma','c_somwang',NULL,'สัญญาดูแลระบบ (MA) รายปี','ma','yearly',2400000,'2026-06-12','active',NULL,1767200000000),
  ('rs_somwang_ssl','c_somwang',NULL,'SSL Certificate','ssl','yearly',120000,'2026-06-30','active',NULL,1767200000000),
  ('rs_baansuan_ma','c_baansuan','p_baansuan','ดูแลเว็บรายเดือน (MA)','ma','monthly',350000,'2026-07-01','active',NULL,1767200000000),
  ('rs_baansuan_domain','c_baansuan',NULL,'โดเมน .com','domain','yearly',90000,'2026-06-12','active',NULL,1767200000000),
  ('rs_daoden_ma','c_daoden','p_daoden','ดูแลเว็บไซต์ (MA)','ma','monthly',300000,'2026-09-01','active',NULL,1767200000000),
  ('rs_daoden_domain','c_daoden',NULL,'โดเมน .ac.th','domain','yearly',85600,'2026-06-18','active',NULL,1767200000000),
  ('rs_glow_ma','c_glow','p_glow','ดูแลระบบ + อัปเดต (MA)','ma','monthly',400000,'2026-08-05','active',NULL,1767200000000);

INSERT OR REPLACE INTO client_notes (id, client_id, body, created_by, created_at) VALUES
  ('cn_sap_1','c_sapcharoen','วางบิลทุกสิ้นเดือน ส่งใบกำกับให้คุณสมพรทางอีเมล','u_owner',1767200000000),
  ('cn_somwang_1','c_somwang','ส่งเอกสารตัวจริงไปสำนักงานใหญ่ (คนละที่กับที่จดทะเบียน)','u_owner',1767210000000),
  ('cn_somwang_2','c_somwang','ต่อสัญญา MA ทุกเดือน มิ.ย.','u_owner',1767220000000),
  ('cn_baansuan_1','c_baansuan','เจ้าของร้านเช็กไลน์ช่วงบ่าย','u_nam',1767200000000),
  ('cn_dent_1','c_dentcare','ติดต่อทางไลน์เป็นหลัก อีเมลตอบช้า','u_nam',1767200000000);

-- rates (สตางค์/ชั่วโมง) — ตรง mockup: เมธ ฿450 · ปอนด์ ฿400 · น้ำ ฿350 · ตูน ฿200 · สมชาย ฿350
INSERT OR REPLACE INTO rates (id, user_id, rate_satang_per_hour, effective_from, note, created_at) VALUES
  ('r_owner_1',  'u_owner',  45000, '2026-01-01', 'rate ตั้งต้น', 1767200000000),
  ('r_pond_1',   'u_pond',   40000, '2026-01-01', 'rate ตั้งต้น', 1767200000000),
  ('r_nam_1',    'u_nam',    35000, '2026-01-01', 'rate ตั้งต้น', 1767200000000),
  ('r_beam_1',   'u_beam',   38000, '2026-01-01', 'rate ตั้งต้น', 1767200000000),
  ('r_korn_1',   'u_korn',   42000, '2026-01-01', 'rate ตั้งต้น', 1767200000000),
  ('r_jay_1',    'u_jay',    36000, '2026-01-01', 'rate ตั้งต้น', 1767200000000),
  ('r_fah_1',    'u_fah',    32000, '2026-01-01', 'rate ตั้งต้น', 1767200000000),
  ('r_praew_1',  'u_praew',  30000, '2026-01-01', 'rate ตั้งต้น', 1767200000000),
  ('r_toon_1',   'u_toon',   20000, '2026-01-01', 'rate ตั้งต้น', 1767200000000),
  ('r_mint_1',   'u_mint',   34000, '2026-01-01', 'rate ตั้งต้น', 1767200000000),
  ('r_somchai_1','u_somchai',35000, '2026-01-01', 'vendor rate',  1767200000000);

-- ============================================================
-- MOCK เพิ่มเติม — ให้หน้า "ภาพรวม" แสดงเต็ม (วันนี้ = 2026-06-29)
-- ============================================================

-- งานใหม่ assign ให้ owner (เมธ) due อนาคต → กล่อง "งานเร็วๆ นี้"
INSERT OR REPLACE INTO tasks (id, project_id, group_id, sort_order, title, description, assignee_id, status, priority, estimate_minutes, start_date, due_date, created_by, created_at, completed_at) VALUES
  ('t_ov_uat',   'p_sap',  'g_sap_uat', 1,'เตรียม UAT checklist',     NULL,'u_owner','non_start','normal',NULL,'2026-06-25','2026-07-02','u_owner',1767200000000,NULL),
  ('t_ov_bloom', 'p_bloom','g_bloom_fe',1,'รีวิว checkout กับลูกค้า', NULL,'u_owner','non_start','high',  NULL,'2026-06-26','2026-07-04','u_owner',1767200000000,NULL),
  ('t_ov_golive','p_sap',  'g_sap_live',1,'วางแผน go-live',           NULL,'u_owner','non_start','normal',NULL,'2026-06-28','2026-07-09','u_owner',1767200000000,NULL);

-- ดาว "ทำวันนี้" (for_date = วันนี้) ของหลายคน → งานวันนี้ + standup grid ในกล่องทีม
INSERT OR REPLACE INTO task_stars (id, user_id, task_id, for_date) VALUES
  ('st_o1','u_owner','t_sap_product','2026-06-29'),
  ('st_o2','u_owner','t_sap_uat1',   '2026-06-29'),
  ('st_o3','u_owner','t_ov_bloom',   '2026-06-29'),
  ('st_o4','u_owner','t_ov_uat',     '2026-06-29'),
  ('st_p1','u_pond', 't_sap_pay',    '2026-06-29'),
  ('st_p2','u_pond', 't_bloom_checkout','2026-06-29'),
  ('st_k1','u_korn', 't_bloom_api',  '2026-06-29'),
  ('st_n1','u_nam',  't_sap_about',  '2026-06-29'),
  ('st_b1','u_beam', 't_sap_stg2',   '2026-06-29');

-- time entries วันนี้ + เมื่อวาน → ชั่วโมง/timer + กล่องทีม (rate = สตางค์/ชม.)
INSERT OR REPLACE INTO time_entries (id, user_id, task_id, project_id, work_date, minutes, note, rate_snapshot_satang, source, created_at) VALUES
  ('te_o_t1','u_owner','t_sap_product',   'p_sap',  '2026-06-29',120,NULL,45000,'manual',1767200000000),
  ('te_o_t2','u_owner','t_sap_uat1',      'p_sap',  '2026-06-29', 45,NULL,45000,'timer', 1767200000000),
  ('te_p_t1','u_pond', 't_sap_pay',       'p_sap',  '2026-06-29',180,NULL,40000,'manual',1767200000000),
  ('te_p_t2','u_pond', 't_bloom_checkout','p_bloom','2026-06-29', 90,NULL,40000,'timer', 1767200000000),
  ('te_k_t1','u_korn', 't_bloom_api',     'p_bloom','2026-06-29',150,NULL,42000,'manual',1767200000000),
  ('te_n_t1','u_nam',  't_sap_about',     'p_sap',  '2026-06-29', 60,NULL,35000,'timer', 1767200000000),
  ('te_b_t1','u_beam', 't_sap_stg2',      'p_sap',  '2026-06-29', 75,NULL,38000,'manual',1767200000000),
  ('te_o_y1','u_owner','t_sap_product',   'p_sap',  '2026-06-28',240,NULL,45000,'manual',1767200000000),
  ('te_p_y1','u_pond', 't_bloom_checkout','p_bloom','2026-06-28',300,NULL,40000,'manual',1767200000000),
  ('te_k_y1','u_korn', 't_bloom_api',     'p_bloom','2026-06-28',180,NULL,42000,'manual',1767200000000),
  ('te_n_y1','u_nam',  't_sap_about',     'p_sap',  '2026-06-28',120,NULL,35000,'manual',1767200000000);

-- calendar events รอบวันนี้ → ปฏิทินทีม + วันลา (ฟ้า ลาวันนี้)
INSERT OR REPLACE INTO calendar_events (id, title, start_date, end_date, type, user_id, project_id, source, gcal_id, created_by, created_at) VALUES
  ('ce_meet1','ประชุมทีม weekly 10:00','2026-06-29',NULL,        'meeting', NULL,   NULL,    'local',NULL,'u_owner',1767200000000),
  ('ce_dead1','ส่งงาน checkout Bloom', '2026-06-30',NULL,        'deadline',NULL,   'p_bloom','local',NULL,'u_owner',1767200000000),
  ('ce_meet2','นัดลูกค้า ทรัพย์เจริญ 14:00','2026-07-01',NULL,   'meeting', NULL,   'p_sap', 'local',NULL,'u_owner',1767200000000),
  ('ce_uat',  'UAT ทรัพย์เจริญ',       '2026-07-02','2026-07-03','deadline',NULL,   'p_sap', 'local',NULL,'u_owner',1767200000000),
  ('ce_leave','ลาพักร้อน',             '2026-06-29',NULL,        'leave',   'u_fah',NULL,    'local',NULL,'u_owner',1767200000000),
  ('ce_holiday','วันหยุดบริษัท',       '2026-07-06',NULL,        'holiday', NULL,   NULL,    'local',NULL,'u_owner',1767200000000);

-- ============================================================
-- Pronista §F1 — ชุดสถานะ 2 แบบ (Product=รูป1 · Project=รูป3) + category/tags/sprint ตัวอย่าง
-- ============================================================
UPDATE company_config SET
  product_statuses='[{"id":"project_brief","name":"Project Brief","color":"yellow","kind":"active","sortOrder":0},{"id":"present","name":"Present","color":"rose","kind":"active","sortOrder":1},{"id":"quotation","name":"Quotation","color":"orange","kind":"active","sortOrder":2},{"id":"negotiation","name":"Negotiation","color":"violet","kind":"active","sortOrder":3},{"id":"in_progress","name":"In Progress","color":"sky","kind":"active","sortOrder":4},{"id":"waiting_approve","name":"Waiting for Approve","color":"teal","kind":"active","sortOrder":5},{"id":"done","name":"Done","color":"emerald","kind":"active","sortOrder":6},{"id":"canceled","name":"Canceled","color":"rose","kind":"archived","sortOrder":7},{"id":"sign_contract","name":"Sign Contract","color":"violet","kind":"active","sortOrder":8},{"id":"introduction","name":"Introduction","color":"sky","kind":"active","sortOrder":9}]',
  project_statuses='[{"id":"introduction","name":"Introduction","color":"sky","kind":"active","sortOrder":0},{"id":"project_brief","name":"Project Brief","color":"slate","kind":"active","sortOrder":1},{"id":"present","name":"Present","color":"rose","kind":"active","sortOrder":2},{"id":"quotation","name":"Quotation","color":"yellow","kind":"active","sortOrder":3},{"id":"negotiation","name":"Negotiation","color":"orange","kind":"active","sortOrder":4},{"id":"in_progress","name":"In Progress","color":"sky","kind":"active","sortOrder":5},{"id":"waiting_approve","name":"Waiting for Approve","color":"teal","kind":"active","sortOrder":6},{"id":"done","name":"Done","color":"emerald","kind":"active","sortOrder":7},{"id":"canceled","name":"Canceled","color":"rose","kind":"archived","sortOrder":8},{"id":"sign_contract","name":"Sign Contract","color":"violet","kind":"active","sortOrder":9},{"id":"ma","name":"MA","color":"amber","kind":"active","sortOrder":10},{"id":"subscribed","name":"Subscribed","color":"emerald","kind":"active","sortOrder":11}]'
WHERE id=1;

-- remap สถานะเดิม → id ในชุดใหม่ + กำหนด category ตัวอย่าง (Product 2 ตัว · ที่เหลือ Project)
UPDATE projects SET category='project', status='in_progress' WHERE id IN ('p_sap','p_bloom','p_dent');
UPDATE projects SET category='product', status='in_progress' WHERE id='p_skill';
UPDATE projects SET category='product', status='done' WHERE id='p_bright';
UPDATE projects SET category='project', status='ma' WHERE id IN ('p_campus','p_baansuan','p_glow','p_somwang','p_daoden','p_fitzone');
UPDATE projects SET category='project', status='canceled' WHERE id IN ('p_thairung','p_songkran');
-- tag (เฉพาะ Project) + sprint ตัวอย่าง
UPDATE projects SET tags='["Website Development","Brandnista"]', sprint='Sprint 12' WHERE id='p_sap';
UPDATE projects SET tags='["E-Commerce","Sellnista"]', sprint='Sprint 12' WHERE id='p_bloom';
-- สมาชิกตัวอย่างใน p_sap
INSERT OR REPLACE INTO project_members (id, project_id, user_id) VALUES
  ('pm_sap_owner','p_sap','u_owner'),('pm_sap_beam','p_sap','u_beam'),('pm_sap_korn','p_sap','u_korn'),
  ('pm_bloom_pond','p_bloom','u_pond'),('pm_bloom_korn','p_bloom','u_korn');

-- Pronista §F2 — Backlog ตัวอย่าง (task ลอย: project_id/group_id = null)
INSERT OR REPLACE INTO tasks (id, project_id, group_id, sort_order, title, description, assignee_id, status, priority, estimate_minutes, start_date, due_date, created_by, created_at, completed_at) VALUES
  ('t_bl_landing',NULL,NULL,0,'ทำ landing page โปรโมชั่นกลางปี',NULL,NULL,'non_start','high',  NULL,NULL,NULL,'u_owner',1767200000000,NULL),
  ('t_bl_pos',    NULL,NULL,0,'วิจัยคู่แข่งระบบ POS',          NULL,NULL,'non_start','normal',NULL,NULL,NULL,'u_owner',1767200000000,NULL),
  ('t_bl_req',    NULL,NULL,0,'รวบรวม requirement ลูกค้ารายใหม่',NULL,NULL,'non_start','normal',NULL,NULL,NULL,'u_owner',1767200000000,NULL);
