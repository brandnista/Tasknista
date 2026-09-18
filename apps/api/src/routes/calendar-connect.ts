import {
  calendarConnections,
  createDb,
  inboxGoogleClients,
} from '@seedoffice/db'
import { and, eq, isNull } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { writeAudit } from '../lib/audit'
import { decryptSecret, encryptSecret } from '../lib/crypto'
import { syncCalendar } from '../lib/gcal-sync'
import { newToken } from '../lib/session'
import type { AppEnv } from '../types'

/**
 * เชื่อม Google Calendar เพื่อ sync ขาเข้า (SPEC §4.14 · E6) — owner+member เชื่อมปฏิทินของตัวเองได้ (mount ใน index.ts)
 * Pronista §Calendar/Workload (2026-09-18) — เดิม owner เท่านั้น เชื่อมได้บัญชีเดียวทั้งบริษัท ไม่ผูกกับใครเลย
 * (ทุกคนเห็น event เดียวกันหมด ระบบไม่รู้ว่า "ของใคร") เปลี่ยนเป็นแบบรายคน: แต่ละคนเชื่อมปฏิทิน Google ของตัวเองได้
 * (คนละอีเมลกับบัญชี Pronista ก็ได้ — แก้ปัญหาที่พี่แบงค์ login ด้วย manager@brandnista.co.th แต่ใช้ Google Calendar จริงที่ banknista@gmail.com)
 * ใช้ OAuth client (Internal) ตัวเดียวกับอีเมลกลาง — auto-pick ตัวแรก ไม่ต้องให้ผู้ใช้ทั่วไปเลือกเอง (เรื่องเทคนิคที่ไม่ควรต้องรู้)
 * Pronista §Google Meet Integration (2026-08-28) — เพิ่ม scope calendar.events (เขียน) ควบคู่ readonly เดิม
 * เพื่อให้ routes/meetings.ts สร้างนัดประชุมพร้อมลิงก์ Google Meet อัตโนมัติได้ (ดู lib/gcal-meet.ts)
 * refresh token เข้ารหัสก่อนเก็บ · ไม่หลุดออก response
 */

const GCAL_STATE_COOKIE = 'so_gcal_state'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const CALENDAR_SCOPE = `${CALENDAR_READONLY_SCOPE} ${CALENDAR_EVENTS_SCOPE}`

/** decode payload ของ id_token (มาจาก Google ตรงๆ ผ่าน TLS — ไม่ต้อง verify ลายเซ็น) */
function decodeIdToken(idToken: string | undefined): { sub?: string; email?: string } {
  const part = idToken?.split('.')[1]
  if (!part) return {}
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as {
      sub?: string
      email?: string
    }
  } catch {
    return {}
  }
}

/** waitUntil ถ้ามี executionCtx (production) — เทสต์ปล่อยให้จบเอง */
function runAfter(c: Context<AppEnv>, p: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(p)
  } catch {
    void p.catch(() => {})
  }
}

export const calendarConnectRoutes = new Hono<AppEnv>()

  // รายการบัญชีที่เชื่อม — owner เห็นทุกคน (ช่วย troubleshoot), คนอื่นเห็นแค่ของตัวเอง (ไม่ส่ง refreshTokenEnc)
  .get('/', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const rows = await db
      .select({
        id: calendarConnections.id,
        userId: calendarConnections.userId,
        googleEmail: calendarConnections.googleEmail,
        scope: calendarConnections.scope,
        status: calendarConnections.status,
        lastSyncAt: calendarConnections.lastSyncAt,
        lastError: calendarConnections.lastError,
        connectedAt: calendarConnections.connectedAt,
      })
      .from(calendarConnections)
      .orderBy(calendarConnections.createdAt)
    const connections = me.role === 'owner' ? rows : rows.filter((r) => r.userId === me.id)
    return c.json({ connections })
  })

  // เริ่มเชื่อม — redirect ไป Google (offline + consent การันตี refresh token) · auto-pick client ตัวแรก ไม่ต้องให้เลือกเอง
  .get('/connect', async (c) => {
    const db = createDb(c.env.DB)
    const [client] = await db
      .select({ id: inboxGoogleClients.id, clientId: inboxGoogleClients.clientId })
      .from(inboxGoogleClients)
      .where(isNull(inboxGoogleClients.deletedAt))
      .orderBy(inboxGoogleClients.createdAt)
      .limit(1)
    if (!client) return c.json({ error: 'client_not_found', message: 'ยังไม่มีการตั้งค่า Google OAuth client — ติดต่อ owner' }, 404)

    const me = c.get('user')
    const state = newToken().slice(0, 32)
    // เก็บ userId ไปกับ state cookie ด้วย (callback ไม่การันตี session เดียวกับตอนเริ่ม redirect ไป Google)
    setCookie(c, GCAL_STATE_COOKIE, `${state}.${client.id}.${me.id}`, {
      httpOnly: true,
      secure: c.env.APP_URL.startsWith('https://'),
      sameSite: 'Lax',
      path: '/',
      maxAge: 600,
    })
    const params = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: `${c.env.APP_URL}/api/calendar-connect/callback`,
      response_type: 'code',
      scope: `openid email ${CALENDAR_SCOPE}`,
      access_type: 'offline',
      prompt: 'consent',
      state,
    })
    return c.redirect(`${GOOGLE_AUTH_URL}?${params}`)
  })

  // Google เด้งกลับ — แลก code → ยืนยัน scope ปฏิทิน → เก็บ token เข้ารหัส
  .get('/callback', async (c) => {
    const fail = (code: string) => c.redirect(`/profile?gcal_error=${code}`)
    const { code, state } = c.req.query()
    const stateCookie = getCookie(c, GCAL_STATE_COOKIE)
    deleteCookie(c, GCAL_STATE_COOKIE, { path: '/' })
    const [cookieState, clientRowId, userId] = stateCookie?.split('.') ?? []
    if (!code || !state || !cookieState || state !== cookieState || !clientRowId || !userId)
      return c.json({ error: 'invalid_state' }, 400)
    // กันเคส session สลับกลางทาง (login คนละคนระหว่าง redirect ไป Google แล้วกลับมา) — เชื่อมได้แค่ให้ตัวเองเท่านั้น
    if (c.get('user').id !== userId) return c.json({ error: 'session_mismatch' }, 400)

    const db = createDb(c.env.DB)
    const [client] = await db
      .select()
      .from(inboxGoogleClients)
      .where(and(eq(inboxGoogleClients.id, clientRowId), isNull(inboxGoogleClients.deletedAt)))
    if (!client) return fail('client_not_found')

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: await decryptSecret(client.clientSecretEnc, c.env.INBOX_ENC_KEY),
        redirect_uri: `${c.env.APP_URL}/api/calendar-connect/callback`,
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) return fail('token_exchange')
    const token = (await tokenRes.json()) as {
      access_token?: string
      refresh_token?: string
      id_token?: string
      scope?: string
    }
    if (!token.access_token || !token.refresh_token) return fail('no_refresh_token')
    // ยืนยัน scope ปฏิทินถูก grant จริง (ผู้ใช้ติ๊กออกได้ตอน consent) — ต้องได้ทั้งอ่าน (sync เข้า) และเขียน (สร้างนัดประชุม+ลิงก์ Meet)
    if (!token.scope?.includes('calendar.readonly')) return fail('calendar_scope_denied')
    if (!token.scope?.includes('calendar.events')) return fail('calendar_events_scope_denied')

    const { sub, email } = decodeIdToken(token.id_token)
    const refreshTokenEnc = await encryptSecret(token.refresh_token, c.env.INBOX_ENC_KEY)
    // เชื่อมบัญชี Google เดิมซ้ำ (คนเดียวกัน) = อัปเดต (reconnect) ไม่สร้างใหม่ — สโคปด้วย userId ด้วย กันคนละคนที่บังเอิญเชื่อม Google account เดียวกันทับกัน
    const [existing] = sub
      ? await db
          .select({ id: calendarConnections.id })
          .from(calendarConnections)
          .where(and(eq(calendarConnections.googleAccountId, sub), eq(calendarConnections.userId, userId)))
          .limit(1)
      : []
    let connId: string
    if (existing) {
      await db
        .update(calendarConnections)
        .set({
          clientId: clientRowId,
          googleEmail: email ?? null,
          refreshTokenEnc,
          scope: token.scope ?? null,
          status: 'connected',
          connectedAt: new Date(),
          lastError: null,
        })
        .where(eq(calendarConnections.id, existing.id))
      connId = existing.id
    } else {
      const [row] = await db
        .insert(calendarConnections)
        .values({
          clientId: clientRowId,
          userId,
          googleEmail: email ?? null,
          googleAccountId: sub ?? null,
          refreshTokenEnc,
          scope: token.scope ?? null,
          status: 'connected',
          connectedAt: new Date(),
        })
        .returning({ id: calendarConnections.id })
      connId = row!.id
    }
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'gcal.connect',
      entity: 'calendar_connections',
      entityId: connId,
      meta: { email: email ?? null },
    })
    runAfter(c, syncCalendar(c.env, connId))
    return c.redirect('/profile?gcal=connected')
  })

  // sync เดี๋ยวนี้ — เจ้าของ connection เท่านั้น (owner sync แทนใครก็ได้ เพื่อ troubleshoot)
  .post('/:id/sync', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const [conn] = await db
      .select({ id: calendarConnections.id, userId: calendarConnections.userId, status: calendarConnections.status })
      .from(calendarConnections)
      .where(eq(calendarConnections.id, c.req.param('id')))
    if (!conn) return c.json({ error: 'not_found' }, 404)
    if (me.role !== 'owner' && conn.userId !== me.id) return c.json({ error: 'forbidden' }, 403)
    if (conn.status !== 'connected') return c.json({ error: 'not_connected' }, 400)
    try {
      await syncCalendar(c.env, conn.id)
    } catch {
      return c.json({ error: 'sync_failed' }, 502)
    }
    const [state] = await db
      .select({ lastSyncAt: calendarConnections.lastSyncAt, lastError: calendarConnections.lastError })
      .from(calendarConnections)
      .where(eq(calendarConnections.id, conn.id))
    return c.json({ ok: true, ...state })
  })

  // ปลดการเชื่อม — เจ้าของ connection เท่านั้น (owner ปลดแทนใครก็ได้)
  // Pronista §Calendar/Workload (2026-09-18) — เดิมลบ calendarEvents ทั้งหมดที่ source='gcal' แบบเหมาเข่ง (บั๊ก — กระทบคนอื่นที่เชื่อมปฏิทินไว้ด้วย)
  // ตอนนี้ event ผูกกับ connectionId + onDelete cascade ที่ schema แล้ว → ลบแค่ connection row พอ ลบเฉพาะ event ของ connection นี้อัตโนมัติ
  .delete('/:id', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const [conn] = await db
      .select({ id: calendarConnections.id, userId: calendarConnections.userId })
      .from(calendarConnections)
      .where(eq(calendarConnections.id, c.req.param('id')))
    if (!conn) return c.json({ error: 'not_found' }, 404)
    if (me.role !== 'owner' && conn.userId !== me.id) return c.json({ error: 'forbidden' }, 403)
    await db.delete(calendarConnections).where(eq(calendarConnections.id, conn.id))
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'gcal.disconnect',
      entity: 'calendar_connections',
      entityId: conn.id,
    })
    return c.json({ ok: true })
  })
