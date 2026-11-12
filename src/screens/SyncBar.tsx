import { ago, runSync, useSyncStatus } from '../sync/auto'
import { startSignIn } from '../sync/drive'

/** One line on Today: is this device in step with the others? */
export function SyncBar() {
  const s = useSyncStatus()
  if (!s.setUp) return null
  if (s.state === 'signin')
    return (
      <button className="sync-bar warn" onClick={() => startSignIn(s.email)}>
        ☁ Not synced since {ago(s.lastSync)} · <b>tap to sign in</b>
      </button>
    )
  if (s.state === 'syncing')
    return (
      <div className="sync-bar">
        ☁ {s.progress?.step ?? 'Syncing'}
        {s.progress?.total ? ` ${s.progress.done}/${s.progress.total}` : ''}…
      </div>
    )
  return (
    <button className={'sync-bar' + (s.state === 'error' ? ' warn' : '')} onClick={() => runSync().catch(() => {})}>
      ☁ {s.state === 'error' ? s.message : `Synced ${ago(s.lastSync)}`} · <b>sync now</b>
    </button>
  )
}
