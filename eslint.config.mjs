import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.wrangler/**', '**/worker-configuration.d.ts', 'mockup.html'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // กัน floating promise ตั้งแต่วันแรก (best practice ของ Workers)
      '@typescript-eslint/no-floating-promises': 'off', // ต้องใช้ type-aware lint — เปิดใน T04 ตอนมี route จริง
    },
  },
  {
    // 'off' เพราะยังไม่เคยเปิดใช้จริงทั้งแอป (จะมีของเก่าเตือนเพียบถ้าเปิด) — ลงทะเบียนแค่ให้ rule นี้ "มีอยู่จริง"
    // กัน error "Definition for rule 'react-hooks/exhaustive-deps' was not found" ที่จุดซึ่งมี eslint-disable-next-line ระบุ rule นี้ไว้ตั้งแต่ก่อน migrate มา flat config
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    // native dialog ดูไม่เรียบหรู — ใช้ useDialog() (components/Dialog.tsx) แทนเสมอ
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'alert', message: 'ใช้ useDialog() แทน' },
        { name: 'confirm', message: 'ใช้ confirmDialog() จาก useDialog() แทน' },
        { name: 'prompt', message: 'ใช้ promptDialog() จาก useDialog() แทน' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'alert', message: 'ใช้ useDialog() แทน' },
        { object: 'window', property: 'confirm', message: 'ใช้ confirmDialog() แทน' },
        { object: 'window', property: 'prompt', message: 'ใช้ promptDialog() แทน' },
      ],
    },
  },
)
