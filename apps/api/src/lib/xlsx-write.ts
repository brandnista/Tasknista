import { strToU8, zipSync } from 'fflate'

/**
 * Pronista §Import Data — สร้างไฟล์ .xlsx Template ให้โหลดจากระบบ (คู่กับ xlsx-parse.ts ที่อ่านไฟล์กลับ)
 * เขียน XML ตรงๆ แล้ว zip เอง (fflate ตัวเดียวกับที่ระบบใช้อ่าน .docx อยู่แล้ว ไม่ต้องลงไลบรารีใหม่) — verify แล้วว่า Excel เปิดได้จริง
 */

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function colLetter(i: number): string {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

interface Cell {
  v: string | number
  s: number
  t?: 'n'
}
const cell = (v: string | number, s: number, t?: 'n'): Cell => ({ v, s, t })

function cellXml(ref: string, c: Cell | null): string {
  if (c == null || c.v === '' || c.v == null) return `<c r="${ref}"${c?.s ? ` s="${c.s}"` : ''}/>`
  const st = c.s ? ` s="${c.s}"` : ''
  if (c.t === 'n') return `<c r="${ref}"${st}><v>${c.v}</v></c>`
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(String(c.v))}</t></is></c>`
}

function sheetXml(opts: {
  rows: (Cell | null)[][]
  cols?: number[]
  freeze?: boolean
  autoFilterRef?: string
  validations?: { sqref: string; list: string }[]
}): string {
  const body = opts.rows
    .map((row, r) => {
      const cells = row.map((c, i) => (c == null ? '' : cellXml(`${colLetter(i)}${r + 1}`, c))).join('')
      return `<row r="${r + 1}"${r === 0 ? ' ht="26" customHeight="1"' : ''}>${cells}</row>`
    })
    .join('')
  const colsXml = opts.cols
    ? `<cols>${opts.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : ''
  const view = opts.freeze
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
  const af = opts.autoFilterRef ? `<autoFilter ref="${opts.autoFilterRef}"/>` : ''
  const dv =
    opts.validations && opts.validations.length
      ? `<dataValidations count="${opts.validations.length}">${opts.validations
          .map((v) => `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${v.sqref}"><formula1>"${v.list}"</formula1></dataValidation>`)
          .join('')}</dataValidations>`
      : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}<sheetFormatPr defaultRowHeight="15"/>${colsXml}<sheetData>${body}</sheetData>${af}${dv}</worksheet>`
}

const FONT = 'Tahoma'
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5">
<font><sz val="10"/><name val="${FONT}"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="${FONT}"/></font>
<font><b/><sz val="13"/><color rgb="FF0F172A"/><name val="${FONT}"/></font>
<font><sz val="10"/><color rgb="FF64748B"/><name val="${FONT}"/></font>
<font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="${FONT}"/></font>
</fonts>
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE11D48"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
</styleSheet>`

const S = { HEAD: 1, HEAD_REQ: 2, CELL: 3, TITLE: 4, MUTED: 5, SUBHEAD: 6, CELL_HI: 7, CELL_DATE: 8 } as const

export interface ImportTemplateMember {
  name: string
  email: string
  roleLabel: string
}

/** สร้าง .xlsx Template 3 ชีต (งาน/ตัวเลือก/วิธีใช้) — members มาจากสมาชิกจริงของบริษัท ณ ตอนกดโหลด ไม่ hardcode */
export function buildImportTemplateXlsx(members: ImportTemplateMember[]): Uint8Array {
  const headers: [string, boolean][] = [
    ['ประเภท *', true],
    ['รหัสอ้างอิง', false],
    ['อยู่ใต้รหัส', false],
    ['ชื่องาน *', true],
    ['รายละเอียด', false],
    ['ผู้รับผิดชอบ (อีเมล)', false],
    ['สถานะ', false],
    ['ความสำคัญ', false],
    ['ประเมิน (ชม.)', false],
    ['วันเริ่ม', false],
    ['กำหนดส่ง', false],
    ['ผู้แจ้ง (เฉพาะ Defect)', false],
  ]
  const examples: (string | number)[][] = [
    ['Task', 'SOW-001', '', 'ทำระบบสมัครสมาชิก', 'รองรับสมัครด้วยอีเมลและ Google', members[0]?.email ?? '', 'On Processing', 'สูง', 16, '2026-08-10', '2026-08-30', ''],
    ['Task', 'SOW-001-1', 'SOW-001', 'ออกแบบหน้าจอสมัครสมาชิก', 'ทำ UI ตาม UIR v1.2', members[1]?.email ?? '', 'Done', 'ปกติ', 6, '2026-08-10', '2026-08-18', ''],
    ['Defect', 'BUG-014', '', 'กดปุ่มบันทึกแล้วเด้งออกจากหน้า', 'เกิดเฉพาะบน Safari มือถือ', members[0]?.email ?? '', 'กำลังแก้', 'สูง', 3, '', '2026-08-12', 'ลูกค้า'],
    ['CR', 'CR-003', '', 'ขอเพิ่มช่องเบอร์โทรในหน้าสมัคร', 'ลูกค้าขอเพิ่มหลังรีวิว UAT', '', '', 'ปกติ', '', '', '2026-09-05', ''],
    ['งานทั่วไป', '', '', 'จัดประชุม Kickoff กับลูกค้า', '', members[0]?.email ?? '', '', 'ปกติ', 2, '', '2026-08-08', ''],
  ]
  const taskRows: (Cell | null)[][] = [
    headers.map(([h, req]) => cell(h, req ? S.HEAD_REQ : S.HEAD)),
    ...examples.map((row) => row.map((v, i) => (typeof v === 'number' ? cell(v, S.CELL, 'n') : cell(v, i === 0 ? S.CELL_HI : i === 9 || i === 10 ? S.CELL_DATE : S.CELL)))),
  ]
  const sheet1 = sheetXml({
    rows: taskRows,
    cols: [13, 14, 14, 34, 38, 30, 19, 12, 13, 12, 12, 18],
    freeze: true,
    autoFilterRef: `A1:L${taskRows.length}`,
    validations: [
      { sqref: 'A2:A500', list: 'Task,Defect,CR,งานทั่วไป' },
      { sqref: 'G2:G500', list: 'Non Start,On Processing,Waiting for Review,Done,รอเริ่ม,กำลังแก้,รอ Verify,ปิด' },
      { sqref: 'H2:H500', list: 'ต่ำ,ปกติ,สูง' },
      { sqref: 'L2:L500', list: 'ลูกค้า,ทีมเอง' },
    ],
  })

  const optRows: (Cell | null)[][] = [
    [cell('ค่าที่ใส่ได้ในแต่ละคอลัมน์', S.TITLE)],
    [cell('ระบบเติมรายชื่อจริงของบริษัทให้อัตโนมัติตอนกด "โหลด Template" — ก็อปอีเมลจากตารางนี้ไปวางได้เลย', S.MUTED)],
    [],
    [cell('ผู้รับผิดชอบ — คอลัมน์ F', S.SUBHEAD), cell('', S.SUBHEAD), cell('', S.SUBHEAD)],
    [cell('ชื่อ', S.HEAD), cell('อีเมล (ใช้ค่านี้)', S.HEAD), cell('สิทธิ์ระบบ', S.HEAD)],
    ...members.map((m) => [cell(m.name, S.CELL), cell(m.email, S.CELL), cell(m.roleLabel, S.CELL)]),
    [],
    [cell('ประเภท — คอลัมน์ A', S.SUBHEAD), cell('', S.SUBHEAD), cell('', S.SUBHEAD)],
    [cell('ค่าที่ใส่', S.HEAD), cell('งานจะไปโผล่ที่แท็บ', S.HEAD), cell('', S.HEAD)],
    [cell('Task', S.CELL), cell('แท็บ Task ใน Backlog', S.CELL), cell('', S.CELL)],
    [cell('Defect', S.CELL), cell('แท็บ Defect', S.CELL), cell('', S.CELL)],
    [cell('CR', S.CELL), cell('แท็บ CR', S.CELL), cell('', S.CELL)],
    [cell('งานทั่วไป', S.CELL), cell('แท็บ ทั่วไป', S.CELL), cell('', S.CELL)],
    [],
    [cell('สถานะ — คอลัมน์ G', S.SUBHEAD), cell('', S.SUBHEAD), cell('', S.SUBHEAD)],
    [cell('ใช้กับประเภท', S.HEAD), cell('ค่าที่ใส่ได้', S.HEAD), cell('เว้นว่าง =', S.HEAD)],
    [cell('Task / CR / งานทั่วไป', S.CELL), cell('Non Start, On Processing, Waiting for Review, Done', S.CELL), cell('Non Start', S.CELL)],
    [cell('Defect', S.CELL), cell('รอเริ่ม, กำลังแก้, รอ Verify, ปิด', S.CELL), cell('รอเริ่ม', S.CELL)],
    [],
    [cell('ความสำคัญ — คอลัมน์ H', S.SUBHEAD), cell('', S.SUBHEAD), cell('', S.SUBHEAD)],
    [cell('ต่ำ / ปกติ / สูง', S.CELL), cell('เว้นว่าง = ปกติ', S.CELL), cell('', S.CELL)],
    [],
    [cell('ผู้แจ้ง — คอลัมน์ L', S.SUBHEAD), cell('', S.SUBHEAD), cell('', S.SUBHEAD)],
    [cell('ลูกค้า / ทีมเอง', S.CELL), cell('ใช้เฉพาะแถวที่ประเภท = Defect', S.CELL), cell('', S.CELL)],
  ]
  const sheet2 = sheetXml({ rows: optRows, cols: [30, 48, 20] })

  const howto: [string, string][] = [
    ['1. กรอกงานลงในชีต "งาน"', '1 แถว = 1 งาน · ลบแถวตัวอย่างออกก่อนใช้จริงได้เลย'],
    ['2. คอลัมน์ที่มี * คือบังคับ', 'ประเภท และ ชื่องาน ต้องมีทุกแถว ที่เหลือเว้นว่างได้'],
    ['3. ประเภท เป็นตัวกำหนดแท็บ', 'ใส่ Task / Defect / CR / งานทั่วไป — งานจะไปโผล่แท็บนั้นในหน้าโปรเจกต์'],
    ['4. อยากทำงานย่อย', 'ใส่ "รหัสอ้างอิง" ให้แถวแม่ก่อน แล้วแถวลูกใส่รหัสนั้นในช่อง "อยู่ใต้รหัส" · ลึกได้ 1 ชั้น · ใช้ได้เฉพาะแถวที่ประเภท = Task'],
    ['5. ผู้รับผิดชอบใส่เป็นอีเมล', 'ก็อปจากชีต "ตัวเลือก" — ใช้อีเมลเพราะชื่อคนซ้ำกันได้'],
    ['6. วันที่ใช้รูปแบบ ปี-เดือน-วัน', 'เช่น 2026-08-30 · คอลัมน์นี้ตั้งฟอร์แมตเป็น Text ไว้แล้ว กันไม่ให้ Excel แปลงเป็นเลขวันที่เอง'],
    ['7. ประเมินใส่เป็นชั่วโมง', 'ใส่ตัวเลขได้เลย เช่น 7.5 หมายถึง 7 ชั่วโมงครึ่ง'],
    ['8. บีบเป็น ZIP พร้อมเอกสาร', 'วางไฟล์นี้ไว้นอกสุด แล้วสร้างโฟลเดอร์ documents/ ใส่เอกสาร โดยตั้งชื่อโฟลเดอร์ย่อยตามประเภท (MOM, UIR, SOW, BRD, SRS, PEP, CR, API)'],
    ['9. ถ้าไม่มีเอกสารแนบ', 'อัปไฟล์ .xlsx นี้ตรงๆ ได้เลย ไม่ต้องบีบ ZIP'],
    ['10. อัปแล้วยังไม่เข้าระบบทันที', 'ระบบจะให้ดูหน้าพรีวิวก่อนว่าจะสร้างอะไรบ้าง ตรวจแล้วค่อยกดยืนยัน ถ้าผิดปิดทิ้งได้ ไม่มีอะไรค้าง'],
  ]
  const howtoRows: (Cell | null)[][] = [
    [cell('วิธีใช้ไฟล์นี้', S.TITLE)],
    [cell('Pronista — Import Data Template', S.MUTED)],
    [],
    [cell('ขั้นตอน', S.HEAD), cell('รายละเอียด', S.HEAD)],
    ...howto.map(([a, b]) => [cell(a, S.CELL), cell(b, S.CELL)]),
    [],
    [cell('ข้อจำกัดต่อการอัป 1 ครั้ง', S.SUBHEAD), cell('', S.SUBHEAD)],
    [cell('ขนาดไฟล์ ZIP', S.CELL), cell('ไม่เกิน 30 MB', S.CELL)],
    [cell('จำนวนแถว', S.CELL), cell('ไม่เกิน 500 แถว', S.CELL)],
    [cell('จำนวนเอกสาร', S.CELL), cell('ไม่เกิน 50 ไฟล์', S.CELL)],
  ]
  const sheet3 = sheetXml({ rows: howtoRows, cols: [34, 76] })

  const sheets = [
    { name: 'งาน', xml: sheet1 },
    { name: 'ตัวเลือก', xml: sheet2 },
    { name: 'วิธีใช้', xml: sheet3 },
  ]

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map((sh, i) => `<sheet name="${esc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets></workbook>`
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/styles.xml': strToU8(STYLES_XML),
  }
  sheets.forEach((sh, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sh.xml)
  })
  return zipSync(files, { level: 6 })
}
