import { useEffect, useState, type ReactNode } from 'react'
import { isPerSession, type StockItem, type Usage } from './db'

/* ---------- tiny hash router ---------- */

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/today'
  const [path, qs = ''] = raw.split('?')
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs) }
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const on = () => {
      setRoute(parseHash())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const go = (to: string) => {
  location.hash = to
}

export const back = (fallback: string) => {
  if (history.length > 1) history.back()
  else go(fallback)
}

/* ---------- layout ---------- */

export function Header({ title, backTo, action }: { title: string; backTo?: string; action?: ReactNode }) {
  return (
    <header className="top">
      {backTo !== undefined ? (
        <button className="icon-btn" aria-label="Back" onClick={() => back(backTo)}>
          ‹
        </button>
      ) : (
        <span className="brand-dot" aria-hidden />
      )}
      <h1>{title}</h1>
      <div className="top-action">{action}</div>
    </header>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}

export function Stepper({ value, onChange, min = 0 }: { value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Less">
        −
      </button>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(Math.max(min, parseInt(e.target.value.replace(/\D/g, '')) || 0))}
      />
      <button type="button" onClick={() => onChange(value + 1)} aria-label="More">
        +
      </button>
    </div>
  )
}

/** Quantity per stock item, e.g. what one session uses. Occasional items stay folded away until needed. */
export function UsageEditor({ items, value, onChange }: { items: StockItem[]; value: Usage; onChange: (u: Usage) => void }) {
  const [showAll, setShowAll] = useState(false)
  const active = items.filter((i) => i.active)
  const shown = active.filter((i) => showAll || isPerSession(i) || (value[i.id] ?? 0) > 0)
  const hidden = active.length - shown.length
  return (
    <div className="usage">
      {shown.map((i) => (
        <div key={i.id} className={'usage-row' + ((value[i.id] ?? 0) > 0 ? ' on' : '')}>
          <span>
            {i.name} <small>({i.unit})</small>
          </span>
          <Stepper value={value[i.id] ?? 0} onChange={(n) => onChange({ ...value, [i.id]: n })} />
        </div>
      ))}
      {hidden > 0 && (
        <button type="button" className="usage-more" onClick={() => setShowAll(true)}>
          + {hidden} other item{hidden > 1 ? 's' : ''} (anaesthetic, etc.)
        </button>
      )}
    </div>
  )
}

/** Amount in rupees; empty means "not given". */
export function MoneyInput({ value, onChange, placeholder }: { value: number | undefined; onChange: (n: number | undefined) => void; placeholder?: string }) {
  // keep what is typed ("12." while typing 12.50) and only report the number
  const [text, setText] = useState(value === undefined ? '' : String(value))
  if (value !== undefined && Number(text) !== value) setText(String(value))
  if (value === undefined && text !== '' && !Number.isNaN(Number(text))) setText('')
  return (
    <div className="money">
      <span>₹</span>
      <input
        inputMode="decimal"
        placeholder={placeholder ?? '0'}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, '')
          setText(t)
          onChange(t === '' || Number.isNaN(Number(t)) ? undefined : Number(t))
        }}
      />
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2600)
    return () => clearTimeout(t)
  }, [text, onDone])
  return <div className="toast" role="status">{text}</div>
}
