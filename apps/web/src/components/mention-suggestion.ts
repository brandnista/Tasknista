import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { MENTION_PATH_PREFIX } from '@seedoffice/core'

/** Pronista §PRO-0024 — พิมพ์ @ ในคอมเมนต์เพื่อแท็กคน: เลือกจากรายชื่อ (ค้นหาพิมพ์ต่อได้) แล้วแทรกเป็นลิงก์ `@ชื่อ` → /mention/<userId> */
export interface MentionCandidate {
  id: string
  name: string
}

const MAX_SHOWN = 6

export function createMentionExtension(getCandidates: () => MentionCandidate[]) {
  return Extension.create({
    name: 'mentionSuggest',
    addProseMirrorPlugins() {
      return [
        Suggestion<MentionCandidate, MentionCandidate>({
          editor: this.editor,
          pluginKey: new PluginKey('mentionSuggest'),
          char: '@',
          allowSpaces: false,
          // ต้องมีช่องว่าง/ต้นบรรทัดนำหน้า @ — กันอีเมล (a@b.com) เด้งรายชื่อ
          allowedPrefixes: [' '],
          items: ({ query }) => {
            const q = query.trim().toLowerCase()
            return getCandidates()
              .filter((c) => !q || c.name.toLowerCase().includes(q))
              .slice(0, MAX_SHOWN)
          },
          command: ({ editor, range, props }) => {
            const label = `@${props.name.replace(/[[\]]/g, '')}`
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: 'text', text: label, marks: [{ type: 'link', attrs: { href: `${MENTION_PATH_PREFIX}${props.id}` } }] },
                { type: 'text', text: ' ' },
              ])
              .run()
          },
          render: () => {
            let box: HTMLDivElement | null = null
            let current: SuggestionProps<MentionCandidate, MentionCandidate> | null = null
            let active = 0

            const draw = () => {
              if (!box || !current) return
              const { items, clientRect } = current
              box.innerHTML = ''
              if (items.length === 0) {
                const empty = document.createElement('div')
                empty.className = 'px-3 py-2 text-xs text-muted'
                empty.textContent = 'ไม่พบผู้ใช้'
                box.appendChild(empty)
              }
              items.forEach((item, i) => {
                const row = document.createElement('button')
                row.type = 'button'
                row.textContent = item.name
                row.className = `block w-full text-left px-3 py-2 text-sm truncate ${i === active ? 'bg-brand-50 text-brand-700' : 'text-body hover:bg-hover'}`
                // mousedown (ไม่ใช่ click) กัน editor เสีย focus ก่อนเลือก — ใช้ได้กับการแตะบนมือถือด้วย
                row.addEventListener('mousedown', (ev) => {
                  ev.preventDefault()
                  current?.command(item)
                })
                box!.appendChild(row)
              })
              const rect = clientRect?.()
              if (rect) {
                const width = 224
                box.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`
                box.style.top = `${rect.bottom + 6}px`
              }
            }

            return {
              onStart: (props) => {
                current = props
                active = 0
                box = document.createElement('div')
                box.setAttribute('role', 'listbox')
                box.setAttribute('aria-label', 'แท็กผู้ใช้')
                box.className = 'fixed z-[80] w-56 max-h-64 overflow-y-auto rounded-lg border border-border-subtle bg-white py-1 shadow-lg'
                document.body.appendChild(box)
                draw()
              },
              onUpdate: (props) => {
                current = props
                active = Math.min(active, Math.max(0, props.items.length - 1))
                draw()
              },
              onKeyDown: ({ event }: SuggestionKeyDownProps) => {
                if (!current) return false
                const n = current.items.length
                if (event.key === 'Escape') {
                  box?.remove()
                  box = null
                  return true
                }
                if (n === 0) return false
                if (event.key === 'ArrowDown') {
                  active = (active + 1) % n
                  draw()
                  return true
                }
                if (event.key === 'ArrowUp') {
                  active = (active - 1 + n) % n
                  draw()
                  return true
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  current.command(current.items[active]!)
                  return true
                }
                return false
              },
              onExit: () => {
                box?.remove()
                box = null
                current = null
              },
            }
          },
        }),
      ]
    },
  })
}
