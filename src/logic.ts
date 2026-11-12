import { db, newId, type Course, type Usage, type Visit, type StockItem } from './db'

/* ---------- dates (always local YYYY-MM-DD) ---------- */

export function isoDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const today = () => isoDate(new Date())

export function addDays(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number)
  return isoDate(new Date(y, m - 1, d + days))
}

export function daysBetween(from: string, to: string) {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

export function fmtDate(date: string) {
  if (!date) return ''
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function relDay(date: string) {
  const n = daysBetween(today(), date)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  return n > 0 ? `in ${n} days` : `${-n} days ago`
}

/* ---------- courses ---------- */

export const currentUsage = (c: Course): Usage => c.plan[c.plan.length - 1]?.usage ?? {}

export function usageOn(c: Course, date: string): Usage {
  let u: Usage = c.plan[0]?.usage ?? {}
  for (const step of c.plan) if (step.date <= date) u = step.usage
  return u
}

export interface CourseState {
  course: Course
  done: Visit[]
  scheduled: Visit[]
  remaining: number
  /** Next expected session date ('' when the course is finished). */
  nextDate: string
  /** True when nextDate is a booked appointment, false when it is only expected from the interval. */
  booked: boolean
  bookedVisit?: Visit
}

export function courseState(course: Course, visits: Visit[]): CourseState {
  const mine = visits.filter((v) => v.courseId === course.id)
  const done = mine.filter((v) => v.status === 'done').sort((a, b) => a.date.localeCompare(b.date))
  const scheduled = mine.filter((v) => v.status === 'scheduled').sort((a, b) => a.date.localeCompare(b.date))
  const remaining = Math.max(0, course.totalSessions - done.length)
  let nextDate = ''
  let booked = false
  let bookedVisit: Visit | undefined
  if (course.status === 'active' && remaining > 0) {
    if (scheduled.length) {
      bookedVisit = scheduled[0]
      nextDate = bookedVisit.date
      booked = true
    } else if (done.length) {
      nextDate = addDays(done[done.length - 1].date, course.intervalDays)
    } else {
      nextDate = course.startDate
    }
  }
  return { course, done, scheduled, remaining, nextDate, booked, bookedVisit }
}

/** Expected session dates for the rest of the course. Overdue sessions count as today. */
export function upcomingDates(s: CourseState): string[] {
  if (!s.nextDate) return []
  const t = today()
  const dates: string[] = []
  // booked appointments first, then fill the rest at the course interval
  for (const v of s.scheduled) if (dates.length < s.remaining) dates.push(v.date < t ? t : v.date)
  let last = dates.length ? s.scheduled[dates.length - 1].date : s.nextDate
  if (!dates.length) dates.push(last < t ? t : last)
  while (dates.length < s.remaining) {
    last = addDays(last < t ? t : last, s.course.intervalDays)
    dates.push(last)
  }
  return dates
}

/* ---------- stock ---------- */

export async function stockLevels(): Promise<Record<string, number>> {
  const levels: Record<string, number> = {}
  await db.stockMoves.each((m) => {
    levels[m.itemId] = (levels[m.itemId] ?? 0) + m.qty
  })
  return levels
}

export interface ForecastLine {
  item: StockItem
  inStock: number
  need: number
  short: number
}

/** What booked + expected sessions in the next `days` days will use, against stock on hand. */
export async function forecast(days: number): Promise<ForecastLine[]> {
  const [items, courses, visits, levels] = await Promise.all([
    db.stockItems.orderBy('sort').toArray(),
    db.courses.where('status').equals('active').toArray(),
    db.visits.toArray(),
    stockLevels(),
  ])
  const until = addDays(today(), days)
  const need: Record<string, number> = {}
  for (const c of courses) {
    const s = courseState(c, visits)
    const usage = currentUsage(c)
    for (const d of upcomingDates(s)) {
      if (d > until) break
      for (const [id, q] of Object.entries(usage)) need[id] = (need[id] ?? 0) + q
    }
  }
  // appointments that are not part of a course (consultations etc.) use nothing until logged
  return items
    .filter((i) => i.active)
    .map((item) => {
      const inStock = levels[item.id] ?? 0
      const n = need[item.id] ?? 0
      return { item, inStock, need: n, short: Math.max(0, n - inStock) }
    })
}

/* ---------- saving visits keeps stock in step ---------- */

export async function saveVisit(v: Visit) {
  await db.transaction('rw', db.visits, db.stockMoves, async () => {
    v.updatedAt = Date.now()
    await db.visits.put(v)
    await db.stockMoves.where('visitId').equals(v.id).delete()
    if (v.status !== 'done') return
    const moves = Object.entries(v.usage)
      .filter(([, q]) => q > 0)
      .map(([itemId, q]) => ({
        id: newId(),
        itemId,
        qty: -q,
        kind: 'used' as const,
        visitId: v.id,
        date: v.date,
        note: '',
        createdAt: Date.now(),
      }))
    await db.stockMoves.bulkAdd(moves)
  })
}

export async function deleteVisit(id: string) {
  await db.transaction('rw', [db.visits, db.stockMoves, db.photos, db.photoBlobs], async () => {
    const photoIds = (await db.photos.where('visitId').equals(id).primaryKeys()) as string[]
    await db.photoBlobs.bulkDelete(photoIds)
    await db.photos.bulkDelete(photoIds)
    await db.stockMoves.where('visitId').equals(id).delete()
    await db.visits.delete(id)
  })
}

export async function deletePatient(id: string) {
  await db.transaction('rw', [db.patients, db.courses, db.visits, db.stockMoves, db.photos, db.photoBlobs], async () => {
    const visitIds = (await db.visits.where('patientId').equals(id).primaryKeys()) as string[]
    for (const vid of visitIds) await db.stockMoves.where('visitId').equals(vid).delete()
    const photoIds = (await db.photos.where('patientId').equals(id).primaryKeys()) as string[]
    await db.photoBlobs.bulkDelete(photoIds)
    await db.photos.bulkDelete(photoIds)
    await db.visits.bulkDelete(visitIds)
    await db.courses.where('patientId').equals(id).delete()
    await db.patients.delete(id)
  })
}

export function usageText(u: Usage, items: StockItem[]) {
  const parts = items.filter((i) => (u[i.id] ?? 0) > 0).map((i) => `${u[i.id]} ${i.name}`)
  return parts.join(', ') || 'nothing'
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + '.')
    .join('')
}
