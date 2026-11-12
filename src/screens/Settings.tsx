import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { backupPhotos, backupRecords, readBackup, restorePhotos, restoreRecords, shareFile } from '../backup'
import { hashPin } from '../crypto'
import { DEFAULT_PHOTO_AREAS, db, newId, setSetting, type StockItem, type Treatment } from '../db'
import { addDays, today } from '../logic'
import { DEFAULT_REMINDER, DEFAULT_TEMPLATE, reminderMessage, type ReminderSettings } from '../reminders'
import { Field, Header, Stepper, UsageEditor } from '../ui'

const mb = (n: number) => (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + ' MB'
const when = (t: number) => (t ? new Date(t).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'never')

export function Settings({ notify }: { notify: (s: string) => void }) {
  const s = useLiveQuery(async () => {
    const rows = await db.settings.toArray()
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    return {
      calendarName: (m.calendarName as string) ?? 'initials',
      calendarLink: (m.calendarLink as boolean) ?? true,
      reminder: { ...DEFAULT_REMINDER, ...((m.reminder as Partial<ReminderSettings>) ?? {}) },
      photoAreas: (m.photoAreas as string[]) ?? DEFAULT_PHOTO_AREAS,
      hasPin: !!m.pin,
      lastRecords: (m.lastRecordsBackup as number) ?? 0,
      lastPhotos: (m.lastPhotosBackup as number) ?? 0,
      savedPassword: (m.backupPassword as string) ?? '',
      photoCount: await db.photos.count(),
      newPhotos: await db.photos.where('takenAt').above((m.lastPhotosBackup as number) ?? 0).count(),
    }
  })
  const [storage, setStorage] = useState<{ used: number; quota: number; persisted: boolean } | null>(null)
  useEffect(() => {
    ;(async () => {
      const est = await navigator.storage?.estimate?.()
      const persisted = (await navigator.storage?.persisted?.()) ?? false
      setStorage({ used: est?.usage ?? 0, quota: est?.quota ?? 0, persisted })
    })()
  }, [])
  if (!s) return null

  return (
    <>
      <Header title="Settings" />
      <main>
        <BackupCard s={s} notify={notify} />
        <PinCard hasPin={s.hasPin} notify={notify} />

        <section className="card">
          <h3>Treatments and stock items</h3>
          <a className="row" href="#/settings/treatments">
            <span>Treatments and what a session uses</span>
            <span className="chev">›</span>
          </a>
          <a className="row" href="#/settings/items">
            <span>Stock items and low-stock levels</span>
            <span className="chev">›</span>
          </a>
        </section>

        <section className="card form">
          <h3>Photos</h3>
          <Field label="Areas of the head (one per line)">
            <textarea
              rows={6}
              defaultValue={s.photoAreas.join('\n')}
              onBlur={(e) => {
                const list = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean)
                setSetting('photoAreas', list.length ? list : DEFAULT_PHOTO_AREAS)
              }}
            />
          </Field>
        </section>

        <ReminderCard r={s.reminder} />

        <section className="card form">
          <h3>Google Calendar</h3>
          <Field label="Name in calendar entries" hint="Calendar entries are stored by Google. Initials keep patient names off Google.">
            <select value={s.calendarName} onChange={(e) => setSetting('calendarName', e.target.value)}>
              <option value="initials">Initials only (e.g. R.K.)</option>
              <option value="full">Full name</option>
              <option value="none">No name</option>
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" checked={s.calendarLink} onChange={(e) => setSetting('calendarLink', e.target.checked)} />
            Put a WhatsApp reminder link in each entry
          </label>
          <p className="hint">
            When the calendar reminds you, tap the link in the entry: ClinicBook opens with the message ready for that patient.
            The link is only a random code. Entries made before this was switched on have no link.
          </p>
        </section>

        {storage && (
          <section className="card">
            <h3>Storage on this phone</h3>
            <p className="sub">
              Using {mb(storage.used)}
              {storage.quota ? ` of ${mb(storage.quota)} available` : ''} · {s.photoCount} photos
            </p>
            <p className="sub">
              {storage.persisted
                ? 'Protected: the phone will not clear this data to free up space.'
                : 'Not yet protected from automatic clean-up. Install the app to the home screen, then reopen it.'}
            </p>
            {!storage.persisted && (
              <button
                className="secondary small"
                onClick={async () => {
                  const ok = await navigator.storage?.persist?.()
                  setStorage({ ...storage, persisted: !!ok })
                  notify(ok ? 'Storage protected' : 'The browser refused for now; install the app first')
                }}
              >
                Ask the phone to protect it
              </button>
            )}
          </section>
        )}

        <section className="card">
          <h3>About</h3>
          <p className="sub">
            ClinicBook keeps every record only on this phone. Nothing is sent to any server. Backups are encrypted with your
            backup password before they leave the app.
          </p>
        </section>
      </main>
    </>
  )
}

function ReminderCard({ r }: { r: ReminderSettings }) {
  const save = (patch: Partial<ReminderSettings>) => setSetting('reminder', { ...r, ...patch })
  const sample = reminderMessage(
    r,
    { id: '', name: 'Rahul Kamat', phone: '', gender: '', notes: '', createdAt: 0, updatedAt: 0 },
    { id: '', patientId: '', courseId: null, date: addDays(today(), 1), time: '10:30', status: 'scheduled', usage: {}, notes: '', createdAt: 0, updatedAt: 0 },
    { id: '', patientId: '', treatmentId: '', treatment: 'PRP', totalSessions: 6, intervalDays: 30, startDate: '', status: 'active', plan: [], notes: '', createdAt: 0, updatedAt: 0 },
    3,
  )
  return (
    <section className="card form">
      <h3>WhatsApp reminders</h3>
      <Field label="Clinic name (used in the message)">
        <input defaultValue={r.clinic} placeholder="e.g. Dr. Naik's Hair Clinic" onChange={(e) => save({ clinic: e.target.value.trim() })} />
      </Field>
      <Field label="Country code for 10-digit numbers">
        <input inputMode="numeric" defaultValue={r.countryCode} onChange={(e) => save({ countryCode: e.target.value.replace(/\D/g, '') || '91' })} />
      </Field>
      <Field
        label="Message"
        hint="Words in braces are filled in: {first} first name, {name} full name, {treatment}, {session} (e.g. session 3 of 6), {when} date and time, {clinic}."
      >
        <textarea rows={5} defaultValue={r.template} onChange={(e) => save({ template: e.target.value.trim() || DEFAULT_TEMPLATE })} />
      </Field>
      <div className="preview">
        <span className="field-label">Example</span>
        <p>{sample}</p>
      </div>
      <button className="text-btn small-link" onClick={() => save({ template: DEFAULT_TEMPLATE })}>
        Reset message to the default
      </button>
    </section>
  )
}

function BackupCard({
  s,
  notify,
}: {
  s: { lastRecords: number; lastPhotos: number; savedPassword: string; newPhotos: number; photoCount: number }
  notify: (x: string) => void
}) {
  const [pw, setPw] = useState(s.savedPassword)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState('')
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restorePw, setRestorePw] = useState('')

  async function run(kind: 'records' | 'photos-new' | 'photos-all') {
    if (pw.length < 8) return alert('Choose a backup password of at least 8 characters. Write it down: without it the backup cannot be opened.')
    setBusy(kind)
    try {
      if (remember) await setSetting('backupPassword', pw)
      else await db.settings.delete('backupPassword')
      const file =
        kind === 'records' ? await backupRecords(pw) : await backupPhotos(pw, kind === 'photos-new' ? s.lastPhotos || null : null)
      const r = await shareFile(file)
      notify(r === 'cancelled' ? 'Backup not sent' : `Backup ready (${mb(file.size)})`)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  async function restore() {
    if (!restoreFile) return
    setBusy('restore')
    try {
      const { manifest, files } = await readBackup(restoreFile, restorePw)
      const made = new Date(manifest.createdAt).toLocaleString('en-IN')
      if (manifest.kind === 'records') {
        if (!confirm(`Replace ALL records on this phone with the backup from ${made} (${manifest.count} patients)? Photos already on this phone are kept.`))
          return
        await restoreRecords(files)
        notify('Records restored')
      } else {
        const added = await restorePhotos(files)
        notify(`${added} photos added`)
      }
      setRestoreFile(null)
      setRestorePw('')
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="card form">
      <h3>Backup</h3>
      <p className="sub">
        Records last backed up: <b>{when(s.lastRecords)}</b>
        <br />
        Photos last backed up: <b>{when(s.lastPhotos)}</b> · {s.newPhotos} new since
      </p>
      <Field label="Backup password" hint="Needed to open a backup on a new phone. If it is lost, the backup cannot be opened.">
        <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember it on this phone
      </label>
      <button className="primary" disabled={!!busy} onClick={() => run('records')}>
        {busy === 'records' ? 'Preparing…' : 'Back up records'}
      </button>
      <div className="btn-row">
        <button className="secondary" disabled={!!busy || s.newPhotos === 0} onClick={() => run('photos-new')}>
          {busy === 'photos-new' ? 'Preparing…' : `New photos (${s.newPhotos})`}
        </button>
        <button className="secondary" disabled={!!busy || s.photoCount === 0} onClick={() => run('photos-all')}>
          {busy === 'photos-all' ? 'Preparing…' : 'All photos'}
        </button>
      </div>
      <p className="hint">The file opens the phone’s share menu: save it to Google Drive, or send it to yourself on WhatsApp. It is encrypted, so neither can read it.</p>

      <h3>Restore</h3>
      <input type="file" accept=".clbk,application/octet-stream" onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)} />
      {restoreFile && (
        <>
          <Field label="Password of that backup">
            <input type="password" value={restorePw} onChange={(e) => setRestorePw(e.target.value)} />
          </Field>
          <button className="primary" disabled={!!busy} onClick={restore}>
            {busy === 'restore' ? 'Restoring…' : 'Restore'}
          </button>
        </>
      )}
    </section>
  )
}

function PinCard({ hasPin, notify }: { hasPin: boolean; notify: (x: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  async function save() {
    if (!/^\d{4,8}$/.test(pin)) return alert('PIN must be 4 to 8 digits.')
    if (pin !== pin2) return alert('The two PINs do not match.')
    await setSetting('pin', await hashPin(pin))
    setEditing(false)
    setPin('')
    setPin2('')
    notify('PIN set')
  }
  return (
    <section className="card form">
      <h3>App lock</h3>
      <p className="sub">{hasPin ? 'The app asks for a PIN when opened.' : 'No PIN set. Anyone holding the unlocked phone can open the app.'}</p>
      {editing ? (
        <>
          <Field label="New PIN">
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
          </Field>
          <Field label="Repeat PIN">
            <input type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value)} />
          </Field>
          <div className="btn-row">
            <button className="primary" onClick={save}>
              Save PIN
            </button>
            <button className="secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="btn-row">
          <button className="secondary" onClick={() => setEditing(true)}>
            {hasPin ? 'Change PIN' : 'Set a PIN'}
          </button>
          {hasPin && (
            <button
              className="secondary"
              onClick={async () => {
                if (!confirm('Remove the PIN?')) return
                await db.settings.delete('pin')
                notify('PIN removed')
              }}
            >
              Remove PIN
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export function TreatmentSettings() {
  const data = useLiveQuery(async () => ({
    treatments: await db.treatments.orderBy('sort').toArray(),
    items: await db.stockItems.orderBy('sort').toArray(),
  }))
  if (!data) return null
  return (
    <>
      <Header title="Treatments" backTo="/settings" />
      <main>
        <p className="hint">These are the starting values for a new course. Each course can still be changed on its own.</p>
        {data.treatments.map((t) => (
          <TreatmentCard key={t.id} t={t} items={data.items} />
        ))}
        <button
          className="secondary wide"
          onClick={() =>
            db.treatments.add({ id: newId(), name: 'New treatment', sessions: 6, intervalDays: 30, usage: {}, sort: data.treatments.length + 1 })
          }
        >
          + Add treatment
        </button>
      </main>
    </>
  )
}

function TreatmentCard({ t, items }: { t: Treatment; items: StockItem[] }) {
  const save = (patch: Partial<Treatment>) => db.treatments.update(t.id, patch)
  return (
    <section className="card form">
      <Field label="Name">
        <input defaultValue={t.name} onBlur={(e) => e.target.value.trim() && save({ name: e.target.value.trim() })} />
      </Field>
      <div className="two">
        <Field label="Sessions">
          <Stepper min={1} value={t.sessions} onChange={(n) => save({ sessions: n })} />
        </Field>
        <Field label="Days apart">
          <Stepper min={1} value={t.intervalDays} onChange={(n) => save({ intervalDays: n })} />
        </Field>
      </div>
      <Field label="One session uses">
        <UsageEditor items={items} value={t.usage} onChange={(u) => save({ usage: u })} />
      </Field>
    </section>
  )
}

export function ItemSettings() {
  const items = useLiveQuery(() => db.stockItems.orderBy('sort').toArray())
  if (!items) return null
  const save = (id: string, patch: Partial<StockItem>) => db.stockItems.update(id, patch)
  return (
    <>
      <Header title="Stock items" backTo="/settings" />
      <main>
        {items.map((i) => (
          <section key={i.id} className={'card form' + (i.active ? '' : ' muted')}>
            <div className="two">
              <Field label="Name">
                <input defaultValue={i.name} onBlur={(e) => e.target.value.trim() && save(i.id, { name: e.target.value.trim() })} />
              </Field>
              <Field label="Counted in">
                <input defaultValue={i.unit} onBlur={(e) => e.target.value.trim() && save(i.id, { unit: e.target.value.trim() })} />
              </Field>
            </div>
            <Field label="Warn when stock is at or below">
              <Stepper value={i.lowAt} onChange={(n) => save(i.id, { lowAt: n })} />
            </Field>
            <label className="check">
              <input type="checkbox" checked={i.active} onChange={(e) => save(i.id, { active: e.target.checked })} /> In use
            </label>
          </section>
        ))}
        <button
          className="secondary wide"
          onClick={() => db.stockItems.add({ id: newId(), name: 'New item', unit: 'pc', lowAt: 10, sort: items.length + 1, active: true })}
        >
          + Add stock item
        </button>
      </main>
    </>
  )
}

