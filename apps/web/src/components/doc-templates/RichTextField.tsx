import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Italic, List, ListOrdered } from 'lucide-react'
import { useEffect } from 'react'

/**
 * Tasknista §Document Attachments — ช่องพิมพ์อิสระแบบ Rich Text (field type 'richtext' ใน doc-templates/schema.ts)
 * เวอร์ชันย่อของ editor เต็มใน DocViewer.tsx — เก็บเป็น markdown string ใน TemplateData.fields เหมือน field ปกติ (ไม่มี toolbar รูปภาพ ใช้ DocAttachmentsSection สำหรับแนบรูปแทน)
 */
export function RichTextField({ value, onChange, readOnly }: { value: string; onChange: (markdown: string) => void; readOnly: boolean }) {
  const editor = useEditor(
    {
      extensions: [StarterKit.configure({ heading: false }), Markdown],
      content: value,
      contentType: 'markdown',
      editable: !readOnly,
      onUpdate: ({ editor: ed }) => onChange(ed.getMarkdown()),
      editorProps: { attributes: { class: 'prose prose-sm max-w-none focus:outline-hidden min-h-20 px-3 py-2' } },
    },
    [],
  )

  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  if (!editor) return null

  return (
    <div className="border border-border rounded-lg bg-white overflow-hidden">
      {!readOnly && (
        <div className="flex items-center gap-1 border-b border-divider px-2 py-1">
          <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={`p-1.5 rounded hover:bg-hover ${editor.isActive('bold') ? 'text-brand-600 bg-hover' : 'text-dim'}`}>
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={`p-1.5 rounded hover:bg-hover ${editor.isActive('italic') ? 'text-brand-600 bg-hover' : 'text-dim'}`}>
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={`p-1.5 rounded hover:bg-hover ${editor.isActive('bulletList') ? 'text-brand-600 bg-hover' : 'text-dim'}`}>
            <List className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={`p-1.5 rounded hover:bg-hover ${editor.isActive('orderedList') ? 'text-brand-600 bg-hover' : 'text-dim'}`}>
            <ListOrdered className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}
