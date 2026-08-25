/**
 * Pronista §Rich text — เอดิเตอร์/ทูลบาร์ Tiptap ใช้ร่วมกัน แยกออกมาจาก DocViewer.tsx เดิม (เอกสาร)
 * เพื่อให้ My Note (และจุดอื่นในอนาคต) ใช้ทูลบาร์จัดรูปแบบชุดเดียวกันได้ — เก็บ/โหลดเนื้อหาเป็น Markdown เสมอ
 * ปุ่มแทรกรูปโชว์เฉพาะตอนมี onPickImage (ตอนนี้มีแค่ DocViewer ที่ผูก endpoint อัปโหลดรูปไว้ — My Note ยังไม่มีที่เก็บรูปของตัวเอง)
 */
import { Markdown } from '@tiptap/markdown'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold, Code, Columns3, Heading2, Heading3, Heading4,
  Image as ImageIcon, Italic, Link2, List, ListChecks, ListOrdered, Minus, Rows3,
  Strikethrough, Table, TextQuote,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useDialog } from './Dialog'

export function richTextExtensions(placeholder: string) {
  return [
    StarterKit.configure({ heading: { levels: [2, 3, 4] } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image,
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({ placeholder }),
    Markdown,
  ]
}

export function RichTextToolbar({ editor, onPickImage, rightSlot }: { editor: Editor; onPickImage?: () => void; rightSlot?: ReactNode }) {
  const { promptDialog } = useDialog()
  const btn = (active: boolean) =>
    `w-8 h-8 grid place-items-center rounded-lg shrink-0 ${active ? 'bg-brand-50 text-brand-700' : 'text-dim hover:bg-divider'}`
  const divider = <span className="w-px h-5 bg-border-subtle mx-1 shrink-0" />
  const setLink = async () => {
    const prev = editor.getAttributes('link').href as string | undefined
    const url = await promptDialog({
      title: 'ใส่ลิงก์',
      message: 'เว้นว่างแล้วกดตกลง = เอาลิงก์ออก',
      placeholder: 'https://...',
      initialValue: prev ?? 'https://',
      confirmLabel: 'ใส่ลิงก์',
    })
    if (url === null) return
    if (url === '' || url === 'https://') editor.chain().focus().unsetLink().run()
    else editor.chain().focus().setLink({ href: url }).run()
  }
  return (
    // บั๊ก (2026-07-03): ปุ่มทูลบาร์กด "ตัวหนา/เอียง/ฯลฯ" แล้วไม่มีอะไรเกิดขึ้น — mousedown เดิมทำให้ ProseMirror เสียโฟกัส/selection ก่อน onClick จะรัน (ต้อง preventDefault ตอน mousedown เพื่อกันเบราว์เซอร์แย่งโฟกัสจาก editor)
    <div onMouseDown={(e) => e.preventDefault()} className="flex items-center gap-0.5 border-b border-border-subtle px-2 sm:px-3 h-12 shrink-0 overflow-x-auto">
      {([2, 3, 4] as const).map((lv) => (
        <button key={lv} title={`หัวข้อ h${lv}`} onClick={() => editor.chain().focus().toggleHeading({ level: lv }).run()} className={btn(editor.isActive('heading', { level: lv }))}>
          {lv === 2 ? <Heading2 className="w-4 h-4" /> : lv === 3 ? <Heading3 className="w-4 h-4" /> : <Heading4 className="w-4 h-4" />}
        </button>
      ))}
      {divider}
      <button title="ตัวหนา" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive('bold'))}><Bold className="w-4 h-4" /></button>
      <button title="ตัวเอียง" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive('italic'))}><Italic className="w-4 h-4" /></button>
      <button title="ขีดฆ่า" onClick={() => editor.chain().focus().toggleStrike().run()} className={btn(editor.isActive('strike'))}><Strikethrough className="w-4 h-4" /></button>
      <button title="โค้ด" onClick={() => editor.chain().focus().toggleCode().run()} className={btn(editor.isActive('code'))}><Code className="w-4 h-4" /></button>
      {divider}
      <button title="รายการ" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive('bulletList'))}><List className="w-4 h-4" /></button>
      <button title="รายการมีลำดับ" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive('orderedList'))}><ListOrdered className="w-4 h-4" /></button>
      <button title="เช็คลิสต์" onClick={() => editor.chain().focus().toggleList('taskList', 'taskItem').run()} className={btn(editor.isActive('taskList'))}><ListChecks className="w-4 h-4" /></button>
      {divider}
      <button title="อ้างอิง" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={btn(editor.isActive('blockquote'))}><TextQuote className="w-4 h-4" /></button>
      <button title="ลิงก์" onClick={() => void setLink()} className={btn(editor.isActive('link'))}><Link2 className="w-4 h-4" /></button>
      {onPickImage && <button title="แทรกรูป (หรือวาง/ลากรูปลงในเนื้อหา)" onClick={onPickImage} className={btn(false)}><ImageIcon className="w-4 h-4" /></button>}
      <button title="เส้นคั่น" onClick={() => editor.chain().focus().setHorizontalRule().run()} className={btn(false)}><Minus className="w-4 h-4" /></button>
      {divider}
      {editor.isActive('table') ? (
        <>
          <button title="เพิ่มแถว" onClick={() => editor.chain().focus().addRowAfter().run()} className={btn(false)}><Rows3 className="w-4 h-4" /></button>
          <button title="เพิ่มคอลัมน์" onClick={() => editor.chain().focus().addColumnAfter().run()} className={btn(false)}><Columns3 className="w-4 h-4" /></button>
          <button title="ลบแถวนี้" onClick={() => editor.chain().focus().deleteRow().run()} className="text-xs text-dim hover:text-danger-600 px-2 h-8 shrink-0 rounded-lg hover:bg-divider">ลบแถว</button>
          <button title="ลบคอลัมน์นี้" onClick={() => editor.chain().focus().deleteColumn().run()} className="text-xs text-dim hover:text-danger-600 px-2 h-8 shrink-0 rounded-lg hover:bg-divider">ลบคอลัมน์</button>
          <button title="ลบตารางทั้งหมด" onClick={() => editor.chain().focus().deleteTable().run()} className="text-xs text-danger-600 hover:text-danger-700 px-2 h-8 shrink-0 rounded-lg hover:bg-divider">ลบตาราง</button>
        </>
      ) : (
        <button title="แทรกตาราง" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} className={btn(false)}><Table className="w-4 h-4" /></button>
      )}
      {rightSlot && <span className="ml-auto flex items-center gap-1.5 text-xs text-muted shrink-0 pl-3">{rightSlot}</span>}
    </div>
  )
}

/**
 * เอดิเตอร์ครบชุด (ทูลบาร์ + เนื้อหา) เก็บ/โหลดเป็น Markdown — uncontrolled ตาม pattern ของ Tiptap
 * `content` = เนื้อหาเริ่มต้นเท่านั้น (ไม่ re-render ตามทุกครั้งที่ prop เปลี่ยน) ยิง onChange(markdown) ทุกครั้งที่แก้ไข ให้ parent ตัดสินใจ save เอง
 * `bare` = ไม่ห่อกรอบ/พื้นหลังของตัวเอง เอาไว้ฝังในการ์ดอื่นที่มีสไตล์อยู่แล้ว (เช่นรายการโน้ตแบบอ่านอย่างเดียว)
 */
export function RichTextEditor({
  content,
  onChange,
  editable = true,
  placeholder = 'เริ่มพิมพ์ได้เลย…',
  minHeight = 'min-h-32',
  autoFocus,
  bare = false,
}: {
  content: string
  onChange?: (markdown: string) => void
  editable?: boolean
  placeholder?: string
  minHeight?: string
  autoFocus?: boolean
  bare?: boolean
}) {
  const editor = useEditor(
    {
      extensions: richTextExtensions(placeholder),
      content,
      contentType: 'markdown',
      editable,
      autofocus: autoFocus ? 'end' : false,
      editorProps: { attributes: { class: `doc-editor focus:outline-hidden ${minHeight}` } },
      onUpdate: ({ editor: ed }) => onChange?.(ed.getMarkdown()),
    },
    [editable],
  )

  if (!editor) return null
  const inner = (
    <>
      {editable && <RichTextToolbar editor={editor} />}
      <div className={bare ? '' : 'px-3 sm:px-4 py-3'}>
        <EditorContent editor={editor} />
      </div>
    </>
  )
  if (bare) return inner
  return <div className="border border-border-subtle rounded-lg overflow-hidden bg-white">{inner}</div>
}
