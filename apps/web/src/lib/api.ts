/** fetch wrapper กลาง — JSON เสมอ, โยน ApiError พร้อม status ให้หน้าจัดการ */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Pronista §My Files upload bug fix (2026-08-28) — FormData (อัปโหลดไฟล์) ต้องปล่อยให้ browser ตั้ง Content-Type เอง (multipart/form-data; boundary=...)
  // เดิม force เป็น application/json + JSON.stringify ทุกกรณี ทำให้ไฟล์ที่แนบหายและ server แกะ multipart ไม่ออก (500) — อัปโหลดไฟล์ผ่านหน้าจอจริงพังมาตั้งแต่ทำฟีเจอร์นี้
  const isFormData = body instanceof FormData
  const res = await fetch(path, {
    method,
    headers: body !== undefined && !isFormData ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  })
  if (!res.ok) {
    let message = res.statusText
    try {
      // Pronista §Google Meet Integration (2026-08-28) — บาง endpoint ส่ง message (ข้อความอ่านง่ายสำหรับโชว์ผู้ใช้) แยกจาก error (slug ไว้ debug) — เลือก message ก่อนถ้ามี
      const data = (await res.json()) as { error?: string; message?: string }
      if (data.message) message = data.message
      else if (data.error) message = data.error
    } catch {
      // ไม่ใช่ JSON ก็ใช้ statusText
    }
    throw new ApiError(res.status, message)
  }
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
