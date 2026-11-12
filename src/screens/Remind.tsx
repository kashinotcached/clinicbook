import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, getSetting, type Course, type Patient, type Visit } from '../db'
import { courseState, fmtDate, relDay } from '../logic'
import { DEFAULT_REMINDER, reminderMessage, waLink, waNumber, whenText, type ReminderSettings } from '../reminders'
import { Empty, Header, go } from '../ui'

/** Opened from the link in a Google Calendar entry, or the WhatsApp button on Today. */
export function Remind({ id }: { id: string }) {
  const data = useLiveQuery(async () => {
    const visit = await db.visits.get(id)
    if (!visit) return { visit: null }
    const [patient, course, visits, settings] = await Promise.all([
      db.patients.get(visit.patientId),
      visit.courseId ? db.courses.get(visit.courseId) : Promise.resolve(undefined),
      db.visits.where('patientId').equals(visit.patientId).toArray(),
      getSetting<ReminderSettings>('reminder', DEFAULT_REMINDER),
    ])
    let sessionNo: number | null = null
    if (course) {
      const s = courseState(course, visits)
      const idx = s.scheduled.findIndex((x) => x.id === visit.id)
      sessionNo = visit.status === 'done' ? s.done.findIndex((x) => x.id === visit.id) + 1 : s.done.length + 1 + Math.max(0, idx)
    }
    return { visit, patient, course, sessionNo, settings: { ...DEFAULT_REMINDER, ...settings } }
  }, [id])
  if (!data) return null
  if (!data.visit || !data.patient)
    return (
      <>
        <Header title="Reminder" backTo="/today" />
        <main>
          <Empty>This appointment is not on this phone. It may have been deleted, or booked on another phone.</Empty>
        </main>
      </>
    )
  return <Inner {...data} visit={data.visit} patient={data.patient} />
}

function Inner({
  visit,
  patient,
  course,
  sessionNo,
  settings,
}: {
  visit: Visit
  patient: Patient
  course: Course | undefined
  sessionNo: number | null
  settings: ReminderSettings
}) {
  const [text, setText] = useState(() => reminderMessage(settings, patient, visit, course, sessionNo))
  const number = waNumber(patient.phone, settings.countryCode)
  const markSent = () => db.visits.update(visit.id, { remindedAt: Date.now() })

  return (
    <>
      <Header title="Reminder" backTo="/today" />
      <main>
        <div className="card">
          <strong>{patient.name}</strong>
          <span className="sub">
            {course ? `${course.treatment}${sessionNo ? ` · session ${sessionNo} of ${course.totalSessions}` : ''}` : 'Appointment'}
          </span>
          <p className="next">
            {whenText(visit)} ({relDay(visit.date)})
          </p>
          {visit.status !== 'scheduled' && (
            <p className="hint">This appointment is marked {visit.status === 'done' ? 'done' : 'missed'}.</p>
          )}
          {visit.remindedAt && <p className="hint">Reminder opened in WhatsApp {new Date(visit.remindedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.</p>}
        </div>

        <div className="form">
          <label className="field">
            <span className="field-label">Message</span>
            <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
            <span className="hint">Change the usual wording in Settings → WhatsApp reminders.</span>
          </label>

          {number ? (
            <a className="wa-btn" href={waLink(number, text)} target="_blank" rel="noreferrer" onClick={markSent}>
              Send on WhatsApp to {patient.phone}
            </a>
          ) : (
            <>
              <p className="alert warn">
                <strong>No phone number saved for {patient.name}.</strong>
                <span>Add it to the patient, or pick the contact in WhatsApp.</span>
              </p>
              <a className="wa-btn" href={waLink('', text)} target="_blank" rel="noreferrer" onClick={markSent}>
                Open WhatsApp and pick the contact
              </a>
            </>
          )}
          <div className="btn-row">
            {patient.phone && (
              <a className="secondary as-btn" href={`tel:${patient.phone}`}>
                Call
              </a>
            )}
            <button className="secondary" onClick={() => go(`/visit/${visit.id}`)}>
              Open appointment
            </button>
          </div>
          <p className="hint">Booked for {fmtDate(visit.date)}. WhatsApp opens with the message written; tap send there.</p>
        </div>
      </main>
    </>
  )
}
