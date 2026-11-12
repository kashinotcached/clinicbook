import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, newId, type Supplier } from '../db'
import { fmtDate } from '../logic'
import { waNumber } from '../reminders'
import { Empty, Field, Header, go } from '../ui'

export function Suppliers() {
  const rows = useLiveQuery(async () => {
    const [suppliers, moves] = await Promise.all([db.suppliers.orderBy('name').toArray(), db.stockMoves.toArray()])
    const received = moves.filter((m) => m.kind === 'received')
    return suppliers.map((s) => {
      const mine = received.filter((m) => m.supplierId === s.id)
      return {
        s,
        deliveries: mine.length,
        last: mine.reduce((d, m) => (m.date > d ? m.date : d), ''),
      }
    })
  })
  if (!rows) return null
  return (
    <>
      <Header title="Suppliers" backTo="/stock" action={<button className="text-btn" onClick={() => go('/supplier/new')}>+ Add</button>} />
      <main className="wide-page">
        {rows.length === 0 ? (
          <Empty>No suppliers yet. Add one here, or choose “+ New supplier” when recording stock received.</Empty>
        ) : (
          <ul className="list">
            {rows.map(({ s, deliveries, last }) => (
              <li key={s.id}>
                <a className="row" href={`#/supplier/${s.id}`}>
                  <div>
                    <strong>{s.name}</strong>
                    <span className="sub">
                      {s.phone || 'no phone'}
                      {last ? ` · last order ${fmtDate(last)}` : ''}
                    </span>
                  </div>
                  <span className="sub">{deliveries} deliveries</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}

export function SupplierPage({ id }: { id: string }) {
  const data = useLiveQuery(async () => {
    if (id === 'new') return { supplier: null, moves: [], items: new Map<string, string>() }
    const [supplier, moves, items] = await Promise.all([
      db.suppliers.get(id),
      db.stockMoves.where('supplierId').equals(id).toArray(),
      db.stockItems.toArray(),
    ])
    return { supplier: supplier ?? null, moves, items: new Map(items.map((i) => [i.id, `${i.name}`])) }
  }, [id])
  if (!data) return null
  return <Inner key={id} {...data} isNew={id === 'new'} />
}

function Inner({
  supplier,
  moves,
  items,
  isNew,
}: {
  supplier: Supplier | null
  moves: { id: string; itemId: string; qty: number; date: string; note: string }[]
  items: Map<string, string>
  isNew: boolean
}) {
  const [s, setS] = useState<Supplier>(supplier ?? { id: newId(), name: '', phone: '', notes: '', createdAt: Date.now() })
  const set = (patch: Partial<Supplier>) => setS({ ...s, ...patch })
  const sorted = [...moves].sort((a, b) => b.date.localeCompare(a.date))

  async function save() {
    if (!s.name.trim()) return
    await db.suppliers.put({ ...s, name: s.name.trim(), phone: s.phone.trim() })
    location.replace(isNew ? '#/suppliers' : `#/supplier/${s.id}`)
  }
  async function remove() {
    if (!confirm(`Delete ${s.name}? Past stock entries stay, without a supplier name.`)) return
    await db.transaction('rw', db.suppliers, db.stockMoves, async () => {
      await db.stockMoves.where('supplierId').equals(s.id).modify({ supplierId: null })
      await db.suppliers.delete(s.id)
    })
    location.replace('#/suppliers')
  }
  const wa = waNumber(s.phone, '91')

  return (
    <>
      <Header title={isNew ? 'New supplier' : s.name || 'Supplier'} backTo="/suppliers" />
      <main className="wide-page">
        <div className="split">
          <div className="form">
            <Field label="Name">
              <input autoFocus={isNew} value={s.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input type="tel" value={s.phone} onChange={(e) => set({ phone: e.target.value })} />
            </Field>
            <Field label="Notes" hint="Contact person, what they supply, payment terms…">
              <textarea rows={3} value={s.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
            <button className="primary" onClick={save}>
              Save
            </button>
            {!isNew && s.phone && (
              <div className="btn-row">
                <a className="secondary as-btn" href={`tel:${s.phone}`}>
                  Call
                </a>
                {wa && (
                  <a className="secondary as-btn" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">
                    WhatsApp
                  </a>
                )}
              </div>
            )}
            {!isNew && (
              <button className="danger-link" onClick={remove}>
                Delete supplier
              </button>
            )}
          </div>
          {!isNew && (
            <section>
              <h2>Deliveries ({moves.length})</h2>
              {sorted.length === 0 && <Empty>Nothing received from this supplier yet.</Empty>}
              <ul className="list moves">
                {sorted.map((m) => (
                  <li key={m.id} className="move">
                    <div>
                      <strong>
                        {m.qty} × {items.get(m.itemId) ?? 'item'}
                      </strong>
                      <span className="sub">
                        {fmtDate(m.date)}
                        {m.note ? ` · ${m.note}` : ''}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </>
  )
}
