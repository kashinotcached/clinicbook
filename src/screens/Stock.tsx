import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, newId } from '../db'
import { fmtDate, forecast, stockLevels, today } from '../logic'
import { Empty, Field, Header, Stepper, go } from '../ui'

export function Stock() {
  const [days, setDays] = useState(30)
  const lines = useLiveQuery(() => forecast(days), [days])
  if (!lines) return null
  return (
    <>
      <Header title="Stock" />
      <main>
        <div className="segmented small" role="group" aria-label="Look ahead">
          {[14, 30, 60].map((d) => (
            <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>
              Next {d} days
            </button>
          ))}
        </div>
        <p className="hint">“Needed” counts booked and expected sessions of active courses at each patient’s current dose.</p>
        <ul className="list stock">
          {lines.map(({ item, inStock, need, short }) => {
            const low = inStock <= item.lowAt
            return (
              <li key={item.id}>
                <a className="row" href={`#/stock/${item.id}`}>
                  <div>
                    <strong>{item.name}</strong>
                    <span className="sub">
                      Needed: {need} {item.unit}
                      {short > 0 && <b className="short"> · order {short}+</b>}
                    </span>
                  </div>
                  <span className={'count ' + (short > 0 ? 'bad' : low ? 'warn' : 'ok')}>
                    {inStock}
                    <small>in stock</small>
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      </main>
    </>
  )
}

export function StockItemPage({ id }: { id: string }) {
  const data = useLiveQuery(async () => {
    const [item, moves, levels, visits, patients] = await Promise.all([
      db.stockItems.get(id),
      db.stockMoves.where('itemId').equals(id).toArray(),
      stockLevels(),
      db.visits.toArray(),
      db.patients.toArray(),
    ])
    const visitPatient = new Map(visits.map((v) => [v.id, v.patientId]))
    const names = new Map(patients.map((p) => [p.id, p.name]))
    return { item, moves, level: levels[id] ?? 0, visitPatient, names }
  }, [id])
  const [mode, setMode] = useState<'receive' | 'count' | null>(null)
  const [qty, setQty] = useState(0)
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [limit, setLimit] = useState(30)
  if (!data) return null
  const { item, moves, level, visitPatient, names } = data
  if (!item) return <Empty>Item not found.</Empty>
  const sorted = moves.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)

  function open(m: 'receive' | 'count') {
    setMode(m)
    setQty(m === 'count' ? Math.max(0, level) : 0)
    setDate(today())
    setNote('')
  }

  async function save() {
    const delta = mode === 'receive' ? qty : qty - level
    if (delta === 0) return setMode(null)
    await db.stockMoves.add({
      id: newId(),
      itemId: id,
      qty: delta,
      kind: mode === 'receive' ? 'received' : 'adjust',
      visitId: null,
      date,
      note: note.trim(),
      createdAt: Date.now(),
    })
    setMode(null)
  }

  return (
    <>
      <Header title={item.name} backTo="/stock" />
      <main>
        <div className="card big-count">
          <span className="num">{level}</span>
          <span className="sub">{item.unit} in stock · warn below {item.lowAt}</span>
        </div>
        {!mode && (
          <div className="btn-row">
            <button className="primary" onClick={() => open('receive')}>
              + Received stock
            </button>
            <button className="secondary" onClick={() => open('count')}>
              Correct the count
            </button>
          </div>
        )}
        {mode && (
          <div className="card form">
            <h3>{mode === 'receive' ? 'Received' : 'Actual count on the shelf'}</h3>
            <Field label={mode === 'receive' ? `How many ${item.unit}` : `Counted ${item.unit}`}>
              <Stepper value={qty} onChange={setQty} />
            </Field>
            {mode === 'receive' && (
              <div className="quick">
                {[10, 20, 50, 100].map((n) => (
                  <button key={n} type="button" onClick={() => setQty(qty + n)}>
                    +{n}
                  </button>
                ))}
              </div>
            )}
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Note (optional)">
              <input placeholder={mode === 'receive' ? 'supplier, batch, price…' : 'reason'} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {mode === 'count' && <p className="hint">Records a correction of {qty - level >= 0 ? '+' : ''}{qty - level}.</p>}
            <div className="btn-row">
              <button className="primary" onClick={save}>
                Save
              </button>
              <button className="secondary" onClick={() => setMode(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <section>
          <h2>History</h2>
          {sorted.length === 0 && <Empty>Nothing recorded yet. Start with “Received stock” or “Correct the count”.</Empty>}
          <ul className="list moves">
            {sorted.slice(0, limit).map((m) => {
              const pid = m.visitId ? visitPatient.get(m.visitId) : undefined
              return (
                <li key={m.id} className="move">
                  <div>
                    <strong>{m.kind === 'received' ? 'Received' : m.kind === 'used' ? (pid ? names.get(pid) : 'Used') : 'Correction'}</strong>
                    <span className="sub">
                      {fmtDate(m.date)}
                      {m.note ? ` · ${m.note}` : ''}
                    </span>
                  </div>
                  <span className={m.qty > 0 ? 'plus' : 'minus'}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span>
                  {m.kind !== 'used' && (
                    <button
                      className="icon-btn small"
                      aria-label="Delete entry"
                      onClick={() => confirm('Delete this entry?') && db.stockMoves.delete(m.id)}
                    >
                      ✕
                    </button>
                  )}
                  {m.kind === 'used' && pid && (
                    <button className="icon-btn small" aria-label="Open visit" onClick={() => go(`/visit/${m.visitId}`)}>
                      ›
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          {sorted.length > limit && (
            <button className="secondary wide" onClick={() => setLimit(limit + 50)}>
              Show more
            </button>
          )}
        </section>
      </main>
    </>
  )
}
