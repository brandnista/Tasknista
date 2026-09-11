/** fetch wrapper กลาง — JSON เสมอ, โยน ApiError พร้อม status ให้หน้าจัดการ */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    // เก็บ body JSON เต็มๆ ไว้ด้วย (นอกจาก message ที่ derive แล้ว) — บาง endpoint ส่งฟิลด์เสริมมาด้วย เช่น retryAfterSeconds ของ vault pin lockout
    public data?: unknown,
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  // Pronista §My Files upload bug fix (2026-08-28) — FormData (อัปโหลดไฟล์) ต้องปล่อยให้ browser ตั้ง Content-Type เอง (multipart/form-data; boundary=...)
  // เดิม force เป็น application/json + JSON.stringify ทุกกรณี ทำให้ไฟล์ที่แนบหายและ server แกะ multipart ไม่ออก (500) — อัปโหลดไฟล์ผ่านหน้าจอจริงพังมาตั้งแต่ทำฟีเจอร์นี้
  const isFormData = body instanceof FormData
  const res = await fetch(path, {
    method,
    headers: { ...(body !== undefined && !isFormData ? { 'content-type': 'application/json' } : undefined), ...extraHeaders },
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  })
  if (!res.ok) {
    let message = res.statusText
    let data: unknown
    try {
      // Pronista §Google Meet Integration (2026-08-28) — บาง endpoint ส่ง message (ข้อความอ่านง่ายสำหรับโชว์ผู้ใช้) แยกจาก error (slug ไว้ debug) — เลือก message ก่อนถ้ามี
      const parsed = (await res.json()) as { error?: string; message?: string }
      data = parsed
      if (parsed.message) message = parsed.message
      else if (parsed.error) message = parsed.error
    } catch {
      // ไม่ใช่ JSON ก็ใช้ statusText
    }
    throw new ApiError(res.status, message, data)
  }
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string, headers?: Record<string, string>) => request<T>('GET', path, undefined, headers),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, body, headers),
  put: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('PUT', path, body, headers),
  patch: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('PATCH', path, body, headers),
  delete: <T>(path: string, headers?: Record<string, string>) => request<T>('DELETE', path, undefined, headers),
}
