import { GOOGLE_CLIENT_ID } from '../config'
import { db } from '../db'

/** Only the app's own hidden folder in the user's Drive; the app cannot see any of their other files. */
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

export class NeedSignIn extends Error {
  constructor() {
    super('Sign in to Google again to sync.')
  }
}

interface Token {
  token: string
  exp: number
}

let testMode = false
/** Developer testing against a local stand-in for Drive (see scripts/fake-drive.mjs). */
export function enableTestMode() {
  testMode = true
}

export const syncAvailable = () => testMode || !!GOOGLE_CLIENT_ID

const redirectUri = () => location.origin + location.pathname

/**
 * Full-page sign-in (works inside an installed app, where pop-ups often do not).
 * Google sends the browser back to the app with the token in the address.
 */
export function startSignIn(email?: string) {
  const state = crypto.randomUUID()
  sessionStorage.setItem('oauthState', state)
  sessionStorage.setItem('oauthReturn', location.hash || '#/settings')
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  })
  if (email) p.set('login_hint', email)
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p.toString())
}

/** Run once at start-up, before the app reads the address. Returns a message if sign-in failed. */
export async function finishSignIn(): Promise<string | null> {
  const h = location.hash.slice(1)
  if (!/(^|&)(access_token|error)=/.test(h)) return null
  const p = new URLSearchParams(h)
  const back = sessionStorage.getItem('oauthReturn') || '#/settings'
  const expected = sessionStorage.getItem('oauthState')
  sessionStorage.removeItem('oauthState')
  history.replaceState(null, '', location.pathname + back)
  if (!expected || p.get('state') !== expected) return 'Google sign-in did not complete. Please try again.'
  if (p.get('error')) return p.get('error') === 'access_denied' ? 'Google access was not allowed.' : `Google sign-in failed (${p.get('error')}).`
  const token = p.get('access_token')
  if (!token) return 'Google sign-in failed.'
  const granted = p.get('scope') ?? SCOPE
  if (!granted.includes('drive.appdata')) return 'Google Drive access was not allowed. Tick the Drive box when signing in.'
  const exp = Date.now() + (Number(p.get('expires_in')) || 3600) * 1000 - 60_000
  await db.local.put({ key: 'token', value: { token, exp } satisfies Token })
  sessionStorage.setItem('justSignedIn', '1')
  return null
}

export async function hasValidToken() {
  if (testMode) return true
  const t = (await db.local.get('token'))?.value as Token | undefined
  return !!t && t.exp > Date.now()
}

async function token() {
  const t = (await db.local.get('token'))?.value as Token | undefined
  if (!t || t.exp <= Date.now()) throw new NeedSignIn()
  return t.token
}

async function call(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await token()}` } })
  if (res.status === 401) {
    await db.local.delete('token')
    throw new NeedSignIn()
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json())?.error?.message ?? ''
    } catch {
      /* not json */
    }
    throw new Error(`Google Drive error ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  return res
}

export interface DriveFile {
  id: string
  name: string
  modifiedTime: string
  size?: string
}

export async function listFiles(): Promise<DriveFile[]> {
  const out: DriveFile[] = []
  let pageToken = ''
  do {
    const p = new URLSearchParams({
      spaces: 'appDataFolder',
      fields: 'nextPageToken,files(id,name,modifiedTime,size)',
      pageSize: '1000',
    })
    if (pageToken) p.set('pageToken', pageToken)
    const res = await (await call(`${API}/files?${p}`)).json()
    out.push(...(res.files ?? []))
    pageToken = res.nextPageToken ?? ''
  } while (pageToken)
  return out
}

export async function download(id: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await (await call(`${API}/files/${id}?alt=media`)).arrayBuffer())
}

export async function createFile(name: string, data: Uint8Array<ArrayBuffer>, mime = 'application/octet-stream'): Promise<string> {
  const boundary = 'clinicbook' + crypto.randomUUID()
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify({ name, parents: ['appDataFolder'] }),
    `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    data,
    `\r\n--${boundary}--`,
  ])
  const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  return (await res.json()).id
}

export async function updateFile(id: string, data: Uint8Array<ArrayBuffer>, mime = 'application/octet-stream') {
  await call(`${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': mime }, body: data })
}

export async function deleteFile(id: string) {
  try {
    await call(`${API}/files/${id}`, { method: 'DELETE' })
  } catch (e) {
    if (!String((e as Error).message).includes('404')) throw e
  }
}

export async function whoAmI(): Promise<string> {
  const res = await (await call(`${API}/about?fields=user(emailAddress)`)).json()
  return res.user?.emailAddress ?? ''
}
