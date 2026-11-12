import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { db, getSetting, recordTables, setSetting, type Photo } from './db'
import { decrypt, encrypt } from './crypto'
import { isoDate } from './logic'

interface Manifest {
  app: 'ClinicBook'
  format: 1
  kind: 'records' | 'photos'
  createdAt: number
  count: number
}

/** Settings that belong to this phone only and are never carried in a backup. */
const DEVICE_ONLY = new Set(['pin', 'backupPassword', 'lastRecordsBackup', 'lastPhotosBackup'])

async function pack(kind: Manifest['kind'], files: Zippable, count: number, password: string) {
  const manifest: Manifest = { app: 'ClinicBook', format: 1, kind, createdAt: Date.now(), count }
  files['manifest.json'] = strToU8(JSON.stringify(manifest))
  const zipped = zipSync(files, { level: 0 }) // photos are already JPEG; records are small
  const sealed = await encrypt(zipped as Uint8Array<ArrayBuffer>, password)
  const stamp = isoDate(new Date()) + '-' + new Date().toTimeString().slice(0, 5).replace(':', '')
  return new File([sealed], `clinicbook-${kind}-${stamp}.clbk`, { type: 'application/octet-stream' })
}

export async function backupRecords(password: string) {
  const data: Record<string, unknown[]> = {}
  for (const t of recordTables) {
    const rows = await db.table(t).toArray()
    data[t] = t === 'settings' ? rows.filter((r: { key: string }) => !DEVICE_ONLY.has(r.key)) : rows
  }
  const count = (data.patients as unknown[]).length
  const file = await pack('records', { 'data.json': strToU8(JSON.stringify(data)) }, count, password)
  await setSetting('lastRecordsBackup', Date.now())
  return file
}

/** since = only photos taken after this time (null = every photo). */
export async function backupPhotos(password: string, since: number | null) {
  const photos = since
    ? await db.photos.where('takenAt').above(since).toArray()
    : await db.photos.toArray()
  const files: Zippable = { 'photos.json': strToU8(JSON.stringify(photos)) }
  for (const p of photos) {
    const b = await db.photoBlobs.get(p.id)
    if (!b) continue
    files[`p/${p.id}.jpg`] = new Uint8Array(await b.full.arrayBuffer())
    files[`p/${p.id}.t.jpg`] = new Uint8Array(await b.thumb.arrayBuffer())
  }
  const file = await pack('photos', files, photos.length, password)
  await setSetting('lastPhotosBackup', Date.now())
  return file
}

export async function readBackup(file: File, password: string) {
  const plain = await decrypt(new Uint8Array(await file.arrayBuffer()), password)
  const files = unzipSync(plain)
  const manifest = JSON.parse(strFromU8(files['manifest.json'])) as Manifest
  if (manifest.app !== 'ClinicBook') throw new Error('This is not a ClinicBook backup file.')
  return { manifest, files }
}

/** Records: replace everything on this phone (photo files on the phone are kept). */
export async function restoreRecords(files: Record<string, Uint8Array>) {
  const data = JSON.parse(strFromU8(files['data.json'])) as Record<string, unknown[]>
  const keep = await db.settings.where('key').anyOf([...DEVICE_ONLY]).toArray()
  await db.transaction('rw', recordTables.map((t) => db.table(t)), async () => {
    for (const t of recordTables) {
      await db.table(t).clear()
      await db.table(t).bulkAdd(data[t] ?? [])
    }
    await db.settings.bulkPut(keep)
  })
}

/** Photos: add any that are missing, never removes anything. */
export async function restorePhotos(files: Record<string, Uint8Array>) {
  const photos = JSON.parse(strFromU8(files['photos.json'])) as Photo[]
  let added = 0
  for (const p of photos) {
    const full = files[`p/${p.id}.jpg`]
    const thumb = files[`p/${p.id}.t.jpg`]
    if (!full || !thumb) continue
    await db.transaction('rw', db.photos, db.photoBlobs, async () => {
      if (!(await db.photos.get(p.id))) await db.photos.add(p)
      if (!(await db.photoBlobs.get(p.id))) {
        await db.photoBlobs.add({
          id: p.id,
          full: new Blob([full as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }),
          thumb: new Blob([thumb as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }),
        })
        added++
      }
    })
  }
  return added
}

/** Opens the phone's share sheet (Drive, WhatsApp to self, Files…); falls back to a download. */
export async function shareFile(file: File) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled'
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}

export async function backupAgeDays() {
  const last = await getSetting<number>('lastRecordsBackup', 0)
  return last ? Math.floor((Date.now() - last) / 86400000) : null
}
