import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from '../db'
import { ago, refreshStatus, runSync, useSyncStatus } from '../sync/auto'
import { hasValidToken, startSignIn, syncAvailable } from '../sync/drive'
import { createSyncKey, forgetThisDevice, remoteHasKey, unlockSyncKey } from '../sync/engine'
import { Field } from '../ui'

export function SyncCard({ notify }: { notify: (s: string) => void }) {
  const s = useSyncStatus()
  const token = useLiveQuery(() => hasValidToken(), [s.state, s.lastSync])
  const downloadPhotos = useLiveQuery(async () => ((await db.local.get('downloadPhotos'))?.value as boolean | undefined) ?? true)
  useEffect(() => {
    refreshStatus()
  }, [])

  if (!syncAvailable())
    return (
      <section className="card">
        <h3>Sync with Google Drive</h3>
        <p className="sub">Not switched on in this version of the app yet.</p>
      </section>
    )

  if (s.setUp)
    return (
      <section className="card form">
        <h3>Sync with Google Drive</h3>
        <p className="sub">
          Connected{s.email ? ` as ${s.email}` : ''} · last synced <b>{ago(s.lastSync)}</b>
        </p>
        {s.state === 'syncing' && (
          <p className="sync-progress">
            {s.progress?.step ?? 'Syncing'}
            {s.progress?.total ? ` ${s.progress.done}/${s.progress.total}` : ''}…
          </p>
        )}
        {s.state === 'error' && <p className="alert danger"><span>{s.message}</span></p>}
        {s.message && s.state === 'idle' && <p className="hint">{s.message}</p>}
        {s.state === 'signin' || !token ? (
          <button className="primary" onClick={() => startSignIn(s.email)}>
            Sign in to Google and sync
          </button>
        ) : (
          <button
            className="primary"
            disabled={s.state === 'syncing'}
            onClick={() => runSync().then(() => notify('Synced')).catch(() => {})}
          >
            {s.state === 'syncing' ? 'Syncing…' : 'Sync now'}
          </button>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={downloadPhotos ?? true}
            onChange={(e) => db.local.put({ key: 'downloadPhotos', value: e.target.checked })}
          />
          Download photos to this device
        </label>
        <p className="hint">
          Changes sync by themselves while the app is open and signed in. Google keeps a sign-in for about an hour; after that, tap
          the button to sign in again (usually one tap). Everything is encrypted with the sync password before it leaves this
          device; Google cannot read it.
        </p>
        <button
          className="danger-link"
          onClick={async () => {
            if (!confirm('Stop syncing on this device? The records stay on this device and in Google Drive.')) return
            await forgetThisDevice()
            await refreshStatus()
            notify('Sync switched off on this device')
          }}
        >
          Stop syncing on this device
        </button>
      </section>
    )

  return <SetUp token={!!token} notify={notify} />
}

function SetUp({ token, notify }: { token: boolean; notify: (s: string) => void }) {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!token) return
    remoteHasKey()
      .then(setHasKey)
      .catch((e) => setErr((e as Error).message))
  }, [token])

  async function go() {
    setErr('')
    if (hasKey === false) {
      if (pw.length < 8) return setErr('Use at least 8 characters.')
      if (pw !== pw2) return setErr('The two passwords do not match.')
    }
    setBusy(true)
    try {
      if (hasKey) await unlockSyncKey(pw)
      else await createSyncKey(pw)
      await refreshStatus()
      await runSync()
      notify('Sync is on')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card form">
      <h3>Sync with Google Drive</h3>
      {!token ? (
        <>
          <p className="sub">
            Use ClinicBook on the phone and on a PC with the same records. They are kept in a private app folder in the doctor’s own
            Google Drive, encrypted with a sync password, so Google cannot read them and they do not show among his Drive files.
          </p>
          <button className="primary" onClick={() => startSignIn()}>
            Connect Google Drive
          </button>
        </>
      ) : hasKey === null ? (
        <p className="sub">{err || 'Checking Google Drive…'}</p>
      ) : (
        <>
          <p className="sub">
            {hasKey
              ? 'ClinicBook records are already in this Google account. Enter the sync password chosen on the first device.'
              : 'First device: choose a sync password. Every other device will need it. It cannot be recovered if forgotten.'}
          </p>
          <Field label="Sync password">
            <input type="password" autoComplete={hasKey ? 'current-password' : 'new-password'} value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          {!hasKey && (
            <Field label="Repeat sync password">
              <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </Field>
          )}
          {err && <p className="alert danger"><span>{err}</span></p>}
          <p className="hint">Records already on this device are added to the shared records.</p>
          <button className="primary" disabled={busy} onClick={go}>
            {busy ? 'Setting up…' : hasKey ? 'Unlock and sync' : 'Start syncing'}
          </button>
        </>
      )}
    </section>
  )
}
