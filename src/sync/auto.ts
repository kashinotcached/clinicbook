import { useEffect, useState } from 'react'
import { db, localChanges } from '../db'
import { NeedSignIn, hasValidToken, syncAvailable } from './drive'
import { isSetUp, syncNow, type Progress } from './engine'

export interface SyncStatus {
  setUp: boolean
  state: 'idle' | 'syncing' | 'error' | 'signin'
  message: string
  progress: Progress | null
  lastSync: number
  email: string
}

let status: SyncStatus = { setUp: false, state: 'idle', message: '', progress: null, lastSync: 0, email: '' }
const listeners = new Set<(s: SyncStatus) => void>()
function set(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  listeners.forEach((l) => l(status))
}

export function useSyncStatus() {
  const [s, setS] = useState(status)
  useEffect(() => {
    listeners.add(setS)
    setS(status)
    return () => {
      listeners.delete(setS)
    }
  }, [])
  return s
}

export async function refreshStatus() {
  const [setUp, last, email, token] = await Promise.all([
    isSetUp(),
    db.local.get('lastSync'),
    db.local.get('syncEmail'),
    hasValidToken(),
  ])
  set({
    setUp,
    lastSync: (last?.value as number) ?? 0,
    email: (email?.value as string) ?? '',
    state: setUp && !token && status.state !== 'syncing' ? 'signin' : status.state === 'signin' && token ? 'idle' : status.state,
  })
}

/** Sync now; quiet = automatic (no sign-in screen, just a status). */
export async function runSync(quiet = false) {
  if (!syncAvailable() || !(await isSetUp())) return
  if (!(await hasValidToken())) {
    set({ state: 'signin', message: 'Sign in to Google to sync.' })
    if (!quiet) throw new NeedSignIn()
    return
  }
  set({ state: 'syncing', message: '', progress: null })
  try {
    const r = await syncNow((p) => set({ progress: p }))
    set({
      state: 'idle',
      progress: null,
      message: r.photosDown || r.photosUp ? `${r.photosUp} photos sent, ${r.photosDown} received` : '',
    })
  } catch (e) {
    if (e instanceof NeedSignIn) set({ state: 'signin', progress: null, message: e.message })
    else set({ state: 'error', progress: null, message: navigator.onLine ? (e as Error).message : 'No internet. Will sync when back online.' })
    if (!quiet) throw e
  } finally {
    await refreshStatus()
  }
}

let started = false
/** Sync on opening, a little after each change, every 5 minutes while open, and when the internet comes back. */
export function startAutoSync() {
  if (started || !syncAvailable()) return
  started = true
  refreshStatus().then(() => runSync(true))
  let timer: ReturnType<typeof setTimeout> | undefined
  localChanges.addEventListener('change', () => {
    clearTimeout(timer)
    timer = setTimeout(() => runSync(true), 15_000)
  })
  setInterval(() => {
    if (!document.hidden) runSync(true)
  }, 5 * 60_000)
  window.addEventListener('online', () => runSync(true))
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // leaving the app: push what is pending now rather than in 15 s
      if (timer) {
        clearTimeout(timer)
        timer = undefined
        runSync(true)
      }
    } else refreshStatus()
  })
}

export function ago(t: number) {
  if (!t) return 'never'
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
