import { DurableObject } from 'cloudflare:workers'

/**
 * Presence ของ Sprint Board — DO ต่อ sprint (idFromName(sprintId))
 * ใครกำลังเปิดดูบอร์ดนี้อยู่ — broadcast roster ทุกครั้งที่เข้า/ออก
 * ใช้ WebSocket Hibernation เหมือน InboxThreadHub (attachment อยู่รอดข้าม hibernation)
 * Pronista §Room Hub reuse — เป็น hub กลางที่ใช้ซ้ำได้กับ "ห้อง" อื่นๆ ที่ต้องการ roster+notify+relay แบบเดียวกัน
 * โดยแยก instance ด้วย prefix ของ id (ดู index.ts: sprint ตรงๆ, `task:{id}` สำหรับ Task Detail, `chat:{channelId}` สำหรับ Team Chat)
 */

interface Viewer {
  userId: string
  name: string
}

export class BoardPresenceHub extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
      return Response.json({ error: 'expected_websocket' }, { status: 426 })

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({
      userId: request.headers.get('x-user-id') ?? '',
      name: request.headers.get('x-user-name') ?? '',
    } satisfies Viewer)
    this.broadcastRoster()
    return new Response(null, { status: 101, webSocket: client })
  }

  /** รวมรายชื่อคนบนบอร์ด (คนเดียวหลายแท็บ = หนึ่งรายการ) แล้วส่งให้ทุกคน */
  private broadcastRoster(exclude?: WebSocket): void {
    const sockets = this.ctx.getWebSockets().filter((ws) => ws !== exclude)
    const byUser = new Map<string, Viewer>()
    for (const ws of sockets) {
      const v = ws.deserializeAttachment() as Viewer | null
      if (!v?.userId) continue
      byUser.set(v.userId, v)
    }
    const data = JSON.stringify({ type: 'roster', viewers: [...byUser.values()] })
    for (const ws of sockets) {
      try {
        ws.send(data)
      } catch {
        // socket ตายระหว่างส่ง — hibernation API เก็บกวาดเอง
      }
    }
  }

  /** RPC จาก worker routes — งาน/สถานะในบอร์ดนี้เปลี่ยน (ลาก/เพิ่ม/เอาออกจาก sprint) บอกทุก client ให้ reload ข้อมูลสด */
  notify(event: { type: string; [k: string]: unknown }): void {
    const data = JSON.stringify(event)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data)
      } catch {
        // socket ตายระหว่างส่ง — hibernation API จะเก็บกวาดเอง
      }
    }
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (message === 'ping') return void ws.send('pong') // keepalive จาก client
    // Pronista §Room Hub reuse — relay แบบทั่วไปไม่เก็บ state ฝั่ง server (client ไหนหลุดก็หายเงียบๆ เอง)
    // เดิมรับแค่ type:'cursor' (ตำแหน่งเมาส์ลอยบน Sprint Board) ตอนนี้ปล่อยผ่านทุก type ที่ระบุมา (เช่น 'typing' ของ Team Chat) — userId/name ประทับจาก attachment ฝั่ง server เสมอ ไม่เชื่อค่าที่ client ส่งมาปลอม
    try {
      const msg = JSON.parse(String(message)) as { type?: string; [k: string]: unknown }
      if (!msg.type || msg.type === 'roster') return // กัน client ปลอม event ระบบ
      const v = ws.deserializeAttachment() as Viewer | null
      if (!v?.userId) return
      const data = JSON.stringify({ ...msg, userId: v.userId, name: v.name })
      for (const other of this.ctx.getWebSockets()) {
        if (other === ws) continue
        try {
          other.send(data)
        } catch {
          // socket ตายระหว่างส่ง — hibernation API เก็บกวาดเอง
        }
      }
    } catch {
      // ข้อความนอกรูปแบบ — เมิน
    }
  }

  webSocketClose(ws: WebSocket): void {
    try {
      ws.close()
    } catch {
      // ปิดไปแล้ว
    }
    this.broadcastRoster(ws)
  }
}
