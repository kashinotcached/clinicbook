import { useCallback, useEffect, useRef, useState } from 'react'
import { hashPin } from './crypto'
import { getSetting, seedIfEmpty } from './db'
import { CourseForm, DoseChange } from './screens/CourseForm'
import { PatientDetail } from './screens/PatientDetail'
import { PatientForm, Patients } from './screens/Patients'
import { ItemSettings, Settings, TreatmentSettings } from './screens/Settings'
import { Stock, StockItemPage } from './screens/Stock'
import { Today } from './screens/Today'
import { VisitForm } from './screens/VisitForm'
import { Toast, useRoute } from './ui'

const RELOCK_AFTER_MS = 2 * 60 * 1000

export default function App() {
  const [ready, setReady] = useState(false)
  const [locked, setLocked] = useState(false)
  const [toast, setToast] = useState('')
  const hiddenAt = useRef(0)
  const route = useRoute()

  useEffect(() => {
    ;(async () => {
      await seedIfEmpty()
      // ask the browser not to clear our data when the phone is short of space
      navigator.storage?.persist?.().catch(() => {})
      setLocked(!!(await getSetting('pin', null)))
      setReady(true)
    })()
  }, [])

  useEffect(() => {
    const on = async () => {
      if (document.hidden) hiddenAt.current = Date.now()
      else if (hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_AFTER_MS && (await getSetting('pin', null)))
        setLocked(true)
    }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  const clearToast = useCallback(() => setToast(''), [])

  if (!ready) return null
  if (locked) return <Lock onUnlock={() => setLocked(false)} />

  const [a, b, c] = route.parts
  const q = route.query
  let screen: React.ReactNode
  if (a === 'patients' && b === 'new') screen = <PatientForm />
  else if (a === 'patients') screen = <Patients />
  else if (a === 'patient' && c === 'edit') screen = <PatientForm id={b} />
  else if (a === 'patient') screen = <PatientDetail id={b} />
  else if (a === 'course' && b === 'new') screen = <CourseForm patientId={q.get('patient')!} first={q.has('first')} />
  else if (a === 'course' && c === 'dose') screen = <DoseChange id={b} />
  else if (a === 'course') screen = <CourseForm id={b} />
  else if (a === 'visit' && b === 'new')
    screen = (
      <VisitForm
        key={route.path + q}
        patientId={q.get('patient')!}
        courseId={q.get('course') ?? undefined}
        book={q.has('book')}
        date={q.get('date') ?? undefined}
      />
    )
  else if (a === 'visit') screen = <VisitForm key={b} id={b} />
  else if (a === 'stock' && b) screen = <StockItemPage id={b} />
  else if (a === 'stock') screen = <Stock />
  else if (a === 'settings' && b === 'treatments') screen = <TreatmentSettings />
  else if (a === 'settings' && b === 'items') screen = <ItemSettings />
  else if (a === 'settings') screen = <Settings notify={setToast} />
  else screen = <Today />

  const tab = a === 'patient' || a === 'course' || a === 'visit' ? 'patients' : a || 'today'
  return (
    <div className="app">
      {screen}
      <nav className="tabbar">
        {[
          ['today', 'Today', '◷'],
          ['patients', 'Patients', '☺'],
          ['stock', 'Stock', '▦'],
          ['settings', 'Settings', '⚙'],
        ].map(([id, label, icon]) => (
          <a key={id} href={`#/${id}`} aria-current={tab === id ? 'page' : undefined}>
            <span aria-hidden>{icon}</span>
            {label}
          </a>
        ))}
      </nav>
      {toast && <Toast text={toast} onDone={clearToast} />}
    </div>
  )
}

function Lock({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)

  async function tryPin(value: string) {
    const stored = await getSetting<{ salt: string; hash: string } | null>('pin', null)
    if (!stored) return onUnlock()
    const { hash } = await hashPin(value, stored.salt)
    if (hash === stored.hash) onUnlock()
    else {
      setErr(true)
      setPin('')
    }
  }

  function press(d: string) {
    setErr(false)
    const next = (pin + d).slice(0, 8)
    setPin(next)
  }

  return (
    <div className="lock">
      <h1>ClinicBook</h1>
      <p>{err ? 'Wrong PIN, try again' : 'Enter PIN'}</p>
      <div className="dots">{pin.replace(/./g, '●') || ' '}</div>
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button onClick={() => setPin(pin.slice(0, -1))} aria-label="Delete">
          ⌫
        </button>
        <button onClick={() => press('0')}>0</button>
        <button className="ok" disabled={pin.length < 4} onClick={() => tryPin(pin)}>
          OK
        </button>
      </div>
    </div>
  )
}
