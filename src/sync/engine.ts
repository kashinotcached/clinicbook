import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { db, recordTables, untracked, type Deletion } from '../db'
import { deriveSyncKey, fromHex, seal, toHex, unseal } from '../crypto'
import * as drive from './drive'
import type { DriveFile } from './drive'

/* ---------- where the files live ---------- */

export interface Remote {
  list(): Promise<DriveFile[]>
  get(id: string): Promise<Uint8Array<ArrayBuffer>>
  create(name: string, data: Uint8Array<ArrayBuffer>): Promise<string>
  update(id: string, data: Uint8Array<ArrayBuffer>): Promise<void>
  remove(id: string): Promise<void>
  who(): Promise<string>
}

const googleDrive: Remote = {
  list: drive.listFiles,
  get: drive.download,
  create: (n, d) => drive.createFile(n, d),
  update: (id, d) => drive.updateFile(id, d),
  remove: drive.deleteFile,
  who: drive.whoAmI,
}

let remote: Remote = googleDrive
/** For testing on a developer machine only. */
export function setRemote(r: Remote) {
  remote = r
}

const RECORDS = 'records.clbk'
const KEYFILE = 'key.json'
const photoName = (id: string) => `p-${id}.clbk`
const photoIdOf = (name: string) => (name.startsWith('p-') && name.endsWith('.clbk') ? name.slice(2, -5) : null)

/** Settings that belong to one device and never travel. */
const DEVICE_ONLY = new Set(['pin', 'backupPassword', 'lastRecordsBackup', 'lastPhotosBackup'])

/* ---------- the sync password ---------- */

interface KeyFile {
  app: 'ClinicBook'
  salt: string
  check: string
}

export async function remoteHasKey() {
  return (await remote.list()).some((f) => f.name === KEYFILE)
}

/** First device: choose the sync password. */
export async function createSyncKey(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveSyncKey(password, salt)
  const check = await seal(key, strToU8('clinicbook') as Uint8Array<ArrayBuffer>)
  const kf: KeyFile = { app: 'ClinicBook', salt: toHex(salt), check: toHex(check) }
  await remote.create(KEYFILE, strToU8(JSON.stringify(kf)) as Uint8Array<ArrayBuffer>)
  await db.local.put({ key: 'syncKey', value: key })
  await rememberEmail()
}

/** Other devices: enter the same password. */
export async function unlockSyncKey(password: string) {
  const f = (await remote.list()).find((x) => x.name === KEYFILE)
  if (!f) throw new Error('No ClinicBook data found in this Google account.')
  const kf = JSON.parse(strFromU8(await remote.get(f.id))) as KeyFile
  const key = await deriveSyncKey(password, fromHex(kf.salt))
  try {
    if (strFromU8(await unseal(key, fromHex(kf.check))) !== 'clinicbook') throw new Error()
  } catch {
    throw new Error('That is not the sync password used on the other device.')
  }
  await db.local.put({ key: 'syncKey', value: key })
  await rememberEmail()
}

async function rememberEmail() {
  try {
    await db.local.put({ key: 'syncEmail', value: await remote.who() })
  } catch {
    /* only for display */
  }
}

export async function isSetUp() {
  return !!(await db.local.get('syncKey'))
}

export async function forgetThisDevice() {
  await db.local.bulkDelete(['syncKey', 'token', 'syncEmail', 'lastSync'])
}

/* ---------- merging ---------- */

type Row = Record<string, unknown> & { _mt?: number }
interface Snapshot {
  format: 1
  savedAt: number
  tables: Record<string, Row[]>
  deletions: Deletion[]
}

const keyOf = (table: string, r: Row) => String(table === 'settings' ? r.key : r.id)
const mt = (r: Row | undefined) => (r?._mt as number | undefined) ?? 0

/**
 * Brings another device's records into this one. For each record the most recent change wins;
 * a removal wins over any change made before it. Returns true if this device has anything the other side lacks.
 */
async function mergeIn(snap: Snapshot | null): Promise<boolean> {
  let localHasMore = false
  await untracked([...recordTables, 'deletions', 'photoBlobs'], async () => {
    const dels = new Map((await db.deletions.toArray()).map((d) => [d.id, d]))
    const remoteDels = new Map((snap?.deletions ?? []).map((d) => [d.id, d]))
    for (const d of remoteDels.values()) {
      const mine = dels.get(d.id)
      if (!mine || d.at > mine.at) {
        dels.set(d.id, d)
        await db.deletions.put(d)
      }
    }
    for (const d of dels.values()) if (!remoteDels.has(d.id) || d.at > remoteDels.get(d.id)!.at) localHasMore = true

    for (const t of recordTables) {
      const table = db.table(t)
      const local = new Map((await table.toArray()).map((r: Row) => [keyOf(t, r), r]))
      const theirs = (snap?.tables[t] ?? []).filter((r) => !(t === 'settings' && DEVICE_ONLY.has(String(r.key))))
      const seen = new Set<string>()
      const put: Row[] = []
      for (const r of theirs) {
        const k = keyOf(t, r)
        seen.add(k)
        const removed = dels.get(`${t}:${k}`)
        if (removed && removed.at >= mt(r)) continue
        const l = local.get(k)
        if (!l || mt(r) > mt(l)) put.push(r)
        else if (mt(l) > mt(r)) localHasMore = true
      }
      for (const [k, l] of local) {
        if (seen.has(k) || (t === 'settings' && DEVICE_ONLY.has(k))) continue
        const removed = dels.get(`${t}:${k}`)
        if (!(removed && removed.at >= mt(l))) localHasMore = true
      }
      const drop = [...dels.values()]
        .filter((d) => d.table === t && local.has(d.key) && mt(local.get(d.key)) <= d.at)
        .map((d) => d.key)
      if (put.length) await table.bulkPut(put)
      if (drop.length) {
        await table.bulkDelete(drop)
        if (t === 'photos') await db.photoBlobs.bulkDelete(drop)
      }
    }
  })
  return localHasMore || !snap
}

async function snapshot(): Promise<Snapshot> {
  const tables: Record<string, Row[]> = {}
  for (const t of recordTables) {
    const rows = (await db.table(t).toArray()) as Row[]
    tables[t] = t === 'settings' ? rows.filter((r) => !DEVICE_ONLY.has(String(r.key))) : rows
  }
  return { format: 1, savedAt: Date.now(), tables, deletions: await db.deletions.toArray() }
}

/* ---------- one sync run ---------- */

export interface Progress {
  step: string
  done?: number
  total?: number
}

export interface SyncResult {
  pushed: boolean
  photosUp: number
  photosDown: number
  photosRemoved: number
}

let running: Promise<SyncResult> | null = null

export function syncNow(onProgress: (p: Progress) => void = () => {}): Promise<SyncResult> {
  if (!running) running = run(onProgress).finally(() => (running = null))
  return running
}

async function run(onProgress: (p: Progress) => void): Promise<SyncResult> {
  const key = (await db.local.get('syncKey'))?.value as CryptoKey | undefined
  if (!key) throw new Error('Sync is not set up on this device.')

  onProgress({ step: 'Checking Google Drive' })
  let files = await remote.list()
  const recordsFile = files.find((f) => f.name === RECORDS)

  onProgress({ step: 'Bringing in changes' })
  let snap: Snapshot | null = null
  if (recordsFile) snap = JSON.parse(strFromU8(await unseal(key, await remote.get(recordsFile.id)))) as Snapshot
  const localHasMore = await mergeIn(snap)

  if (localHasMore) {
    onProgress({ step: 'Saving changes to Drive' })
    const data = await seal(key, strToU8(JSON.stringify(await snapshot())) as Uint8Array<ArrayBuffer>)
    if (recordsFile) await remote.update(recordsFile.id, data)
    else await remote.create(RECORDS, data)
  }

  // ---- photos: each one its own encrypted file
  files = recordsFile ? files : await remote.list()
  const remotePhotos = new Map<string, DriveFile>()
  for (const f of files) {
    const id = photoIdOf(f.name)
    if (id) remotePhotos.set(id, f)
  }
  const photoRows = await db.photos.toArray()
  const localBlobs = new Set((await db.photoBlobs.toCollection().primaryKeys()) as string[])
  const wantDownload = ((await db.local.get('downloadPhotos'))?.value as boolean | undefined) ?? true

  const up = photoRows.filter((p) => localBlobs.has(p.id) && !remotePhotos.has(p.id))
  const down = wantDownload ? photoRows.filter((p) => !localBlobs.has(p.id) && remotePhotos.has(p.id)) : []
  const known = new Set(photoRows.map((p) => p.id))
  const removedPhotos = new Set((await db.deletions.where('id').startsWith('photos:').toArray()).map((d) => d.key))
  const gone = [...remotePhotos.entries()].filter(([id]) => removedPhotos.has(id) && !known.has(id))

  let n = 0
  const total = up.length + down.length
  await pool(up, 3, async (p) => {
    const b = await db.photoBlobs.get(p.id)
    if (!b) return
    const zipped = zipSync(
      { 'f.jpg': new Uint8Array(await b.full.arrayBuffer()), 't.jpg': new Uint8Array(await b.thumb.arrayBuffer()) },
      { level: 0 },
    )
    await remote.create(photoName(p.id), await seal(key, zipped as Uint8Array<ArrayBuffer>))
    onProgress({ step: 'Photos', done: ++n, total })
  })
  await pool(down, 3, async (p) => {
    const files = unzipSync(await unseal(key, await remote.get(remotePhotos.get(p.id)!.id)))
    await db.photoBlobs.put({
      id: p.id,
      full: new Blob([files['f.jpg'] as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }),
      thumb: new Blob([files['t.jpg'] as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }),
    })
    onProgress({ step: 'Photos', done: ++n, total })
  })
  for (const [, f] of gone) await remote.remove(f.id)

  await db.local.put({ key: 'lastSync', value: Date.now() })
  return { pushed: localHasMore, photosUp: up.length, photosDown: down.length, photosRemoved: gone.length }
}

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++])
    }),
  )
}
