import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, newId, type Course, type StockItem, type Treatment, type Usage } from '../db'
import { currentUsage, deleteVisit, fmtDate, today, usageText } from '../logic'
import { Field, Header, Stepper, UsageEditor, back, go } from '../ui'

export function CourseForm({ id, patientId, first }: { id?: string; patientId?: string; first?: boolean }) {
  const data = useLiveQuery(async () => {
    const [course, treatments, items] = await Promise.all([
      id ? db.courses.get(id) : Promise.resolve(null),
      db.treatments.orderBy('sort').toArray(),
      db.stockItems.orderBy('sort').toArray(),
    ])
    const pid = course?.patientId ?? patientId!
    return { course, treatments, items, patient: await db.patients.get(pid) }
  }, [id, patientId])
  if (!data || !data.patient) return null
  return <Inner {...data} patient={data.patient} first={first} />
}

function Inner({
  course,
  treatments,
  items,
  patient,
  first,
}: {
  course: Course | null | undefined
  treatments: Treatment[]
  items: StockItem[]
  patient: { id: string; name: string }
  first?: boolean
}) {
  const t0 = treatments[0]
  const [c, setC] = useState<Course>(
    course ?? {
      id: newId(),
      patientId: patient.id,
      treatmentId: t0?.id ?? '',
      treatment: t0?.name ?? '',
      totalSessions: t0?.sessions ?? 6,
      intervalDays: t0?.intervalDays ?? 30,
      startDate: today(),
      status: 'active',
      plan: [{ date: today(), usage: { ...(t0?.usage ?? {}) } }],
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  )
  const set = (patch: Partial<Course>) => setC({ ...c, ...patch })
  const isNew = !course

  function pickTreatment(tid: string) {
    const t = treatments.find((x) => x.id === tid)
    if (!t) return
    set({
      treatmentId: t.id,
      treatment: t.name,
      totalSessions: t.sessions,
      intervalDays: t.intervalDays,
      plan: [{ date: c.startDate, usage: { ...t.usage } }],
    })
  }

  async function save(logNow: boolean) {
    const plan = isNew ? [{ ...c.plan[0], date: c.startDate }] : c.plan
    await db.courses.put({ ...c, plan, updatedAt: Date.now() })
    if (logNow) location.replace(`#/visit/new?patient=${patient.id}&course=${c.id}`)
    else if (isNew) location.replace(`#/patient/${patient.id}`)
    else back(`/patient/${patient.id}`)
  }

  async function remove() {
    if (!course) return
    const visits = await db.visits.where('courseId').equals(course.id).toArray()
    if (!confirm(`Delete this ${course.treatment} course${visits.length ? ` and its ${visits.length} visit(s)` : ''}? Stock used by those visits goes back on the shelf. This cannot be undone.`))
      return
    for (const v of visits) await deleteVisit(v.id)
    await db.courses.delete(course.id)
    location.replace(`#/patient/${patient.id}`)
  }

  return (
    <>
      <Header title={isNew ? 'New course' : 'Edit course'} backTo={`/patient/${patient.id}`} />
      <main>
        <p className="for">for <strong>{patient.name}</strong></p>
        <div className="form">
          {isNew && (
            <Field label="Treatment">
              <div className="segmented">
                {treatments.map((t) => (
                  <button key={t.id} type="button" aria-pressed={c.treatmentId === t.id} onClick={() => pickTreatment(t.id)}>
                    {t.name}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <div className="two">
            <Field label="Sessions in course">
              <Stepper min={1} value={c.totalSessions} onChange={(n) => set({ totalSessions: n })} />
            </Field>
            <Field label="Days between sessions">
              <Stepper min={1} value={c.intervalDays} onChange={(n) => set({ intervalDays: n })} />
            </Field>
          </div>
          <Field label="Start date">
            <input type="date" value={c.startDate} onChange={(e) => set({ startDate: e.target.value })} />
          </Field>
          {isNew ? (
            <Field label="Each session uses" hint="Change it later with “Change dose”, e.g. 4 bottles down to 2.">
              <UsageEditor items={items} value={c.plan[0].usage} onChange={(u) => set({ plan: [{ ...c.plan[0], usage: u }] })} />
            </Field>
          ) : (
            <>
              <Field label="Status">
                <select value={c.status} onChange={(e) => set({ status: e.target.value as Course['status'] })}>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="stopped">Stopped (patient discontinued)</option>
                </select>
              </Field>
              <p className="sub">Each session: {usageText(currentUsage(c), items)} — use “Change dose” on the patient page to change it.</p>
            </>
          )}
          <Field label="Notes">
            <textarea rows={3} value={c.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
          {isNew ? (
            <>
              <button className="primary" onClick={() => save(true)}>
                Save and log {first ? 'today’s' : 'a'} session
              </button>
              <button className="secondary" onClick={() => save(false)}>
                Save only
              </button>
            </>
          ) : (
            <>
              <button className="primary" onClick={() => save(false)}>
                Save
              </button>
              <button className="danger-link" onClick={remove}>
                Delete course
              </button>
            </>
          )}
        </div>
      </main>
    </>
  )
}

export function DoseChange({ id }: { id: string }) {
  const data = useLiveQuery(async () => {
    const course = await db.courses.get(id)
    return { course, items: await db.stockItems.orderBy('sort').toArray() }
  }, [id])
  if (!data?.course) return null
  return <DoseInner course={data.course} items={data.items} />
}

function DoseInner({ course, items }: { course: Course; items: StockItem[] }) {
  const [usage, setUsage] = useState<Usage>({ ...currentUsage(course) })
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')

  async function save() {
    // a change dated before an existing step replaces the later steps
    const plan = course.plan.filter((s) => s.date < date)
    plan.push({ date, usage, note: note.trim() || undefined })
    await db.courses.put({ ...course, plan, updatedAt: Date.now() })
    back(`/patient/${course.patientId}`)
  }

  return (
    <>
      <Header title="Change dose" backTo={`/patient/${course.patientId}`} />
      <main>
        <div className="form">
          <div className="card">
            <h3>History</h3>
            <ul className="plain">
              {course.plan.map((s, i) => (
                <li key={i}>
                  From {fmtDate(s.date)}: {usageText(s.usage, items)}
                  {s.note ? ` — ${s.note}` : ''}
                </li>
              ))}
            </ul>
          </div>
          <Field label="From date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Each session now uses">
            <UsageEditor items={items} value={usage} onChange={setUsage} />
          </Field>
          <Field label="Reason (optional)">
            <input placeholder="e.g. good improvement" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <p className="hint">Sessions already logged keep what they actually used. The stock forecast uses the new dose from now on.</p>
          <button className="primary" onClick={save}>
            Save new dose
          </button>
          <button className="secondary" onClick={() => go(`/patient/${course.patientId}`)}>
            Cancel
          </button>
        </div>
      </main>
    </>
  )
}
