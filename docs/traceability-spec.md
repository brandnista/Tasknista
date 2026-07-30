# Handoff Brief v2: BNT Document Traceability Feature (5 เอกสาร)
สำหรับส่งต่อให้ Claude Code เพื่อพัฒนาเป็นฟีเจอร์ในระบบจริง — อัปเดตจากฉบับแรกที่มี 4 เล่ม (MOM/BRD/SOW/SRS) เพิ่มเล่มที่ 5 คือ **Project Execution Proposal (PROP)**

ไฟล์นี้ใช้แทนไฟล์เดิม (`Claude_Code_Handoff_Brief.md`) ได้เลย — ข้อมูลตัวอย่างในไฟล์นี้เป็นรหัส/เนื้อหาจริงจากเอกสารชุดล่าสุด (v1.1) ไม่ใช่ตัวอย่างสมมติแบบไฟล์แรก

---

## 1. เป้าหมายของฟีเจอร์ (บอก Claude Code ตรงนี้)

ระบบเอกสารพัฒนาโครงการของ Brandnista ไหลเป็น 5 เล่ม: **MOM → BRD → SOW → SRS** ตามลำดับเชิงเนื้อหา บวกกับ **Proposal (PROP)** ซึ่งเป็นเล่มสรุปเชิงพาณิชย์ (เงิน/เวลา/คน) ที่ดึงข้อมูลย้อนกลับจากทั้ง 4 เล่มมารวมไว้ในที่เดียว แต่ละเล่มมี "รายการ" ย่อยที่มีรหัส (ID) เฉพาะ และรายการในเล่มถัดไปจะ "อ้างอิงกลับ" (reference) ไปยังรหัสในเล่มก่อนหน้าเสมอ ต้องการฟีเจอร์ที่:

1. เก็บรายการเอกสารแต่ละเล่มพร้อมรหัสและความสัมพันธ์แบบอ้างอิงได้ (ไม่ผูกกับ Word/Text — เป็นข้อมูลโครงสร้าง)
2. ตรวจสอบได้ว่ารหัสที่อ้างอิงมีอยู่จริง (กัน Broken Reference เวลาแก้ไขภายหลัง)
3. แสดงห่วงโซ่ความสัมพันธ์ (Traceability Chain) ของ 1 ฟีเจอร์ได้ตั้งแต่ต้นจนจบ — จาก MOM ตัวเดียว ไล่ไปจนถึง SRS และ PROP ทุกข้อที่เกี่ยวข้อง
4. รองรับเล่มที่อ้างอิง "ข้ามมากกว่า 1 เล่มพร้อมกัน" อย่าง PROP (ดูข้อ 2.1)
5. (ถ้าเป็นไปได้) ช่วย generate ตัวเอกสาร Word จากข้อมูลโครงสร้างนี้ได้ในอนาคต

---

## 2. โมเดลข้อมูล (Entity Overview)

```
Document (1 เล่ม)
 └─ DocumentItem (1 รายการในเล่ม เช่น 1 BR, 1 SOW item, 1 FR, 1 Budget line)
      └─ references: DocumentItem[] (อ้างอิงไปยังรายการในเล่มก่อนหน้า)
```

**ลำดับเล่ม (Document Type Flow):** `MOM(1) → BRD(2) → SOW(3) → SRS(4) → PROP(5)`

กฎหลัก: `references` ของรายการในเล่ม N ชี้ไปยังรายการในเล่ม N-1 เท่านั้น (ห้ามข้ามเล่ม หรือชี้ย้อนไปเล่มเดียวกัน)

### 2.1 ข้อยกเว้นสำหรับ PROP

PROP เป็นเล่ม "สรุปข้ามเล่ม" ไม่ใช่เล่มที่ขยายความจาก SRS ตรง ๆ เหมือนที่ SRS ขยายจาก SOW ดังนั้น:
- ที่ระดับ **เอกสาร (Document)** — PROP อ้างอิง `documentId` ของทั้ง 4 เล่มพร้อมกันได้ ผ่านฟิลด์ `referencedDocuments`
- ที่ระดับ **รายการ (DocumentItem)** — รายการใน PROP (เช่น บรรทัดงบประมาณ, งวดชำระเงิน) อ้างอิงกลับไปที่รายการใน **SOW เท่านั้น** เพราะ SOW เป็นเล่มที่มี Effort Tier / ขอบเขตงานที่ใช้คำนวณสัดส่วนงบประมาณโดยตรง — นี่คือข้อยกเว้นเดียวของกฎ "N อ้างอิง N-1 เท่านั้น" ในระบบนี้

### รหัส (ID) ต่อประเภทเอกสาร

| เล่ม | รูปแบบ ID | ตัวอย่างจริง |
|---|---|---|
| MOM (มติ/ข้อสรุป) | `MOM-YYYYMMDD-D{NN}` | `MOM-20260620-D01` |
| MOM (Action Item) | `MOM-YYYYMMDD-A{NN}` | `MOM-20260620-A01` |
| BRD (Business Objective) | `BO-{NN}` | `BO-02` |
| BRD (Business Requirement) | `BR-{Module}{NN}` | `BR-F03` |
| SOW (Scope Item) | `{ProjectCode}-SOW-{NNN}` | `MAK001-SOW-001` |
| SRS (Functional Requirement) | `{ModulePrefix}-{NN}` | `MKD-MAP-01` |
| PROP (Budget Line Item) | `PROP-BUDGET-{NN}` | `PROP-BUDGET-01` |
| PROP (Payment Milestone) | `PROP-MILESTONE-{NN}` | `PROP-MILESTONE-01` |

รหัสโครงการ (`ProjectCode` เช่น `MAK001`) กำหนดครั้งเดียวตอนเปิดโครงการ ใช้เป็น prefix ร่วมของทุกเล่มในโครงการนั้น รหัสเอกสาร (`documentId`) ใช้รูปแบบ `BNT-{DocType}-{Year}-{NNN}` เช่น `BNT-PROP-2026-001`

---

## 3. JSON Schema (ให้ Claude Code ใช้เป็นฐานออกแบบ DB/Type)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "BNTDocumentTraceability",
  "definitions": {
    "DocumentType": {
      "type": "string",
      "enum": ["MOM", "BRD", "SOW", "SRS", "PROP"]
    },
    "DocumentItem": {
      "type": "object",
      "required": ["id", "docType", "documentId", "title"],
      "properties": {
        "id": { "type": "string", "description": "รหัสอ้างอิงเฉพาะ เช่น BR-F03, MAK001-SOW-001, PROP-BUDGET-01" },
        "docType": { "$ref": "#/definitions/DocumentType" },
        "documentId": { "type": "string", "description": "รหัสเอกสารเล่มที่รายการนี้สังกัด เช่น BNT-BRD-2026-007" },
        "projectCode": { "type": "string", "description": "เช่น MAK001" },
        "title": { "type": "string" },
        "description": { "type": "string" },
        "category": { "type": "string", "description": "เช่น User-Facing Feature / Technical-API / Technical-Database / Technical-QA" },
        "priority": { "type": "string", "enum": ["P0", "P1", "P2", "Must Have", "Should Have", "Could Have"] },
        "effortTier": { "type": "string", "enum": ["S", "M", "L"] },
        "budgetSharePercent": { "type": "number", "description": "เฉพาะ PROP-BUDGET-* : สัดส่วน % ของงบประมาณโดยประมาณ" },
        "paymentPercent": { "type": "number", "description": "เฉพาะ PROP-MILESTONE-* : สัดส่วน % ของยอดชำระในงวดนั้น" },
        "references": {
          "type": "array",
          "items": { "type": "string" },
          "description": "รายการ id ของ DocumentItem ในเล่มก่อนหน้าที่รายการนี้อ้างอิงถึง (สำหรับ PROP จะชี้ไปที่ SOW เสมอ ตามข้อ 2.1)"
        }
      }
    },
    "Document": {
      "type": "object",
      "required": ["documentId", "docType", "projectCode", "title", "items"],
      "properties": {
        "documentId": { "type": "string" },
        "docType": { "$ref": "#/definitions/DocumentType" },
        "projectCode": { "type": "string" },
        "title": { "type": "string" },
        "version": { "type": "string" },
        "referencedDocuments": {
          "type": "array",
          "items": { "type": "string" },
          "description": "เฉพาะเล่มที่อ้างอิงมากกว่า 1 เล่ม เช่น PROP จะมีค่าเป็น documentId ของ MOM/BRD/SOW/SRS ทั้งหมด"
        },
        "items": {
          "type": "array",
          "items": { "$ref": "#/definitions/DocumentItem" }
        }
      }
    }
  },
  "type": "array",
  "items": { "$ref": "#/definitions/Document" }
}
```

**Validation rule ที่ควรมีในฟีเจอร์:**
1. ทุกค่าใน `references` ของ MOM/BRD/SOW/SRS ต้องตรงกับ `id` ของ `DocumentItem` ที่มีอยู่จริง และ `docType` ของรายการที่ถูกอ้างอิงต้องเป็นเล่มก่อนหน้าตามลำดับ `MOM → BRD → SOW → SRS` เท่านั้น
2. รายการของ `docType = PROP` ให้ `references` ชี้ไปที่รายการใน SOW เท่านั้น (ข้อยกเว้นตามข้อ 2.1)
3. ถ้า `docType = PROP` ค่า `referencedDocuments` ที่ระดับ Document ควรครบทั้ง 4 `documentId` ของ MOM/BRD/SOW/SRS ที่โครงการนั้นใช้จริง — เตือนถ้าขาด
4. (Optional) ผลรวม `budgetSharePercent` ของรายการ `PROP-BUDGET-*` ทั้งหมดในเอกสารเดียวกัน ควรเท่ากับ 100 — เตือนถ้าไม่เท่า

---

## 4. ตัวอย่างข้อมูลจริง (จากโครงการ MAK001 — ครบ 5 เล่ม ใช้เทสต์ฟีเจอร์ได้เลย)

```json
[
  {
    "documentId": "BNT-MOM-2026-014",
    "docType": "MOM",
    "projectCode": "MAK001",
    "title": "ประชุมเก็บ Requirement เพิ่มเติม - Food Ordering & Dine-in",
    "version": "1.0",
    "items": [
      { "id": "MOM-20260620-D01", "docType": "MOM", "documentId": "BNT-MOM-2026-014", "projectCode": "MAK001", "title": "เปลี่ยนมาให้ผู้ใช้เลือกตำแหน่งจัดส่งผ่านแผนที่ (Map Pin) แทนการพิมพ์", "references": [] },
      { "id": "MOM-20260620-D02", "docType": "MOM", "documentId": "BNT-MOM-2026-014", "projectCode": "MAK001", "title": "ให้ประเมินแก้ไข/ปรับ config Places API ให้รองรับภาษาไทยก่อนเริ่ม UI", "references": [] },
      { "id": "MOM-20260620-D03", "docType": "MOM", "documentId": "BNT-MOM-2026-014", "projectCode": "MAK001", "title": "ตกลงให้เพิ่มฟีเจอร์บันทึกที่อยู่ (Saved Address)", "references": [] }
    ]
  },
  {
    "documentId": "BNT-BRD-2026-007",
    "docType": "BRD",
    "projectCode": "MAK001",
    "title": "BRD - Address Search on Map (Food Ordering & Dine-in)",
    "version": "1.1",
    "items": [
      { "id": "BO-01", "docType": "BRD", "documentId": "BNT-BRD-2026-007", "projectCode": "MAK001", "title": "เพิ่มความแม่นยำของการค้นหาสถานที่ภาษาไทย", "references": ["MOM-20260620-D02"] },
      { "id": "BO-02", "docType": "BRD", "documentId": "BNT-BRD-2026-007", "projectCode": "MAK001", "title": "ลดอัตรา Order ที่จัดส่งผิดที่อยู่", "references": ["MOM-20260620-D01"] },
      { "id": "BO-03", "docType": "BRD", "documentId": "BNT-BRD-2026-007", "projectCode": "MAK001", "title": "ลดเวลาที่ลูกค้าใช้ค้นหาตำแหน่งสาขาสำหรับโหมด Dine-in", "references": [] },
      { "id": "BR-F01", "docType": "BRD", "documentId": "BNT-BRD-2026-007", "projectCode": "MAK001", "title": "ค้นหาชื่อสถานที่/ที่อยู่ภาษาไทยได้แม่นยำผ่าน Places API ที่ปรับปรุงแล้ว", "priority": "Must Have", "references": ["BO-01", "MOM-20260620-D02"] },
      { "id": "BR-F03", "docType": "BRD", "documentId": "BNT-BRD-2026-007", "projectCode": "MAK001", "title": "ให้ผู้ใช้เลือกตำแหน่งจัดส่งผ่านแผนที่ พร้อมค้นหาชื่อสถานที่/ที่อยู่ได้", "priority": "Must Have", "references": ["BO-02", "MOM-20260620-D01"] },
      { "id": "BR-F04", "docType": "BRD", "documentId": "BNT-BRD-2026-007", "projectCode": "MAK001", "title": "ให้ผู้ใช้บันทึกที่อยู่จัดส่งที่ใช้บ่อยไว้เลือกใช้ซ้ำได้", "priority": "Should Have", "references": ["BO-02", "MOM-20260620-D03"] },
      { "id": "BR-F05", "docType": "BRD", "documentId": "BNT-BRD-2026-007", "projectCode": "MAK001", "title": "ให้ผู้ใช้ค้นหาตำแหน่งสาขาร้านใกล้เคียงสำหรับโหมด Dine-in ผ่านแผนที่ชุดเดียวกัน", "priority": "Should Have", "references": ["BO-03"] }
    ]
  },
  {
    "documentId": "BNT-SOW-2026-003",
    "docType": "SOW",
    "projectCode": "MAK001",
    "title": "SOW - Address Search on Map (Food Ordering & Dine-in)",
    "version": "1.1",
    "items": [
      { "id": "MAK001-SOW-001", "docType": "SOW", "documentId": "BNT-SOW-2026-003", "projectCode": "MAK001", "title": "Address Search Module", "category": "User-Facing Feature", "effortTier": "M", "references": ["BR-F01", "BR-F05"] },
      { "id": "MAK001-SOW-002", "docType": "SOW", "documentId": "BNT-SOW-2026-003", "projectCode": "MAK001", "title": "Map Display Module", "category": "User-Facing Feature", "effortTier": "M", "references": ["BR-F03", "BR-F05"] },
      { "id": "MAK001-SOW-003", "docType": "SOW", "documentId": "BNT-SOW-2026-003", "projectCode": "MAK001", "title": "Map Provider Integration", "category": "Technical - API", "effortTier": "S", "references": ["BR-F01"] },
      { "id": "MAK001-SOW-004", "docType": "SOW", "documentId": "BNT-SOW-2026-003", "projectCode": "MAK001", "title": "Selected Address Data Module", "category": "Technical - Database", "effortTier": "S", "references": ["BR-F04"] },
      { "id": "MAK001-SOW-005", "docType": "SOW", "documentId": "BNT-SOW-2026-003", "projectCode": "MAK001", "title": "QA & Regression Testing", "category": "Technical - QA", "effortTier": "S", "references": ["BR-F03"] }
    ]
  },
  {
    "documentId": "BNT-SRS-2026-005",
    "docType": "SRS",
    "projectCode": "MAK001",
    "title": "SRS - Module: Address Search on Map",
    "version": "1.1",
    "items": [
      { "id": "MKD-MAP-01", "docType": "SRS", "documentId": "BNT-SRS-2026-005", "projectCode": "MAK001", "title": "Address Search Module", "priority": "P0", "references": ["MAK001-SOW-001"] },
      { "id": "MKD-MAP-02", "docType": "SRS", "documentId": "BNT-SRS-2026-005", "projectCode": "MAK001", "title": "Map Display Module", "priority": "P0", "references": ["MAK001-SOW-002"] },
      { "id": "MKD-MAP-03", "docType": "SRS", "documentId": "BNT-SRS-2026-005", "projectCode": "MAK001", "title": "Map Provider Integration", "priority": "P0", "references": ["MAK001-SOW-003"] },
      { "id": "MKD-MAP-04", "docType": "SRS", "documentId": "BNT-SRS-2026-005", "projectCode": "MAK001", "title": "Selected Address Data Module", "priority": "P1", "references": ["MAK001-SOW-004"] },
      { "id": "MKD-MAP-05", "docType": "SRS", "documentId": "BNT-SRS-2026-005", "projectCode": "MAK001", "title": "QA & Regression Testing", "priority": "P0", "references": ["MAK001-SOW-005"] }
    ]
  },
  {
    "documentId": "BNT-PROP-2026-001",
    "docType": "PROP",
    "projectCode": "MAK001",
    "title": "Project Execution Proposal - Address Search on Map",
    "version": "1.0",
    "referencedDocuments": ["BNT-MOM-2026-014", "BNT-BRD-2026-007", "BNT-SOW-2026-003", "BNT-SRS-2026-005"],
    "items": [
      { "id": "PROP-BUDGET-01", "docType": "PROP", "documentId": "BNT-PROP-2026-001", "projectCode": "MAK001", "title": "Address Search Module - สัดส่วนงบประมาณ", "effortTier": "M", "budgetSharePercent": 25, "references": ["MAK001-SOW-001"] },
      { "id": "PROP-BUDGET-02", "docType": "PROP", "documentId": "BNT-PROP-2026-001", "projectCode": "MAK001", "title": "Map Display Module - สัดส่วนงบประมาณ", "effortTier": "M", "budgetSharePercent": 25, "references": ["MAK001-SOW-002"] },
      { "id": "PROP-BUDGET-03", "docType": "PROP", "documentId": "BNT-PROP-2026-001", "projectCode": "MAK001", "title": "Map Provider Integration - สัดส่วนงบประมาณ", "effortTier": "S", "budgetSharePercent": 15, "references": ["MAK001-SOW-003"] },
      { "id": "PROP-BUDGET-04", "docType": "PROP", "documentId": "BNT-PROP-2026-001", "projectCode": "MAK001", "title": "Selected Address Data Module - สัดส่วนงบประมาณ", "effortTier": "S", "budgetSharePercent": 15, "references": ["MAK001-SOW-004"] },
      { "id": "PROP-BUDGET-05", "docType": "PROP", "documentId": "BNT-PROP-2026-001", "projectCode": "MAK001", "title": "QA & Regression Testing - สัดส่วนงบประมาณ", "effortTier": "S", "budgetSharePercent": 10, "references": ["MAK001-SOW-005"] },
      { "id": "PROP-MILESTONE-01", "docType": "PROP", "documentId": "BNT-PROP-2026-001", "projectCode": "MAK001", "title": "งวดที่ 1 - ลงนามอนุมัติ SOW", "paymentPercent": 40, "references": ["MAK001-SOW-001", "MAK001-SOW-002", "MAK001-SOW-003", "MAK001-SOW-004", "MAK001-SOW-005"] },
      { "id": "PROP-MILESTONE-02", "docType": "PROP", "documentId": "BNT-PROP-2026-001", "projectCode": "MAK001", "title": "งวดที่ 2 - ส่งมอบ SOW-001~004 พร้อมเข้าสู่ UAT", "paymentPercent": 30, "references": ["MAK001-SOW-001", "MAK001-SOW-002", "MAK001-SOW-003", "MAK001-SOW-004"] },
      { "id": "PROP-MILESTONE-03", "docType": "PROP", "documentId": "BNT-PROP-2026-001", "projectCode": "MAK001", "title": "งวดที่ 3 - ผ่าน QA & Regression และ Go-live", "paymentPercent": 30, "references": ["MAK001-SOW-005"] }
    ]
  }
]
```

หมายเหตุ: `PROP-BUDGET-*` ทั้ง 5 รายการรวมกันได้ 90% ส่วนอีก 10% เป็น Overhead (Project Management & BA) ที่ไม่ผูกกับ SOW item ใดโดยตรง — ถ้า Claude Code ต้องการให้ผลรวมเป็น 100% พอดี ให้เพิ่มรายการ `PROP-BUDGET-06` แบบไม่มี `references` (เพราะเป็นค่าใช้จ่ายภาพรวมของทั้งโครงการ ไม่ใช่ SOW item เดียว)

---

## 5. ไอเดียฟีเจอร์ที่ต่อยอดได้ (ให้ Claude Code เลือก/เสนอ)

- **Traceability Explorer**: หน้าจอที่เลือก 1 รายการแล้วไล่ดู chain ทั้งขึ้น (upstream) และลง (downstream) ได้ทันที ครอบคลุมถึง PROP ด้วย
- **Broken Reference Checker**: เตือนเมื่อมีการลบ/แก้ id ที่ยังถูกอ้างอิงอยู่ในเล่มถัดไป (รวมถึงเมื่อ SOW item ถูกลบทั้งที่ PROP ยังอ้างอิงอยู่)
- **Coverage Report**: เช็คว่า BR ข้อไหนใน BRD ยังไม่ถูกขยายเป็น SOW item เลย (ตกหล่น) และ SOW item ไหนยังไม่ถูกรวมไว้ใน PROP Budget Breakdown
- **Budget Roll-up Validator**: เช็คว่าผลรวม `budgetSharePercent` ของ PROP-BUDGET-* เท่ากับ 100% และผลรวม `paymentPercent` ของ PROP-MILESTONE-* เท่ากับ 100% เช่นกัน
- **Auto-stub Generator**: เมื่อสร้าง SOW item ใหม่ ระบบช่วย generate ทั้ง SRS item และ PROP-BUDGET item ที่ผูก reference ไว้ล่วงหน้าเป็นฉบับร่าง
- **Export to Word**: ใช้ข้อมูลโครงสร้างนี้ generate ไฟล์ .docx ของแต่ละเล่มตาม Template ที่มีอยู่

---

## 6. Prompt พร้อมใช้สำหรับ Claude Code

คัดลอกข้อความด้านล่าง (แก้ [ ] ให้ตรงกับ stack จริงของระบบที่กำลังทำ) แล้ววางในเซสชัน Claude Code ที่ codebase ของคุณ:

```
ฉันต้องการเพิ่มฟีเจอร์ "Document Traceability" ในระบบ [ชื่อ/สแตกของระบบ เช่น Next.js + PostgreSQL]
ให้จัดการความสัมพันธ์ระหว่างเอกสาร 5 ประเภท: MOM -> BRD -> SOW -> SRS (ไล่ตามลำดับ N-1)
และ PROP (Project Execution Proposal) ซึ่งเป็นเล่มสรุปข้ามเล่มที่อ้างอิงเอกสารทั้ง 4 ที่ระดับเอกสาร
แต่ที่ระดับรายการจะอ้างอิงกลับไปที่ SOW เท่านั้น

ฉันแนบไฟล์ Claude_Code_Handoff_Brief_v2_5Docs.md ที่มี:
- โมเดลข้อมูล (Document / DocumentItem / references / referencedDocuments) รวมข้อยกเว้นของ PROP
- JSON Schema ของโครงสร้างนี้ (DocumentType รวม PROP แล้ว)
- ตัวอย่างข้อมูลจริง 1 โครงการ (MAK001) ครบทั้ง 5 เล่ม
- ไอเดียฟีเจอร์ที่อยากต่อยอด รวมถึง Budget Roll-up Validator

ช่วย:
1. ออกแบบ Database schema / Type ที่เหมาะกับ [stack ของฉัน] จาก JSON Schema นี้
2. Import ตัวอย่างข้อมูลในข้อ 4 เป็น seed data สำหรับทดสอบ
3. ทำ validation ว่า references ต้องชี้ไปเล่มก่อนหน้าเท่านั้น (MOM->BRD->SOW->SRS) ยกเว้น PROP ที่ชี้ไป SOW โดยตรง และ id ที่อ้างต้องมีอยู่จริง
4. เริ่มจากฟีเจอร์ "Traceability Explorer" ก่อน (ดูหัวข้อ 5 ในไฟล์แนบ) — ให้เลือก 1 รายการแล้วแสดง chain ทั้ง upstream/downstream รวมถึง PROP
5. ถามฉันก่อนถ้าจะเปลี่ยนโครงสร้างข้อมูลไปจากที่แนบมา
```

**เคล็ดลับ:** วางไฟล์นี้ไว้ในโฟลเดอร์โปรเจกต์ (เช่น `docs/traceability-spec.md`) แล้วบอก Claude Code ให้อ่านไฟล์นั้นโดยตรง จะแม่นกว่าการพิมพ์อธิบายเองในแชท เพราะ Claude Code จะเห็นโครงสร้าง JSON แบบเป๊ะ ๆ ไม่ต้องตีความ
