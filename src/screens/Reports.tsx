import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { isoDate, report, rupees } from '../logic'
import { Empty, Header } from '../ui'

type Period = 'month' | 'year'

function range(period: Period, offset: number) {
  const now = new Date()
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0)
    return { from: isoDate(start), to: isoDate(end), label: start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }
  }
  const y = now.getFullYear() + offset
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) }
}

export function Reports() {
  const [period, setPeriod] = useState<Period>('month')
  const [offset, setOffset] = useState(0)
  const r = range(period, offset)
  const data = useLiveQuery(() => report(r.from, r.to), [r.from, r.to])

  return (
    <>
      <Header title="Reports" />
      <main className="wide-page">
        <div className="segmented small" role="group" aria-label="Period">
          <button aria-pressed={period === 'month'} onClick={() => { setPeriod('month'); setOffset(0) }}>
            Month
          </button>
          <button aria-pressed={period === 'year'} onClick={() => { setPeriod('year'); setOffset(0) }}>
            Year
          </button>
        </div>
        <div className="period-nav">
          <button className="icon-btn" aria-label="Earlier" onClick={() => setOffset(offset - 1)}>‹</button>
          <strong>{r.label}</strong>
          <button className="icon-btn" aria-label="Later" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>›</button>
        </div>

        {data && (
          <>
            <div className="kpis">
              <div className="kpi">
                <span>Income</span>
                <strong>{rupees(data.revenue)}</strong>
                <small>{data.sessions} visits done</small>
              </div>
              <div className="kpi">
                <span>Cost of items used</span>
                <strong>{rupees(data.itemsCost)}</strong>
                <small>at average purchase price</small>
              </div>
              <div className={'kpi ' + (data.revenue - data.itemsCost >= 0 ? 'good' : 'bad')}>
                <span>Profit</span>
                <strong>{rupees(data.revenue - data.itemsCost)}</strong>
                <small>income − items used</small>
              </div>
              <div className="kpi">
                <span>Spent on stock</span>
                <strong>{rupees(data.purchases)}</strong>
                <small>purchases in this period</small>
              </div>
            </div>
            {data.unpriced.length > 0 && (
              <p className="alert warn">
                <strong>Some items have no price yet</strong>
                <span>
                  {data.unpriced.map((i) => i.name).join(', ')} — enter the amount paid when recording stock received, or the cost is counted as ₹0.
                </span>
              </p>
            )}
            {data.sessions > 0 && data.revenue === 0 && (
              <p className="alert warn">
                <strong>No fees recorded</strong>
                <span>Set the usual fee in Settings → Treatments; each logged visit then takes it (and can be changed).</span>
              </p>
            )}

            <div className="report-grid">
              <section>
                <h2>By treatment</h2>
                {data.byTreatment.length === 0 ? (
                  <Empty>No visits done in this period.</Empty>
                ) : (
                  <table className="table">
                    <thead>
                      <tr><th>Treatment</th><th>Visits</th><th>Income</th><th>Items</th><th>Profit</th></tr>
                    </thead>
                    <tbody>
                      {data.byTreatment.map((t) => (
                        <tr key={t.name}>
                          <td>{t.name}</td>
                          <td>{t.sessions}</td>
                          <td>{rupees(t.revenue)}</td>
                          <td>{rupees(t.cost)}</td>
                          <td>{rupees(t.revenue - t.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
              <section>
                <h2>Items used</h2>
                {data.byItem.length === 0 ? (
                  <Empty>Nothing used in this period.</Empty>
                ) : (
                  <table className="table">
                    <thead>
                      <tr><th>Item</th><th>Used</th><th>Cost</th></tr>
                    </thead>
                    <tbody>
                      {data.byItem.map((i) => (
                        <tr key={i.item.id}>
                          <td>{i.item.name}</td>
                          <td>{i.used} {i.item.unit}</td>
                          <td>{i.priced ? rupees(i.cost) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
              <section>
                <h2>Purchases by supplier</h2>
                {data.bySupplier.length === 0 ? (
                  <Empty>No stock received in this period.</Empty>
                ) : (
                  <table className="table">
                    <thead>
                      <tr><th>Supplier</th><th>Entries</th><th>Spent</th></tr>
                    </thead>
                    <tbody>
                      {data.bySupplier.map((s) => (
                        <tr key={s.name}>
                          <td>{s.name}</td>
                          <td>{s.entries}</td>
                          <td>{rupees(s.spend)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
            <p className="hint">
              Profit here is income from visits minus the cost of the items they used (and items marked used up). Rent, staff and other
              running costs are not included.
            </p>
          </>
        )}
      </main>
    </>
  )
}
