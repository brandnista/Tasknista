/** บอก PresenceHub ว่า timer ขยับ (start/stop) — best-effort ห้ามทำให้ request หลักล้ม */
export async function notifyPresence(env: Env, type: 'changed'): Promise<void> {
  try {
    const stub = env.PRESENCE.get(env.PRESENCE.idFromName('global'))
    await stub.notify({ type })
  } catch (e) {
    console.log(JSON.stringify({ event: 'presence_notify_failed', error: String(e) }))
  }
}

/** บอก BoardPresenceHub ของ sprint นี้ว่างาน/สถานะในบอร์ดเปลี่ยน — client ที่เปิดบอร์ดอยู่จะ reload สด — best-effort ห้ามทำให้ request หลักล้ม */
export async function notifyBoard(env: Env, sprintId: string): Promise<void> {
  try {
    const stub = env.BOARD_HUB.get(env.BOARD_HUB.idFromName(sprintId))
    await stub.notify({ type: 'board_changed' })
  } catch (e) {
    console.log(JSON.stringify({ event: 'board_notify_failed', error: String(e) }))
  }
}
