import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, isPerSession, newId, type StockItem, type StockMove, type Supplier } from '../db'
import { averageCosts, fmtDate, forecast, rupees, stockLevels, today, type ForecastLine } from '../logic'
import { Empty, Field, Header, MoneyInput, Stepper, go } from '../ui'

export function Stock() {
  const [days, setDays] = useState(30)
  const data = useLiveQuery(async () => ({ lines: await forecast(days), avg: await averageCosts() }), [days])
  if (!data) return null
  const { lines, avg } = data
  const session = lines.filter((l) => isPerSession(l.item))
  const other = lines.filter((l) => !isPerSession(l.item))
  const value = lines.reduce((s, l) => s + Math.max(0, l.inStock) * (avg[l.item.id] ?? 0), 0)

  const row = ({ item, inStock, need, short }: ForecastLine) => {
    const low = inStock <= item.lowAt
    return (
      <li key={item.id}>
        <a className="row" href={`#/stock/${item.id}`}>
          <div>
            <strong>{item.name}</strong>
            <span className="sub">
              {isPerSession(item) ? `Needed: ${need} ${item.unit}` : low ? 'Running low' : item.unit}
              {short > 0 && <b className="short"> · order {short}+</b>}
              {avg[item.id] !== undefined && ` · ${rupees(avg[item.id])}/${item.unit}`}
            </span>
          </div>
          <span className={'count ' + (short > 0 ? 'bad' : low ? 'warn' : 'ok')}>
            {inStock}
            <small>in stock</small>
          </span>
        </a>
      </li>
    )
  }

  return (
    <>
      <Header
        title="Stock"
        action={
          <>
            <button className="text-btn" onClick={() => go('/suppliers')}>Suppliers</button>
            <button className="text-btn" onClick={() => go('/stock-new')}>+ Item</button>
          </>
        }
      />
      <main className="wide-page">
        <div className="segmented small" role="group" aria-label="Look ahead">
          {[14, 30, 60].map((d) => (
            <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>
              Next {d} days
            </button>
          ))}
        </div>
        <p className="hint">
          “Needed” counts booked and expected sessions of active courses at each patient’s current dose.
          {value > 0 && ` Stock on hand is worth about ${rupees(value)}.`}
        </p>
        <section>
          <h2>Used in sessions</h2>
          <ul className="list stock">{session.map(row)}</ul>
        </section>
        {other.length > 0 && (
          <section>
            <h2>Other stock</h2>
            <ul className="list stock">{other.map(row)}</ul>
          </section>
        )}
        <button className="secondary wide" onClick={() => go('/stock-new')}>
          + Add an item (anaesthetic, medicine, equipment…)
        </button>
      </main>
    </>
  )
}

export function NewStockItem() {
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('pc')
  const [perSession, setPerSession] = useState(false)
  const [lowAt, setLowAt] = useState(2)
  async function save() {
    if (!name.trim()) return
    const id = newId()
    const sort = (await db.stockItems.count()) + 1
    await db.stockItems.add({ id, name: name.trim(), unit: unit.trim() || 'pc', lowAt, sort, active: true, perSession })
    location.replace(`#/stock/${id}`)
  }
  return (
    <>
      <Header title="New stock item" backTo="/stock" />
      <main>
        <div className="form narrow">
          <Field label="Name">
            <input autoFocus placeholder="e.g. Lignocaine 2% vial" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Counted in" hint="vial, box, bottle, pc, pair…">
            <input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
          <Field label="How is it used?">
            <div className="segmented">
              <button type="button" aria-pressed={perSession} onClick={() => setPerSession(true)}>
                Every session
              </button>
              <button type="button" aria-pressed={!perSession} onClick={() => setPerSession(false)}>
                Now and then
              </button>
            </div>
          </Field>
          <p className="hint">
            {perSession
              ? 'Set how many each session uses in Settings → Treatments; it then comes off stock with every logged session.'
              : 'Record it with “Used up / opened” when a vial or pack is finished. It still counts in the profit report.'}
          </p>
          <Field label="Warn when stock is at or below">
            <Stepper value={lowAt} onChange={setLowAt} />
          </Field>
          <button className="primary" onClick={save}>
            Add item
          </button>
        </div>
      </main>
    </>
  )
}

type Mode = 'receive' | 'use' | 'count'

export function StockItemPage({ id }: { id: string }) {
  const data = useLiveQuery(async () => {
    const [item, moves, levels, visits, patients, suppliers, avg] = await Promise.all([
      db.stockItems.get(id),
      db.stockMoves.where('itemId').equals(id).toArray(),
      stockLevels(),
      db.visits.toArray(),
      db.patients.toArray(),
      db.suppliers.orderBy('name').toArray(),
      averageCosts(),
    ])
    const visitPatient = new Map(visits.map((v) => [v.id, v.patientId]))
    const names = new Map(patients.map((p) => [p.id, p.name]))
    return { item, moves, level: levels[id] ?? 0, visitPatient, names, suppliers, avg: avg[id] }
  }, [id])
  const [mode, setMode] = useState<Mode | null>(null)
  const [limit, setLimit] = useState(30)
  if (!data) return null
  const { item, moves, level, visitPatient, names, suppliers, avg } = data
  if (!item) return <Empty>Item not found.</Empty>
  const sorted = moves.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]))
  const lastSupplier = sorted.find((m) => m.kind === 'received' && m.supplierId)?.supplierId ?? ''

  return (
    <>
      <Header title={item.name} backTo="/stock" />
      <main className="wide-page">
        <div className="split">
          <div>
            <div className="card big-count">
              <span className="num">{level}</span>
              <span className="sub">
                {item.unit} in stock · warn at {item.lowAt}
                {avg !== undefined && ` · average ${rupees(avg)} per ${item.unit}`}
              </span>
            </div>
            {!mode && (
              <div className="btn-row">
                <button className="primary" onClick={() => setMode('receive')}>
                  + Received stock
                </button>
                <button className="secondary" onClick={() => setMode('use')}>
                  Used up / opened
                </button>
                <button className="secondary" onClick={() => setMode('count')}>
                  Correct the count
                </button>
              </div>
            )}
            {mode && (
              <MoveForm
                key={mode}
                mode={mode}
                item={item}
                level={level}
                suppliers={suppliers}
                defaultSupplier={lastSupplier}
                onDone={() => setMode(null)}
              />
            )}
            <label className="check item-kind">
              <input
                type="checkbox"
                checked={isPerSession(item)}
                onChange={(e) => db.stockItems.update(item.id, { perSession: e.target.checked })}
              />
              Used in every session
            </label>
          </div>
          <section>
            <h2>History</h2>
            {sorted.length === 0 && <Empty>Nothing recorded yet. Start with “Received stock” or “Correct the count”.</Empty>}
            <ul className="list moves">
              {sorted.slice(0, limit).map((m) => (
                <MoveRow key={m.id} m={m} pid={m.visitId ? visitPatient.get(m.visitId) : undefined} names={names} supplierName={supplierName} />
              ))}
            </ul>
            {sorted.length > limit && (
              <button className="secondary wide" onClick={() => setLimit(limit + 50)}>
                Show more
              </button>
            )}
          </section>
        </div>
      </main>
    </>
  )
}

function MoveRow({
  m,
  pid,
  names,
  supplierName,
}: {
  m: StockMove
  pid: string | undefined
  names: Map<string, string>
  supplierName: Map<string, string>
}) {
  const title =
    m.kind === 'received'
      ? m.supplierId
        ? supplierName.get(m.supplierId) ?? 'Received'
        : 'Received'
      : m.kind === 'used'
        ? pid
          ? names.get(pid)
          : 'Used up / opened'
        : 'Correction'
  return (
    <li className="move">
      <div>
        <strong>{title}</strong>
        <span className="sub">
          {fmtDate(m.date)}
          {m.kind === 'received' && m.cost ? ` · paid ${rupees(m.cost)}` : ''}
          {m.note ? ` · ${m.note}` : ''}
        </span>
      </div>
      <span className={m.qty > 0 ? 'plus' : 'minus'}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span>
      {m.visitId ? (
        <button className="icon-btn small" aria-label="Open visit" onClick={() => go(`/visit/${m.visitId}`)}>
          ›
        </button>
      ) : (
        <button className="icon-btn small" aria-label="Delete entry" onClick={() => confirm('Delete this entry?') && db.stockMoves.delete(m.id)}>
          ✕
        </button>
      )}
    </li>
  )
}

function MoveForm({
  mode,
  item,
  level,
  suppliers,
  defaultSupplier,
  onDone,
}: {
  mode: Mode
  item: StockItem
  level: number
  suppliers: Supplier[]
  defaultSupplier: string
  onDone: () => void
}) {
  const [qty, setQty] = useState(mode === 'count' ? Math.max(0, level) : mode === 'use' ? 1 : 0)
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [cost, setCost] = useState<number | undefined>(undefined)
  const [supplierId, setSupplierId] = useState(defaultSupplier)
  const [newSupplier, setNewSupplier] = useState('')

  async function save() {
    const delta = mode === 'receive' ? qty : mode === 'use' ? -qty : qty - level
    if (delta === 0) return onDone()
    let sid: string | null = null
    if (mode === 'receive') {
      if (supplierId === '__new') {
        if (newSupplier.trim()) {
          sid = newId()
          await db.suppliers.add({ id: sid, name: newSupplier.trim(), phone: '', notes: '', createdAt: Date.now() })
        }
      } else sid = supplierId || null
    }
    await db.stockMoves.add({
      id: newId(),
      itemId: item.id,
      qty: delta,
      kind: mode === 'receive' ? 'received' : mode === 'use' ? 'used' : 'adjust',
      visitId: null,
      date,
      note: note.trim(),
      cost: mode === 'receive' ? cost : undefined,
      supplierId: sid,
      createdAt: Date.now(),
    })
    onDone()
  }

  return (
    <div className="card form">
      <h3>{mode === 'receive' ? 'Received' : mode === 'use' ? 'Used up / opened' : 'Actual count on the shelf'}</h3>
      {mode === 'receive' && (
        <Field label="Supplier">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— not given —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="__new">+ New supplier…</option>
          </select>
        </Field>
      )}
      {supplierId === '__new' && mode === 'receive' && (
        <Field label="New supplier name">
          <input autoFocus value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} />
        </Field>
      )}
      <Field label={mode === 'count' ? `Counted (${item.unit})` : `How many (${item.unit})`}>
        <Stepper value={qty} onChange={setQty} />
      </Field>
      {mode === 'receive' && (
        <div className="quick">
          {[5, 10, 20, 50].map((n) => (
            <button key={n} type="button" onClick={() => setQty(qty + n)}>
              +{n}
            </button>
          ))}
        </div>
      )}
      {mode === 'receive' && (
        <Field label="Total amount paid" hint={cost && qty ? `${rupees(cost / qty)} per ${item.unit}` : 'Used to work out profit. Leave empty if unknown.'}>
          <MoneyInput value={cost} onChange={setCost} />
        </Field>
      )}
      <Field label="Date">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Note (optional)">
        <input placeholder={mode === 'receive' ? 'invoice no., batch, expiry…' : 'reason'} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {mode === 'count' && (
        <p className="hint">
          Records a correction of {qty - level >= 0 ? '+' : ''}
          {qty - level}.
        </p>
      )}
      <div className="btn-row">
        <button className="primary" onClick={save}>
          Save
        </button>
        <button className="secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}
