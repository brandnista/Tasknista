/**
 * Pronista §Rich text — เอดิเตอร์/ทูลบาร์ Tiptap ใช้ร่วมกัน แยกออกมาจาก DocViewer.tsx เดิม (เอกสาร)
 * เพื่อให้ My Note (และจุดอื่นในอนาคต) ใช้ทูลบาร์จัดรูปแบบชุดเดียวกันได้ — เก็บ/โหลดเนื้อหาเป็น Markdown เสมอ
 * ปุ่มแทรกรูปโชว์เฉพาะตอนมี onPickImage (ตอนนี้มีแค่ DocViewer ที่ผูก endpoint อัปโหลดรูปไว้ — My Note ยังไม่มีที่เก็บรูปของตัวเอง)
 */
import { mergeAttributes, Node, type CommandProps, type MarkdownParseHelpers, type MarkdownToken } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold, Code, Columns3, Heading1, Heading2, Heading3, Heading4,
  Image as ImageIcon, Italic, Link2, List, ListChecks, ListOrdered, Minus, Rows3,
  Strikethrough, Table, TextQuote,
} from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { useDialog } from './Dialog'

/**
 * Pronista §Rich text media upload (2026-09-16) — Tiptap ไม่มีโหนดวิดีโอมาให้ (มีแต่ Image)
 * เก็บเป็น markdown ด้วย syntax เฉพาะของตัวเอง `[[video:url]]` (ไม่ยืม syntax รูปภาพ `![]()`)
 * เหตุผลที่ต้องแยก syntax เด็ดขาด (ลองยืม token 'image' ร่วมกับ Image มาก่อนแล้วพังจริง):
 * @tiptap/markdown dispatch ตัว render (renderNodeToMarkdown → getHandlerForToken) หยิบ handler ตัวแรกที่ลงทะเบียนไว้ใต้ tokenName
 * เดียวกันมาใช้แบบไม่เช็คก่อนว่าเข้ากับ node จริงไหม — ถ้า Video ใช้ tokenName ร่วมกับ Image ('image') โหนดรูปภาพจริงๆ
 * จะโดน renderMarkdown ของ Video ครอบไปด้วย (กลายเป็นวิดีโอทั้งคู่ตอน save) ต้องมี token type ของตัวเองเท่านั้นถึงจะปลอดภัย
 * → ใช้ markdownTokenizer ผูก syntax ใหม่ที่ marked.js ไม่มีมาก่อน ให้ token.type = 'video' ตรงกับชื่อโหนดเป๊ะ ไม่ชนใคร
 */
const Video = Node.create({
  name: 'video',
  group: 'block',
  draggable: true,
  addAttributes() {
    return { src: { default: null } }
  },
  parseHTML() {
    return [{ tag: 'video[src]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(HTMLAttributes, { controls: 'true', style: 'max-width:100%;border-radius:0.5rem' })]
  },
  markdownTokenizer: {
    name: 'video',
    level: 'block',
    start: (src: string) => src.indexOf('[[video:'),
    tokenize: (src: string) => {
      const m = /^\[\[video:(\S+?)\]\]/.exec(src)
      if (!m) return undefined
      return { type: 'video', raw: m[0], href: m[1] }
    },
  },
  parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers) => helpers.createNode('video', { src: token.href }),
  renderMarkdown: (node: { attrs?: Record<string, unknown> }) => `[[video:${(node.attrs?.src as string | undefined) ?? ''}]]`,
  addCommands() {
    return {
      setVideo:
        (options: { src: string }) =>
        ({ commands }: CommandProps) =>
          commands.insertContent({ type: this.name, attrs: options }),
    }
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    video: {
      setVideo: (options: { src: string }) => ReturnType
    }
  }
}

export function richTextExtensions(placeholder: string) {
  return [
    // Pronista §Heading hierarchy (2026-09-17) — เปิด H1 เพิ่มตามคำขออาร์ม (เดิมสงวนไว้ให้ "ชื่อ" ของหน้า
    // เช่น ชื่อ Task/เอกสาร/โน้ต ที่อยู่เหนือกล่องพิมพ์เป็น input ตัวใหญ่อยู่แล้ว — ตอนนี้เปิดให้เลือกในเนื้อหาได้ด้วย 4 ระดับ)
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Video,
    Image,
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({ placeholder }),
    Markdown,
  ]
}

/** ไฟล์ที่รองรับแทรกลงเนื้อหา (ปุ่ม Toolbar/วาง/ลาก) — รูปภาพทั่วไป + วิดีโอที่เล่นในเบราว์เซอร์ได้ตรงๆ ไม่ต้องแปลงไฟล์ */
export const MEDIA_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/avif,video/mp4,video/webm,video/quicktime'
const MEDIA_FILE_RE = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|quicktime))$/

export function RichTextToolbar({
  editor,
  onPickImage,
  pickMediaLabel = 'แทรกรูป (หรือวาง/ลากรูปลงในเนื้อหา)',
  rightSlot,
}: {
  editor: Editor
  onPickImage?: () => void
  /** ข้อความ tooltip ของปุ่มแทรกสื่อ — ปรับได้เวลารองรับวิดีโอด้วย (ค่าเริ่มต้นคงเดิมสำหรับ Docs/My Note ที่รองรับแค่รูป) */
  pickMediaLabel?: string
  rightSlot?: ReactNode
}) {
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
      {([1, 2, 3, 4] as const).map((lv) => (
        <button key={lv} title={`หัวข้อ h${lv}`} onClick={() => editor.chain().focus().toggleHeading({ level: lv }).run()} className={btn(editor.isActive('heading', { level: lv }))}>
          {lv === 1 ? <Heading1 className="w-4 h-4" /> : lv === 2 ? <Heading2 className="w-4 h-4" /> : lv === 3 ? <Heading3 className="w-4 h-4" /> : <Heading4 className="w-4 h-4" />}
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
      {onPickImage && <button title={pickMediaLabel} onClick={onPickImage} className={btn(false)}><ImageIcon className="w-4 h-4" /></button>}
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
 * `onUploadMedia` = เปิดใช้ปุ่มแทรกรูป/วิดีโอ + วาง (paste) + ลาก-วาง (drop) — parent ส่ง handler อัปโหลดไฟล์เอง (คืน url หรือ null ถ้าปฏิเสธ)
 * ไม่ส่ง prop นี้ = ไม่มีปุ่ม/วาง/ลากเลย เหมือนพฤติกรรมเดิม (Docs/My Note ที่ยังไม่ส่ง prop นี้ไม่กระทบ)
 */
export function RichTextEditor({
  content,
  onChange,
  editable = true,
  placeholder = 'เริ่มพิมพ์ได้เลย…',
  minHeight = 'min-h-32',
  autoFocus,
  bare = false,
  onUploadMedia,
}: {
  content: string
  onChange?: (markdown: string) => void
  editable?: boolean
  placeholder?: string
  minHeight?: string
  autoFocus?: boolean
  bare?: boolean
  onUploadMedia?: (file: File) => Promise<string | null>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const insertMediaFile = (file: File) => {
    void onUploadMedia?.(file).then((url) => {
      if (!url || !editor) return
      editor.chain().focus().insertContent(file.type.startsWith('video/') ? { type: 'video', attrs: { src: url } } : { type: 'image', attrs: { src: url } }).run()
      // (2026-09-16) insertContent ทิ้ง NodeSelection ไว้ที่โหนดสื่อที่เพิ่งแทรก — วาง/ลากไฟล์ถัดไปโดยไม่ได้คลิกที่อื่นก่อนจะ "แทนที่" โหนดนี้แทนที่จะแทรกต่อ
      // ย้าย cursor ไปจุดท้ายโหนดให้เป็น text selection แทน กันแทรกสื่อหลายไฟล์ติดกันแล้วไฟล์ก่อนหน้าหาย
      editor.chain().setTextSelection(editor.state.selection.to).run()
    })
  }
  const editor = useEditor(
    {
      extensions: richTextExtensions(placeholder),
      content,
      contentType: 'markdown',
      editable,
      autofocus: autoFocus ? 'end' : false,
      editorProps: {
        attributes: { class: `doc-editor focus:outline-hidden ${minHeight}` },
        handlePaste: onUploadMedia
          ? (_view, event) => {
              const file = [...(event.clipboardData?.files ?? [])][0]
              if (file && MEDIA_FILE_RE.test(file.type)) {
                insertMediaFile(file)
                return true
              }
              return false
            }
          : undefined,
        handleDrop: onUploadMedia
          ? (_view, event) => {
              const file = [...(event.dataTransfer?.files ?? [])][0]
              if (file && MEDIA_FILE_RE.test(file.type)) {
                event.preventDefault()
                insertMediaFile(file)
                return true
              }
              return false
            }
          : undefined,
      },
      onUpdate: ({ editor: ed }) => onChange?.(ed.getMarkdown()),
    },
    [editable],
  )

  if (!editor) return null
  const inner = (
    <>
      {editable && (
        <RichTextToolbar
          editor={editor}
          onPickImage={onUploadMedia ? () => fileRef.current?.click() : undefined}
          pickMediaLabel="แทรกรูป/วิดีโอ (หรือวาง/ลากไฟล์ลงในเนื้อหา)"
        />
      )}
      {editable && onUploadMedia && (
        <input
          ref={fileRef}
          type="file"
          accept={MEDIA_ACCEPT}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) insertMediaFile(f); e.target.value = '' }}
        />
      )}
      <div className={bare ? '' : 'px-3 sm:px-4 py-3'}>
        <EditorContent editor={editor} />
      </div>
    </>
  )
  if (bare) return inner
  return <div className="border border-border-subtle rounded-lg overflow-hidden bg-white">{inner}</div>
}
