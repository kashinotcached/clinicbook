import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { newId, setSetting } from '../db'
import { fmtDate, today } from '../logic'
import { DAY_NAMES, loadClinic, type ClinicHours, type Closure, type TimeRange } from '../slots'
import { Empty, Field, Header, Stepper } from '../ui'

const ORDER = [1, 2, 3, 4, 5, 6, 0] // Monday first

export function ClinicHoursPage() {
  const data = useLiveQuery(loadClinic)
  if (!data) return null
  return <Inner hours={data.hours} closures={data.closures} />
}

function Inner({ hours, closures }: { hours: ClinicHours; closures: Closure[] }) {
  const saveHours = (h: ClinicHours) => setSetting('clinicHours', h)
  const setDay = (d: number, ranges: TimeRange[]) => saveHours({ ...hours, days: { ...hours.days, [d]: ranges } })

  return (
    <>
      <Header title="Clinic hours" backTo="/settings" />
      <main className="wide-page">
        <div className="split">
          <div>
            <section className="card form">
              <h3>Opening hours</h3>
              <p className="hint">Add a second time for days with a morning and an evening session.</p>
              {ORDER.map((d) => {
                const ranges = hours.days[String(d)] ?? []
                const open = ranges.length > 0
                return (
                  <div key={d} className={'day-row' + (open ? '' : ' closed')}>
                    <label className="check day-name">
                      <input type="checkbox" checked={open} onChange={(e) => setDay(d, e.target.checked ? [{ from: '10:00', to: '13:00' }] : [])} />
                      {DAY_NAMES[d]}
                    </label>
                    <div className="ranges">
                      {!open && <span className="sub">Closed</span>}
                      {ranges.map((r, i) => (
                        <div key={i} className="range">
                          <input
                            type="time"
                            value={r.from}
                            onChange={(e) => setDay(d, ranges.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
                          />
                          <span>to</span>
                          <input
                            type="time"
                            value={r.to}
                            onChange={(e) => setDay(d, ranges.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
                          />
                          <button className="icon-btn small" aria-label="Remove these hours" onClick={() => setDay(d, ranges.filter((_, j) => j !== i))}>
                            ✕
                          </button>
                        </div>
                      ))}
                      {open && ranges.length < 3 && (
                        <button className="text-btn small-link" onClick={() => setDay(d, [...ranges, { from: '17:00', to: '20:00' }])}>
                          + add hours
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              <button
                className="secondary"
                onClick={() => {
                  const mon = hours.days['1'] ?? []
                  const days = { ...hours.days }
                  for (const d of [2, 3, 4, 5, 6]) if ((days[String(d)] ?? []).length) days[String(d)] = mon.map((r) => ({ ...r }))
                  saveHours({ ...hours, days })
                }}
              >
                Copy Monday’s hours to the other open days
              </button>
            </section>

            <section className="card form">
              <h3>Appointments</h3>
              <Field label="Length of one appointment">
                <select value={hours.slotMinutes} onChange={(e) => saveHours({ ...hours, slotMinutes: Number(e.target.value) })}>
                  {[15, 20, 30, 45, 60, 90, 120].map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Patients at the same time" hint="1 unless more than one patient can be treated together.">
                <Stepper min={1} value={hours.perSlot} onChange={(n) => saveHours({ ...hours, perSlot: Math.max(1, n) })} />
              </Field>
            </section>
          </div>

          <Closures closures={closures} />
        </div>
      </main>
    </>
  )
}

function Closures({ closures }: { closures: Closure[] }) {
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')
  const t = today()
  const upcoming = closures.filter((c) => (c.to || c.from) >= t).sort((a, b) => a.from.localeCompare(b.from))

  function add() {
    if (!from) return
    const end = to && to > from ? to : from
    setSetting('closures', [...closures.filter((c) => (c.to || c.from) >= t), { id: newId(), from, to: end, reason: reason.trim() }])
    setTo('')
    setReason('')
  }

  return (
    <section className="card form">
      <h3>Clinic closed</h3>
      <p className="hint">Holidays, leave, conferences. No appointments are offered on these days.</p>
      {upcoming.length === 0 ? (
        <Empty>No closed days coming up.</Empty>
      ) : (
        <ul className="list">
          {upcoming.map((c) => (
            <li key={c.id} className="move">
              <div>
                <strong>{c.to && c.to !== c.from ? `${fmtDate(c.from)} – ${fmtDate(c.to)}` : fmtDate(c.from)}</strong>
                <span className="sub">{c.reason || 'Closed'}</span>
              </div>
              <button
                className="icon-btn small"
                aria-label="Remove"
                onClick={() => setSetting('closures', closures.filter((x) => x.id !== c.id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="two">
        <Field label="From">
          <input type="date" value={from} min={t} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To (if more than a day)">
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Field label="Reason (optional)">
        <input placeholder="e.g. Diwali, doctor on leave" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <button className="primary" onClick={add}>
        Add closed days
      </button>
    </section>
  )
}
