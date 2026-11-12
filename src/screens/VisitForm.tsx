import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_PHOTO_AREAS, db, getSetting, newId, type Course, type Patient, type Photo, type StockItem, type Visit } from '../db'
import { addDays, courseState, deleteVisit, fmtDate, saveVisit, today, usageOn } from '../logic'
import { calendarUrl } from '../reminders'
import { closedReason, fmtTime, loadClinic, withinHours, type ClinicHours, type Closure } from '../slots'
import { SlotPicker } from './SlotPicker'
import { addPhoto, removePhoto } from '../photos'
import { Field, Header, UsageEditor } from '../ui'
import { Camera, type Shot } from './Camera'
import { PhotoViewer, Thumb } from './PhotoView'

interface Props {
  id?: string
  patientId?: string
  courseId?: string
  book?: boolean
  date?: string
}

export function VisitForm(props: Props) {
  const data = useLiveQuery(async () => {
    const visit = props.id ? await db.visits.get(props.id) : null
    const pid = visit?.patientId ?? props.patientId!
    const [patient, courses, visits, items, photos, areas, calName, calLink] = await Promise.all([
      db.patients.get(pid),
      db.courses.where('patientId').equals(pid).toArray(),
      db.visits.where('patientId').equals(pid).toArray(),
      db.stockItems.orderBy('sort').toArray(),
      visit ? db.photos.where('visitId').equals(visit.id).toArray() : Promise.resolve([] as Photo[]),
      getSetting<string[]>('photoAreas', DEFAULT_PHOTO_AREAS),
      getSetting<'initials' | 'full' | 'none'>('calendarName', 'initials'),
      getSetting<boolean>('calendarLink', true),
    ])
    return { visit, patient, courses, visits, items, photos, areas, calName, calLink, clinic: await loadClinic() }
  }, [props.id, props.patientId])
  if (!data || !data.patient || (props.id && !data.visit)) return null
  return <Inner {...props} {...data} patient={data.patient} />
}

function Inner({
  visit,
  patient,
  courses,
  visits,
  items,
  photos,
  areas,
  calName,
  calLink,
  clinic,
  courseId,
  book,
  date,
}: Props & {
  visit: Visit | null | undefined
  patient: Patient
  courses: Course[]
  visits: Visit[]
  items: StockItem[]
  photos: Photo[]
  areas: string[]
  calName: 'initials' | 'full' | 'none'
  calLink: boolean
  clinic: { hours: ClinicHours; closures: Closure[] }
}) {
  const isNew = !visit
  const activeCourses = courses.filter((c) => c.status === 'active' || c.id === visit?.courseId)
  const [v, setV] = useState<Visit>(() => {
    if (visit) return { ...visit }
    const cid = courseId ?? (activeCourses.length === 1 ? activeCourses[0].id : null)
    const course = courses.find((c) => c.id === cid)
    const d = date ?? today()
    return {
      id: newId(),
      patientId: patient.id,
      courseId: cid,
      date: d,
      time: '',
      status: book ? 'scheduled' : 'done',
      usage: course && !book ? { ...usageOn(course, d) } : {},
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  })
  const course = courses.find((c) => c.id === v.courseId)
  // the date the booking aims for (due date of the session, or today), kept while times are picked
  const [target] = useState(v.date)
  const [pending, setPending] = useState<Shot[]>([])
  const [cameraAt, setCameraAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [viewer, setViewer] = useState<number | null>(null)

  // after logging a session, offer to book the next one
  const state = course ? courseState(course, visits.filter((x) => x.id !== v.id)) : null
  const willRemain = state ? state.remaining - (v.status === 'done' ? 1 : 0) : 0
  const alreadyBooked = state ? state.scheduled.length > 0 : false
  const [bookNext, setBookNext] = useState(false)
  const [nextDate, setNextDate] = useState('')
  const [nextTime, setNextTime] = useState('')
  const [nextDue, setNextDue] = useState('')
  const [nextToCalendar, setNextToCalendar] = useState(true)
  const [nextId] = useState(newId)
  useEffect(() => {
    if (!course) return
    const due = addDays(v.date, course.intervalDays)
    setNextDue(due)
    setNextDate(due)
    setNextTime('')
  }, [v.date, course])

  const pendingRef = useRef(pending)
  pendingRef.current = pending
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url)), [])

  const set = (patch: Partial<Visit>) => setV((cur) => ({ ...cur, ...patch }))

  function setStatus(status: Visit['status']) {
    // when marking a booked visit done, fill in the course's dose for that day
    if (status === 'done' && Object.values(v.usage).every((q) => !q) && course) set({ status, usage: { ...usageOn(course, v.date) } })
    else set({ status })
  }

  function setCourse(cid: string) {
    const c = courses.find((x) => x.id === cid)
    set({ courseId: cid || null, usage: c && v.status === 'done' ? { ...usageOn(c, v.date) } : v.usage })
  }

  function addFiles(area: string, files: FileList | null) {
    if (!files) return
    setPending((cur) => [...cur, ...Array.from(files).map((file) => ({ key: newId(), area, file, url: URL.createObjectURL(file) }))])
  }

  async function save() {
    setBusy(true)
    try {
      const toSave = { ...v, usage: v.status === 'done' ? v.usage : {} }
      await saveVisit(toSave)
      for (const p of pending) await addPhoto(patient.id, v.id, p.area, p.file)
      if (bookNext && course && nextDate && v.status === 'done') {
        await saveVisit({
          id: nextId,
          patientId: patient.id,
          courseId: course.id,
          date: nextDate,
          time: nextTime,
          status: 'scheduled',
          usage: {},
          notes: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
      }
      if (course && v.status === 'done' && willRemain === 0 && course.status === 'active') {
        if (confirm(`That was the last of ${course.totalSessions} sessions. Mark the ${course.treatment} course as completed?`))
          await db.courses.update(course.id, { status: 'completed', updatedAt: Date.now() })
      }
      location.replace(`#/patient/${patient.id}`)
    } catch (e) {
      alert((e as Error).message)
      setBusy(false)
    }
  }

  async function remove() {
    if (!visit) return
    if (!confirm('Delete this visit and its photos? Stock it used goes back on the shelf.')) return
    await deleteVisit(visit.id)
    location.replace(`#/patient/${patient.id}`)
  }

  const calUrl = useMemo(
    () =>
      v.status === 'scheduled' && v.date ? calendarUrl({ visit: v, patient, course, calName, withLink: calLink }) : '',
    [v, calName, calLink, patient, course],
  )
  const nextCalUrl =
    bookNext && nextToCalendar && course && nextDate && v.status === 'done'
      ? calendarUrl({ visit: { id: nextId, date: nextDate, time: nextTime }, patient, course, calName, withLink: calLink })
      : ''

  /** Opening Google Calendar has to happen in the tap itself, or the phone blocks it; the save runs alongside. */
  function saveAndOpen(url: string) {
    void save()
    if (url) window.open(url, '_blank', 'noopener')
  }

  const dateWarning =
    closedReason(v.date, clinic.hours, clinic.closures) ??
    (v.time && !withinHours(v.date, v.time, clinic.hours) ? 'This time is outside clinic hours.' : null)

  const savedPhotos = photos
  return (
    <>
      <Header title={isNew ? (v.status === 'scheduled' ? 'Book visit' : 'Log visit') : 'Visit'} backTo={`/patient/${patient.id}`} />
      <main>
        <p className="for">
          <strong>{patient.name}</strong>
          {course && state && ` · ${course.treatment} session ${Math.min(state.done.length + 1, course.totalSessions)} of ${course.totalSessions}`}
        </p>
        <div className="form">
          <div className="segmented" role="group" aria-label="Status">
            <button type="button" aria-pressed={v.status === 'done'} onClick={() => setStatus('done')}>
              Done
            </button>
            <button type="button" aria-pressed={v.status === 'scheduled'} onClick={() => setStatus('scheduled')}>
              Booked
            </button>
            <button type="button" aria-pressed={v.status === 'missed'} onClick={() => setStatus('missed')}>
              Missed
            </button>
          </div>
          {v.status === 'scheduled' && (
            <SlotPicker target={target} date={v.date} time={v.time} excludeVisitId={v.id} onPick={(date, time) => set({ date, time })} />
          )}
          <div className="two">
            <Field label="Date">
              <input type="date" value={v.date} onChange={(e) => set({ date: e.target.value })} />
            </Field>
            <Field label={v.status === 'scheduled' ? 'Time' : 'Time (optional)'}>
              <input type="time" value={v.time} onChange={(e) => set({ time: e.target.value })} />
            </Field>
          </div>
          {v.status === 'scheduled' && dateWarning && <p className="alert warn"><span>{dateWarning}</span></p>}
          <Field label="Course">
            <select value={v.courseId ?? ''} onChange={(e) => setCourse(e.target.value)}>
              {activeCourses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.treatment} (started {fmtDate(c.startDate)})
                </option>
              ))}
              <option value="">No course (consultation / other)</option>
            </select>
          </Field>

          {v.status === 'done' && (
            <Field label="Used in this session" hint="Comes off stock automatically.">
              <UsageEditor items={items} value={v.usage} onChange={(u) => set({ usage: u })} />
            </Field>
          )}

          {v.status !== 'scheduled' && (
            <Field label="Photos">
              <button type="button" className="primary camera-open" onClick={() => setCameraAt(areas[0])}>
                📷 Take photos
              </button>
              <div className="photo-areas">
                {areas.map((area) => {
                  const saved = savedPhotos.filter((p) => p.area === area)
                  const queued = pending.filter((p) => p.area === area)
                  return (
                    <div key={area} className="photo-area">
                      <div className="photo-area-head">
                        <span>{area}</span>
                        <span className="photo-area-actions">
                          <button type="button" className="text-btn" onClick={() => setCameraAt(area)}>
                            Camera
                          </button>
                          <label className="text-btn">
                            <input type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(area, e.target.files)} />
                            Upload
                          </label>
                        </span>
                      </div>
                      <div className="thumbs">
                        {saved.map((p) => (
                          <Thumb key={p.id} photo={p} onClick={() => setViewer(savedPhotos.indexOf(p))} />
                        ))}
                        {queued.map((p) => (
                          <button
                            key={p.key}
                            type="button"
                            className="thumb"
                            onClick={() => setPending((cur) => cur.filter((x) => x.key !== p.key))}
                            aria-label="Remove photo"
                          >
                            <img src={p.url} alt={area} />
                            <span className="thumb-label">✕ remove</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Field>
          )}

          <Field label="Notes">
            <textarea rows={3} value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>

          {course && v.status === 'done' && willRemain > 0 && !alreadyBooked && (
            <div className="card book-next">
              <label className="check">
                <input type="checkbox" checked={bookNext} onChange={(e) => setBookNext(e.target.checked)} />
                Book the next session ({willRemain} left)
              </label>
              {bookNext && (
                <>
                  <SlotPicker
                    target={nextDue}
                    date={nextDate}
                    time={nextTime}
                    onPick={(d, t) => {
                      setNextDate(d)
                      setNextTime(t)
                    }}
                  />
                  <p className="sub">
                    {nextTime ? `Booking ${fmtDate(nextDate)} at ${fmtTime(nextTime)}` : `Pick a time above, or it is booked for ${fmtDate(nextDate)} without a time.`}
                  </p>
                  <label className="check">
                    <input type="checkbox" checked={nextToCalendar} onChange={(e) => setNextToCalendar(e.target.checked)} />
                    Also add it to Google Calendar
                  </label>
                </>
              )}
            </div>
          )}

          {calUrl && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => saveAndOpen(calUrl)}
            >
              Save and add to Google Calendar
            </button>
          )}

          {!isNew && visit?.status === 'scheduled' && (
            <a className="wa-btn" href={`#/remind/${v.id}`}>
              WhatsApp reminder
            </a>
          )}
          <button className="primary" disabled={busy} onClick={() => saveAndOpen(nextCalUrl)}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {!isNew && (
            <button className="danger-link" onClick={remove}>
              Delete visit
            </button>
          )}
        </div>
      </main>
      {cameraAt && (
        <Camera
          areas={areas}
          startArea={cameraAt}
          patientId={patient.id}
          visitId={v.id}
          onClose={() => setCameraAt(null)}
          onDone={(shots) => {
            setPending((cur) => [...cur, ...shots])
            setCameraAt(null)
          }}
        />
      )}
      {viewer !== null && (
        <PhotoViewer
          list={savedPhotos}
          index={viewer}
          caption={(p) => p.area}
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
