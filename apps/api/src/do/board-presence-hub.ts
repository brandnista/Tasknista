import { DurableObject } from 'cloudflare:workers'

/**
 * Presence ของ Sprint Board — DO ต่อ sprint (idFromName(sprintId))
 * ใครกำลังเปิดดูบอร์ดนี้อยู่ — broadcast roster ทุกครั้งที่เข้า/ออก
 * ใช้ WebSocket Hibernation เหมือน InboxThreadHub (attachment อยู่รอดข้าม hibernation)
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
    if (message === 'ping') ws.send('pong') // keepalive จาก client
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
