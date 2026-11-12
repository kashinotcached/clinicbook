import Dexie, { type Table } from 'dexie'

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
  /** Amount charged for this visit (₹). */
  fee?: number
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
  /** Total amount paid for a 'received' entry (₹). */
  cost?: number
  supplierId?: string | null
  createdAt: number
}

export interface Treatment {
  id: string
  name: string
  sessions: number
  intervalDays: number
  usage: Usage
  /** Usual fee per session (₹). */
  fee?: number
  sort: number
}

export interface Setting {
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
  }
}

export const db = new ClinicDb()

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

export const newId = () => crypto.randomUUID()

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
  await db.transaction('rw', db.stockItems, db.treatments, db.settings, async () => {
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
