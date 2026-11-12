import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db, type Visit } from '../db'
import { backupAgeDays } from '../backup'
import { addDays, courseState, fmtDate, forecast, relDay, today, type CourseState } from '../logic'
import { Empty, Header, go } from '../ui'

export function Today() {
  const data = useLiveQuery(async () => {
    const [patients, courses, visits] = await Promise.all([
      db.patients.toArray(),
      db.courses.where('status').equals('active').toArray(),
      db.visits.toArray(),
    ])
    const names = new Map(patients.map((p) => [p.id, p.name]))
    const states = courses.map((c) => courseState(c, visits)).filter((s) => s.nextDate)
    // appointments that are not part of a course
    const loose = visits.filter((v) => v.status === 'scheduled' && !v.courseId)
    const short = (await forecast(30)).filter((f) => f.short > 0 || f.inStock <= f.item.lowAt)
    return { names, states, loose, short, patientCount: patients.length }
  })
  const [backupAge, setBackupAge] = useState<number | null | undefined>(undefined)
  useEffect(() => {
    backupAgeDays().then(setBackupAge)
  }, [])

  if (!data) return null
  const t = today()
  const week = addDays(t, 7)
  const overdue = data.states.filter((s) => s.nextDate < t).sort(byDate)
  const due = data.states.filter((s) => s.nextDate === t)
  const soon = data.states.filter((s) => s.nextDate > t && s.nextDate <= week).sort(byDate)
  const looseToday = data.loose.filter((v) => v.date === t)
  const looseSoon = data.loose.filter((v) => v.date > t && v.date <= week)

  const row = (s: CourseState) => (
    <li key={s.course.id} className="with-action">
      <a href={`#/patient/${s.course.patientId}`} className="row">
        <div>
          <strong>{data.names.get(s.course.patientId)}</strong>
          <span className="sub">
            {s.course.treatment} · session {s.done.length + 1} of {s.course.totalSessions}
            {s.bookedVisit?.time ? ` · ${s.bookedVisit.time}` : ''}
          </span>
        </div>
        <span className={'tag ' + (s.booked ? 'booked' : 'expected')}>
          {s.nextDate === t ? (s.booked ? 'booked' : 'due') : relDay(s.nextDate)}
        </span>
      </a>
      {s.bookedVisit && <RemindButton v={s.bookedVisit} />}
    </li>
  )

  return (
    <>
      <Header title="Today" action={<span className="date-chip">{fmtDate(t)}</span>} />
      <main>
        {backupAge !== undefined && data.patientCount > 0 && (backupAge === null || backupAge >= 7) && (
          <a className="alert warn" href="#/settings">
            <strong>{backupAge === null ? 'No backup yet' : `Last backup ${backupAge} days ago`}</strong>
            <span>If this phone is lost, records without a backup are gone. Tap to back up.</span>
          </a>
        )}
        {data.short.length > 0 && (
          <a className="alert danger" href="#/stock">
            <strong>Stock to order</strong>
            <span>
              {data.short
                .map((f) => (f.short > 0 ? `${f.item.name}: need ${f.need}, have ${f.inStock}` : `${f.item.name}: only ${f.inStock} left`))
                .join(' · ')}
            </span>
          </a>
        )}

        <section>
          <h2>Due today</h2>
          {due.length + looseToday.length === 0 ? (
            <Empty>No sessions due today.</Empty>
          ) : (
            <ul className="list">
              {due.map(row)}
              {looseToday.map((v) => (
                <li key={v.id} className="with-action">
                  <a href={`#/visit/${v.id}`} className="row">
                    <div>
                      <strong>{data.names.get(v.patientId)}</strong>
                      <span className="sub">Appointment{v.time ? ` · ${v.time}` : ''}</span>
                    </div>
                    <span className="tag booked">booked</span>
                  </a>
                  <RemindButton v={v} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {overdue.length > 0 && (
          <section>
            <h2>Overdue</h2>
            <p className="hint">Next session date passed and no appointment booked.</p>
            <ul className="list">{overdue.map(row)}</ul>
          </section>
        )}

        <section>
          <h2>Next 7 days</h2>
          {soon.length + looseSoon.length === 0 ? (
            <Empty>Nothing in the next week.</Empty>
          ) : (
            <ul className="list">
              {soon.map(row)}
              {looseSoon.map((v) => (
                <li key={v.id} className="with-action">
                  <a href={`#/visit/${v.id}`} className="row">
                    <div>
                      <strong>{data.names.get(v.patientId)}</strong>
                      <span className="sub">Appointment · {fmtDate(v.date)}</span>
                    </div>
                    <span className="tag booked">{relDay(v.date)}</span>
                  </a>
                  <RemindButton v={v} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <button className="fab" onClick={() => go('/patients/new')}>
          + New patient
        </button>
      </main>
    </>
  )
}

function RemindButton({ v }: { v: Visit }) {
  return (
    <a
      className={'wa-mini' + (v.remindedAt ? ' sent' : '')}
      href={`#/remind/${v.id}`}
      aria-label={v.remindedAt ? 'Reminder sent; send again' : 'Send WhatsApp reminder'}
      title={v.remindedAt ? 'Reminder sent' : 'Send WhatsApp reminder'}
    >
      {v.remindedAt ? '✓' : '💬'}
    </a>
  )
}

const byDate = (a: CourseState, b: CourseState) => a.nextDate.localeCompare(b.nextDate)
