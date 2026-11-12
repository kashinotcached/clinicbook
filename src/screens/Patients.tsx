import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, newId, type Patient } from '../db'
import { courseState, deletePatient } from '../logic'
import { Empty, Field, Header, back, go } from '../ui'

export function Patients() {
  const [q, setQ] = useState('')
  const rows = useLiveQuery(async () => {
    const [patients, courses, visits] = await Promise.all([
      db.patients.orderBy('name').toArray(),
      db.courses.toArray(),
      db.visits.toArray(),
    ])
    return patients.map((p) => {
      const active = courses
        .filter((c) => c.patientId === p.id && c.status === 'active')
        .map((c) => courseState(c, visits))
      return { p, active }
    })
  })
  if (!rows) return null
  const needle = q.trim().toLowerCase()
  const digits = needle.replace(/\D/g, '')
  const shown = needle
    ? rows.filter(
        ({ p }) => p.name.toLowerCase().includes(needle) || (digits !== '' && p.phone.replace(/\D/g, '').includes(digits)),
      )
    : rows

  return (
    <>
      <Header title="Patients" action={<button className="text-btn" onClick={() => go('/patients/new')}>+ Add</button>} />
      <main>
        <input className="search" type="search" placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        {shown.length === 0 ? (
          <Empty>{rows.length ? 'No patient matches.' : 'No patients yet. Tap “+ Add”.'}</Empty>
        ) : (
          <ul className="list">
            {shown.map(({ p, active }) => (
              <li key={p.id}>
                <a className="row" href={`#/patient/${p.id}`}>
                  <div>
                    <strong>{p.name}</strong>
                    <span className="sub">
                      {active.length
                        ? active.map((s) => `${s.course.treatment} ${s.done.length}/${s.course.totalSessions}`).join(' · ')
                        : 'No active course'}
                      {p.phone ? ` · ${p.phone}` : ''}
                    </span>
                  </div>
                  <span className="chev">›</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}

export function PatientForm({ id }: { id?: string }) {
  const existing = useLiveQuery(async () => (id ? ((await db.patients.get(id)) ?? null) : null), [id])
  if (id && existing === undefined) return null
  return <PatientFormInner initial={existing ?? null} />
}

function PatientFormInner({ initial }: { initial: Patient | null }) {
  const [p, setP] = useState<Patient>(
    initial ?? { id: newId(), name: '', phone: '', gender: '', notes: '', createdAt: Date.now(), updatedAt: Date.now() },
  )
  const set = (patch: Partial<Patient>) => setP({ ...p, ...patch })

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!p.name.trim()) return
    await db.patients.put({ ...p, name: p.name.trim(), phone: p.phone.trim(), updatedAt: Date.now() })
    if (initial) back(`/patient/${p.id}`)
    else location.replace(`#/course/new?patient=${p.id}&first=1`)
  }

  async function remove() {
    if (!initial) return
    if (!confirm(`Delete ${initial.name} with all courses, visits and photos? This cannot be undone.`)) return
    await deletePatient(initial.id)
    location.replace('#/patients')
  }

  return (
    <>
      <Header title={initial ? 'Edit patient' : 'New patient'} backTo="/patients" />
      <main>
        <form onSubmit={save} className="form">
          <Field label="Name">
            <input required autoFocus={!initial} value={p.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input type="tel" inputMode="tel" value={p.phone} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
          <div className="two">
            <Field label="Age">
              <input inputMode="numeric" value={p.age ?? ''} onChange={(e) => set({ age: parseInt(e.target.value) || undefined })} />
            </Field>
            <Field label="Gender">
              <select value={p.gender} onChange={(e) => set({ gender: e.target.value as Patient['gender'] })}>
                <option value="">—</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="O">Other</option>
              </select>
            </Field>
          </div>
          <Field label="Notes" hint="History, allergies, medication, anything to remember.">
            <textarea rows={4} value={p.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
          <button className="primary" type="submit">
            {initial ? 'Save' : 'Save and start a course'}
          </button>
          {!initial && (
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                if (!p.name.trim()) return
                await db.patients.put({ ...p, name: p.name.trim(), updatedAt: Date.now() })
                location.replace(`#/patient/${p.id}`)
              }}
            >
              Save without a course
            </button>
          )}
          {initial && (
            <button type="button" className="danger-link" onClick={remove}>
              Delete patient
            </button>
          )}
        </form>
      </main>
    </>
  )
}
