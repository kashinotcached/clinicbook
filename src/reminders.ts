import type { Course, Patient, Visit } from './db'
import { addDays, initials } from './logic'

export const DEFAULT_TEMPLATE =
  'Hello {first}, this is a reminder of your {treatment} appointment on {when} at {clinic}. Please reply to confirm, or let us know if you need another time.'

export interface ReminderSettings {
  template: string
  clinic: string
  countryCode: string
}

export const DEFAULT_REMINDER: ReminderSettings = { template: DEFAULT_TEMPLATE, clinic: '', countryCode: '91' }

export function whenText(v: Pick<Visit, 'date' | 'time'>) {
  const [y, m, d] = v.date.split('-').map(Number)
  let s = new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
  if (v.time) {
    const [h, min] = v.time.split(':').map(Number)
    s += ' at ' + new Date(2000, 0, 1, h, min).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
  }
  return s
}

export function reminderMessage(
  r: ReminderSettings,
  patient: Patient,
  visit: Visit,
  course: Course | undefined,
  sessionNo: number | null,
) {
  const values: Record<string, string> = {
    name: patient.name,
    first: patient.name.split(/\s+/)[0] ?? patient.name,
    treatment: course?.treatment ?? '',
    session: sessionNo && course ? `session ${sessionNo} of ${course.totalSessions}` : '',
    when: whenText(visit),
    clinic: r.clinic.trim() || 'the clinic',
  }
  return (r.template || DEFAULT_TEMPLATE)
    .replace(/\{(\w+)\}/g, (all, k: string) => values[k] ?? all)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.])/g, '$1')
    .trim()
}

/** WhatsApp wants the full international number, digits only: 98200 12345 -> 919820012345 */
export function waNumber(phone: string, countryCode: string) {
  let d = phone.replace(/\D/g, '')
  if (!d) return ''
  if (phone.trim().startsWith('+')) return d
  if (d.startsWith('00')) return d.slice(2)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  if (d.length === 10) return (countryCode.replace(/\D/g, '') || '91') + d
  return d
}

/** Without a number WhatsApp asks who to send it to. */
export function waLink(number: string, text: string) {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}

/** Link back into this app for one appointment. Only a random id, nothing about the patient. */
export function remindLink(visitId: string) {
  return `${location.origin}${location.pathname}#/remind/${visitId}`
}

export function calendarUrl(opts: {
  visit: Pick<Visit, 'id' | 'date' | 'time'>
  patient: Patient
  course: Course | undefined
  calName: 'initials' | 'full' | 'none'
  withLink: boolean
}) {
  const { visit, patient, course, calName } = opts
  const who = calName === 'full' ? patient.name : calName === 'initials' ? initials(patient.name) : ''
  const title = [course ? `${course.treatment} session` : 'Appointment', who].filter(Boolean).join(' – ')
  const d = visit.date.replaceAll('-', '')
  let dates: string
  if (visit.time) {
    const [h, m] = visit.time.split(':').map(Number)
    const end = new Date(2000, 0, 1, h, m + 30)
    const t2 = `${String(end.getHours()).padStart(2, '0')}${String(end.getMinutes()).padStart(2, '0')}00`
    dates = `${d}T${visit.time.replace(':', '')}00/${d}T${t2}`
  } else {
    dates = `${d}/${addDays(visit.date, 1).replaceAll('-', '')}`
  }
  let url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dates}`
  if (opts.withLink) url += `&details=${encodeURIComponent(`Send WhatsApp reminder: ${remindLink(visit.id)}`)}`
  return url
}
