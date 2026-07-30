import { BRD_TEMPLATE } from './brd'
import { MOM_TEMPLATE } from './mom'
import { PEP_TEMPLATE } from './pep'
import type { DocTemplateDef } from './schema'
import { SOW_TEMPLATE } from './sow'
import { SRS_TEMPLATE } from './srs'
import { UIR_TEMPLATE } from './uir'

/** จุดขยายเดียวของระบบ Template เอกสาร — เพิ่ม template ใหม่ แค่เพิ่ม entry ที่นี่ (เรียงตามลำดับสายเอกสาร MOM→BRD→SOW→SRS→PEP→UIR) */
export const DOC_TEMPLATES: Record<string, DocTemplateDef> = {
  mom: MOM_TEMPLATE,
  brd: BRD_TEMPLATE,
  sow: SOW_TEMPLATE,
  srs: SRS_TEMPLATE,
  pep: PEP_TEMPLATE,
  uir: UIR_TEMPLATE,
}

export function getDocTemplate(templateType: string): DocTemplateDef | undefined {
  return DOC_TEMPLATES[templateType]
}
