import { describe, expect, it } from 'vitest'
import { extractGoogleDriveFileId, isGoogleDriveUrl } from './gdrive-link'

describe('isGoogleDriveUrl', () => {
  it('drive.google.com — true', () => {
    expect(isGoogleDriveUrl('https://drive.google.com/file/d/abc123/view')).toBe(true)
  })
  it('docs.google.com — true', () => {
    expect(isGoogleDriveUrl('https://docs.google.com/document/d/abc123/edit')).toBe(true)
  })
  it('www. prefix — true', () => {
    expect(isGoogleDriveUrl('https://www.drive.google.com/file/d/abc123/view')).toBe(true)
  })
  it('โฮสต์อื่น (Dropbox) — false', () => {
    expect(isGoogleDriveUrl('https://www.dropbox.com/s/abc123/file.pdf')).toBe(false)
  })
  it('URL ผิดรูปแบบ — false ไม่ throw', () => {
    expect(isGoogleDriveUrl('not-a-url')).toBe(false)
  })
})

describe('extractGoogleDriveFileId', () => {
  it('/file/d/{id}/view — ดึง id ได้', () => {
    expect(extractGoogleDriveFileId('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing')).toBe('1AbCdEfGhIjKlMn')
  })
  it('/document/d/{id}/edit (Google Docs) — ดึง id ได้', () => {
    expect(extractGoogleDriveFileId('https://docs.google.com/document/d/1XyZ9876543210/edit')).toBe('1XyZ9876543210')
  })
  it('/drive/folders/{id} — ดึง id ได้', () => {
    expect(extractGoogleDriveFileId('https://drive.google.com/drive/folders/1FolderIdExample')).toBe('1FolderIdExample')
  })
  it('?id={id} query param — ดึง id ได้', () => {
    expect(extractGoogleDriveFileId('https://drive.google.com/open?id=1QueryParamIdHere')).toBe('1QueryParamIdHere')
  })
  it('โฮสต์ไม่ใช่ Google Drive/Docs (เช่น Dropbox) — คืน null', () => {
    expect(extractGoogleDriveFileId('https://www.dropbox.com/s/abc123/file.pdf')).toBeNull()
  })
  it('URL ผิดรูปแบบ — คืน null ไม่ throw', () => {
    expect(extractGoogleDriveFileId('not-a-url')).toBeNull()
  })
  it('เป็น Google Drive host แต่ parse id ไม่ได้ — คืน null', () => {
    expect(extractGoogleDriveFileId('https://drive.google.com/drive/my-drive')).toBeNull()
  })
})
