import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, '../../packages/db/migrations'))
  return {
    plugins: [
      cloudflareTest({
        singleWorker: true,
        wrangler: { configPath: '../../wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            DEV_AUTH: '1',
            // Pronista §Leave Feature Rollback (2026-09-23) — base wrangler.jsonc ปิดไว้ (production) ต้องเปิดในเทสต์เอง ไม่งั้น leave.test.ts/leave-admin.test.ts โดน 404 ทั้งหมดจาก leaveFeatureGate
            LEAVE_ENABLED: '1',
            APP_URL: 'http://localhost:5173',
            GOOGLE_CLIENT_ID: 'test-client-id',
            GOOGLE_CLIENT_SECRET: 'test-client-secret',
            // base64 ของ 32 bytes คงที่ — ใช้แค่ในเทสต์
            INBOX_ENC_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
            VAULT_ENC_KEY: 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=',
            // ค่าจำลองสำหรับเทสต์ webhook เท่านั้น ไม่ใช่ credential จริง
            LINE_CHANNEL_SECRET: 'test-line-channel-secret',
            LINE_SECOND_BRAIN_GROUP_ID: 'Cdevfakegroupid1234567890',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  }
})
