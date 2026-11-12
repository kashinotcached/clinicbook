import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, type Photo } from '../db'
import { courseState, currentUsage, fmtDate, relDay, today, usageText } from '../logic'
import { removePhoto } from '../photos'
import { Empty, Header, go } from '../ui'
import { PhotoViewer, Thumb } from './PhotoView'

export function PatientDetail({ id }: { id: string }) {
  const [tab, setTab] = useState<'visits' | 'photos'>('visits')
  const [viewer, setViewer] = useState<{ list: Photo[]; index: number } | null>(null)
  const data = useLiveQuery(async () => {
    const [patient, courses, visits, photos, items] = await Promise.all([
      db.patients.get(id),
      db.courses.where('patientId').equals(id).toArray(),
      db.visits.where('patientId').equals(id).toArray(),
      db.photos.where('patientId').equals(id).toArray(),
      db.stockItems.orderBy('sort').toArray(),
    ])
    return { patient, courses, visits, photos, items }
  }, [id])
  if (!data) return null
  const { patient, courses, visits, photos, items } = data
  if (!patient) return <Empty>Patient not found.</Empty>

  const states = courses
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .map((c) => courseState(c, visits))
  const sessionNo = new Map<string, number>()
  for (const s of states) s.done.forEach((v, i) => sessionNo.set(v.id, i + 1))
  const courseName = new Map(courses.map((c) => [c.id, c.treatment]))
  const sortedVisits = [...visits].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
  const visitDate = new Map(visits.map((v) => [v.id, v.date]))
  const photosByVisit = new Map<string, Photo[]>()
  for (const p of photos) photosByVisit.set(p.visitId, [...(photosByVisit.get(p.visitId) ?? []), p])

  const areas = [...new Set(photos.map((p) => p.area))]
  const byArea = (area: string) =>
    photos
      .filter((p) => p.area === area)
      .sort((a, b) => (visitDate.get(a.visitId) ?? '').localeCompare(visitDate.get(b.visitId) ?? '') || a.takenAt - b.takenAt)

  return (
    <>
      <Header
        title={patient.name}
        backTo="/patients"
        action={<button className="text-btn" onClick={() => go(`/patient/${id}/edit`)}>Edit</button>}
      />
      <main>
        <div className="card info">
          {patient.phone && (
            <a href={`tel:${patient.phone}`} className="phone">
              📞 {patient.phone}
            </a>
          )}
          <span className="sub">
            {[patient.age ? `${patient.age} yrs` : '', { M: 'Male', F: 'Female', O: 'Other', '': '' }[patient.gender]]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {patient.notes && <p className="notes">{patient.notes}</p>}
        </div>

        <section>
          <div className="section-head">
            <h2>Courses</h2>
            <button className="text-btn" onClick={() => go(`/course/new?patient=${id}`)}>+ New course</button>
          </div>
          {states.length === 0 && <Empty>No course yet.</Empty>}
          {states.map((s) => {
            const c = s.course
            const pct = Math.round((s.done.length / c.totalSessions) * 100)
            return (
              <div key={c.id} className={'card course ' + c.status}>
                <div className="course-top">
                  <strong>{c.treatment}</strong>
                  <span className="sub">
                    {s.done.length} of {c.totalSessions} done
                    {c.status !== 'active' ? ` · ${c.status}` : ''}
                  </span>
                </div>
                <div className="bar">
                  <span style={{ width: `${pct}%` }} />
                </div>
                <p className="sub">Each session: {usageText(currentUsage(c), items)}</p>
                {c.plan.length > 1 && (
                  <p className="sub">
                    Dose changed {fmtDate(c.plan[c.plan.length - 1].date)}
                    {c.plan[c.plan.length - 1].note ? ` — ${c.plan[c.plan.length - 1].note}` : ''}
                  </p>
                )}
                {s.nextDate && (
                  <p className={'next ' + (s.nextDate < today() ? 'late' : '')}>
                    Next: {fmtDate(s.nextDate)} ({relDay(s.nextDate)}) · {s.booked ? 'booked' : 'not booked yet'}
                  </p>
                )}
                {c.status === 'active' && (
                  <div className="btn-row">
                    <button className="primary small" onClick={() => go(`/visit/new?patient=${id}&course=${c.id}`)}>
                      Log session
                    </button>
                    {!s.booked && s.remaining > 0 && (
                      <button
                        className="secondary small"
                        onClick={() => go(`/visit/new?patient=${id}&course=${c.id}&book=1&date=${s.nextDate < today() ? today() : s.nextDate}`)}
                      >
                        Book next
                      </button>
                    )}
                    <button className="secondary small" onClick={() => go(`/course/${c.id}/dose`)}>
                      Change dose
                    </button>
                  </div>
                )}
                <button className="text-btn small-link" onClick={() => go(`/course/${c.id}/edit`)}>
                  Edit course
                </button>
              </div>
            )
          })}
        </section>

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'visits'} onClick={() => setTab('visits')}>
            Visits ({visits.length})
          </button>
          <button role="tab" aria-selected={tab === 'photos'} onClick={() => setTab('photos')}>
            Photos ({photos.length})
          </button>
        </div>

        {tab === 'visits' && (
          <section>
            <button className="secondary wide" onClick={() => go(`/visit/new?patient=${id}`)}>
              + Visit without a course
            </button>
            {sortedVisits.length === 0 && <Empty>No visits yet.</Empty>}
            <ul className="timeline">
              {sortedVisits.map((v) => {
                const ph = photosByVisit.get(v.id) ?? []
                return (
                  <li key={v.id} className={v.status}>
                    <a href={`#/visit/${v.id}`} className="tl-head">
                      <strong>{fmtDate(v.date)}</strong>
                      <span className="sub">
                        {v.courseId ? courseName.get(v.courseId) : 'Visit'}
                        {sessionNo.has(v.id) ? ` · session ${sessionNo.get(v.id)}` : ''}
                        {v.status === 'scheduled' ? ` · booked${v.time ? ' ' + v.time : ''}` : ''}
                        {v.status === 'missed' ? ' · missed' : ''}
                      </span>
                    </a>
                    {v.status === 'done' && <p className="sub">Used: {usageText(v.usage, items)}</p>}
                    {v.status === 'scheduled' && (
                      <a className="text-btn small-link" href={`#/remind/${v.id}`}>
                        {v.remindedAt ? '✓ Reminder sent · send again' : '💬 Send WhatsApp reminder'}
                      </a>
                    )}
                    {v.notes && <p className="notes">{v.notes}</p>}
                    {ph.length > 0 && (
                      <div className="thumbs">
                        {ph.map((p, i) => (
                          <Thumb key={p.id} photo={p} onClick={() => setViewer({ list: ph, index: i })} />
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {tab === 'photos' && (
          <section>
            {areas.length === 0 && <Empty>No photos yet. Add them when logging a session.</Empty>}
            <p className="hint">{areas.length > 0 && 'Each row is one area of the head, oldest first. Tap to compare.'}</p>
            {areas.map((area) => {
              const list = byArea(area)
              return (
                <div key={area} className="area-row">
                  <h3>{area}</h3>
                  <div className="thumbs scroll">
                    {list.map((p, i) => (
                      <div key={p.id} className="dated-thumb">
                        <Thumb photo={p} onClick={() => setViewer({ list, index: i })} />
                        <small>{fmtDate(visitDate.get(p.visitId) ?? '')}</small>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </section>
        )}
      </main>
      {viewer && (
        <PhotoViewer
          list={viewer.list}
          index={viewer.index}
          caption={(p) => `${p.area} · ${fmtDate(visitDate.get(p.visitId) ?? '')}`}
          onClose={() => setViewer(null)}
          onDelete={async (p) => {
            await removePhoto(p.id)
            setViewer(null)
          }}
        />
      )}
    </>
  )
}
