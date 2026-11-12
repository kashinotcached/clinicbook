import Dexie, { type Table, type Transaction } from 'dexie'

/** item id -> quantity used in one session */
export type Usage = Record<string, number>

export interface Patient {
  id: string
  name: string
  phone: string
  age?: number
  gender: '' | 'M' | 'F' | 'O'
  notes: string
  createdAt: number
  updatedAt: number
}

/** What one session of a course uses from stock, from `date` onwards. */
export interface PlanStep {
  date: string
  usage: Usage
  note?: string
}

export interface Course {
  id: string
  patientId: string
  treatmentId: string
  treatment: string
  totalSessions: number
  intervalDays: number
  startDate: string
  status: 'active' | 'completed' | 'stopped'
  /** Oldest first. The last step is the current dose. */
  plan: PlanStep[]
  notes: string
  createdAt: number
  updatedAt: number
}

export interface Visit {
  id: string
  patientId: string
  courseId: string | null
  date: string
  time: string
  status: 'scheduled' | 'done' | 'missed'
  /** Filled when the visit is done; scheduled visits take the course's current dose. */
  usage: Usage
  notes: string
  /** When a WhatsApp reminder was last opened for this appointment. */
  remindedAt?: number
  createdAt: number
  updatedAt: number
}

export interface Photo {
  id: string
  patientId: string
  visitId: string
  area: string
  takenAt: number
  bytes: number
}

export interface PhotoBlob {
  id: string
  full: Blob
  thumb: Blob
}

export interface StockItem {
  id: string
  name: string
  unit: string
  lowAt: number
  sort: number
  active: boolean
  /** Used in every session (PRP kit, gloves…) or only now and then (anaesthetic vial, equipment…). Missing = true. */
  perSession?: boolean
}

export const isPerSession = (i: StockItem) => i.perSession !== false

export interface Supplier {
  id: string
  name: string
  phone: string
  notes: string
  createdAt: number
}

export interface StockMove {
  id: string
  itemId: string
  /** + received, - used */
  qty: number
  kind: 'received' | 'used' | 'adjust'
  visitId: string | null
  date: string
  note: string
  supplierId?: string | null
  createdAt: number
}

export interface Treatment {
  id: string
  name: string
  sessions: number
  intervalDays: number
  usage: Usage
  sort: number
}

export interface Setting {
  key: string
  value: unknown
}

/** Tables that make up "the records" (everything except photo files). */
export const recordTables = [
  'patients',
  'courses',
  'visits',
  'photos',
  'stockItems',
  'stockMoves',
  'treatments',
  'settings',
  'suppliers',
] as const

/** A record removed on this device, kept so the removal reaches other devices when syncing. */
export interface Deletion {
  id: string
  table: string
  key: string
  at: number
}

/** Values that belong to this device only and never sync (sync key, sign-in token…). */
export interface LocalValue {
  key: string
  value: unknown
}

class ClinicDb extends Dexie {
  patients!: Table<Patient, string>
  courses!: Table<Course, string>
  visits!: Table<Visit, string>
  photos!: Table<Photo, string>
  photoBlobs!: Table<PhotoBlob, string>
  stockItems!: Table<StockItem, string>
  stockMoves!: Table<StockMove, string>
  treatments!: Table<Treatment, string>
  settings!: Table<Setting, string>
  suppliers!: Table<Supplier, string>
  deletions!: Table<Deletion, string>
  local!: Table<LocalValue, string>

  constructor() {
    super('clinicbook')
    this.version(1).stores({
      patients: 'id, name, phone, updatedAt',
      courses: 'id, patientId, status',
      visits: 'id, patientId, courseId, date, status, [status+date]',
      photos: 'id, patientId, visitId, takenAt',
      photoBlobs: 'id',
      stockItems: 'id, sort',
      stockMoves: 'id, itemId, visitId, date',
      treatments: 'id, sort',
      settings: 'key',
    })
    this.version(2).stores({
      stockMoves: 'id, itemId, visitId, date, supplierId',
      suppliers: 'id, name',
    })
    // v3: every record carries _mt (last changed, ms) and removals are remembered, for syncing between devices
    this.version(3)
      .stores({ deletions: 'id, at', local: 'key' })
      .upgrade(async (tx) => {
        const now = Date.now()
        for (const t of recordTables)
          await tx
            .table(t)
            .toCollection()
            .modify((r: Record<string, unknown>) => {
              r._mt = now
            })
      })
  }
}

export const db = new ClinicDb()


export const newId = () => crypto.randomUUID()

/* ---------- change tracking for sync ---------- */

const UNTRACKED = '__clinicbookUntracked'
const isUntracked = (tx: Transaction | undefined) => !!(tx as unknown as Record<string, unknown> | undefined)?.[UNTRACKED]

/** Run writes that must not count as local changes (applying another device's data, first-run defaults). */
export function untracked<T>(tables: string[], fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', tables, async () => {
    ;(Dexie.currentTransaction as unknown as Record<string, unknown>)[UNTRACKED] = true
    return fn()
  })
}

/** Fires (debounced) after local changes, so sync can push them. */
export const localChanges = new EventTarget()
let pendingDeletions: Deletion[] = []
const seenTx = new WeakSet<object>()
function afterCommit(tx: Transaction) {
  if (seenTx.has(tx)) return
  seenTx.add(tx)
  tx.on('complete', () =>
    setTimeout(async () => {
      if (pendingDeletions.length) {
        const batch = pendingDeletions
        pendingDeletions = []
        await db.deletions.bulkPut(batch)
      }
      localChanges.dispatchEvent(new Event('change'))
    }, 0),
  )
}

for (const name of recordTables) {
  const t = db.table(name)
  t.hook('creating', function (_pk, obj, tx) {
    if (isUntracked(tx)) return
    ;(obj as Record<string, unknown>)._mt = Date.now()
    afterCommit(tx)
  })
  t.hook('updating', function (_mods, _pk, _obj, tx) {
    if (isUntracked(tx)) return
    afterCommit(tx)
    return { _mt: Date.now() }
  })
  t.hook('deleting', function (pk, _obj, tx) {
    if (isUntracked(tx)) return
    pendingDeletions.push({ id: `${name}:${pk}`, table: name, key: String(pk), at: Date.now() })
    afterCommit(tx)
  })
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return row ? (row.value as T) : fallback
}

export function setSetting(key: string, value: unknown) {
  return db.settings.put({ key, value })
}

export const DEFAULT_PHOTO_AREAS = ['Front / hairline', 'Top', 'Crown', 'Left side', 'Right side', 'Back']

/** First run: the clinic's usual stock items and the two treatments. Quantities are editable in Settings. */
export async function seedIfEmpty() {
  // untracked: defaults carry no change time, so real data from another device always wins over them
  await untracked(['stockItems', 'treatments', 'settings'], async () => {
    if ((await db.stockItems.count()) > 0) return
    const items: StockItem[] = [
      { id: 'prp-kit', name: 'PRP kit', unit: 'bottle', lowAt: 10, sort: 1, active: true },
      { id: 'gfc-tube', name: 'GFC tube', unit: 'tube', lowAt: 10, sort: 2, active: true },
      { id: 'gloves', name: 'Gloves', unit: 'pair', lowAt: 20, sort: 3, active: true },
      { id: 'syringe-10', name: 'Syringe 10cc', unit: 'pc', lowAt: 10, sort: 4, active: true },
      { id: 'syringe-2-5', name: 'Syringe 2.5cc', unit: 'pc', lowAt: 10, sort: 5, active: true },
      { id: 'syringe-insulin', name: 'Insulin syringe', unit: 'pc', lowAt: 20, sort: 6, active: true },
    ]
    await db.stockItems.bulkAdd(items)
    await db.treatments.bulkAdd([
      {
        id: 'prp',
        name: 'PRP',
        sessions: 6,
        intervalDays: 30,
        sort: 1,
        usage: { 'prp-kit': 4, gloves: 1, 'syringe-10': 1, 'syringe-insulin': 1 },
      },
      {
        id: 'gfc',
        name: 'GFC',
        sessions: 6,
        intervalDays: 30,
        sort: 2,
        usage: { 'gfc-tube': 2, gloves: 1, 'syringe-10': 1, 'syringe-insulin': 1 },
      },
    ])
    await db.settings.put({ key: 'photoAreas', value: DEFAULT_PHOTO_AREAS })
  })
}
