import { db, getSetting } from './db'
import { addDays, today } from './logic'

export interface TimeRange {
  from: string
  to: string
}

/** Opening hours per weekday ('0' = Sunday … '6' = Saturday); no ranges = closed that day. */
export interface ClinicHours {
  days: Record<string, TimeRange[]>
  slotMinutes: number
  /** How many patients can be seen in one slot. */
  perSlot: number
}

/** A closed period: holiday, leave, conference… `to` is inclusive. */
export interface Closure {
  id: string
  from: string
  to: string
  reason: string
}

const twoShifts = (): TimeRange[] => [
  { from: '10:00', to: '13:00' },
  { from: '17:00', to: '20:00' },
]

export const DEFAULT_HOURS: ClinicHours = {
  days: { '0': [], '1': twoShifts(), '2': twoShifts(), '3': twoShifts(), '4': twoShifts(), '5': twoShifts(), '6': twoShifts() },
  slotMinutes: 30,
  perSlot: 1,
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export async function loadClinic() {
  const [hours, closures] = await Promise.all([
    getSetting<ClinicHours>('clinicHours', DEFAULT_HOURS),
    getSetting<Closure[]>('closures', []),
  ])
  return { hours: { ...DEFAULT_HOURS, ...hours }, closures }
}

export function weekday(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/** Why the clinic is closed on this date, or null when it is open. */
export function closedReason(date: string, hours: ClinicHours, closures: Closure[]): string | null {
  const c = closures.find((x) => x.from <= date && date <= (x.to || x.from))
  if (c) return c.reason ? `Clinic closed: ${c.reason}` : 'Clinic closed'
  if (!(hours.days[String(weekday(date))] ?? []).length) return `Clinic closed on ${DAY_NAMES[weekday(date)]}s`
  return null
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
const toTime = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

/** Start times of all appointment slots on that date's weekday. */
export function slotTimes(date: string, hours: ClinicHours): string[] {
  const out: string[] = []
  const step = Math.max(5, hours.slotMinutes || 30)
  for (const r of hours.days[String(weekday(date))] ?? []) {
    for (let t = toMin(r.from); t + step <= toMin(r.to); t += step) out.push(toTime(t))
  }
  return out.sort()
}

/** Is this time inside the opening hours of that day? */
export function withinHours(date: string, time: string, hours: ClinicHours) {
  const t = toMin(time)
  return (hours.days[String(weekday(date))] ?? []).some((r) => toMin(r.from) <= t && t < toMin(r.to))
}

export interface DaySlots {
  date: string
  closed: string | null
  times: { time: string; booked: number; free: boolean }[]
}

/** Free and taken slots for each date from `from`, for `days` days. */
export async function slotsFrom(from: string, days: number, excludeVisitId?: string): Promise<DaySlots[]> {
  const to = addDays(from, days - 1)
  const [{ hours, closures }, visits] = await Promise.all([
    loadClinic(),
    db.visits.where('date').between(from, to, true, true).toArray(),
  ])
  const step = Math.max(5, hours.slotMinutes || 30)
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const t0 = today()
  const out: DaySlots[] = []
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i)
    const closed = closedReason(date, hours, closures)
    const starts = closed ? [] : slotTimes(date, hours)
    // a booking at an odd time (typed by hand) still takes the slot it falls in
    const taken: Record<string, number> = {}
    for (const v of visits) {
      if (v.date !== date || !v.time || v.status === 'missed' || v.id === excludeVisitId) continue
      const slot = starts.find((s) => toMin(s) <= toMin(v.time) && toMin(v.time) < toMin(s) + step)
      if (slot) taken[slot] = (taken[slot] ?? 0) + 1
    }
    const times = starts.map((time) => {
      const booked = taken[time] ?? 0
      const past = date < t0 || (date === t0 && toMin(time) <= nowMin)
      return { time, booked, free: !past && booked < Math.max(1, hours.perSlot || 1) }
    })
    out.push({ date, closed, times })
  }
  return out
}

/** The first free slot from today on (within 60 days). */
export async function nextFreeSlot(): Promise<{ date: string; time: string } | null> {
  for (const d of await slotsFrom(today(), 60)) {
    const t = d.times.find((x) => x.free)
    if (t) return { date: d.date, time: t.time }
  }
  return null
}

export function fmtTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
}
