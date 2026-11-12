import { enableTestMode } from './drive'
import { setRemote } from './engine'

/**
 * Developer machines only: localStorage.fakeDrive = 'http://127.0.0.1:4599' points sync at
 * scripts/fake-drive.mjs instead of Google Drive, so two browser origins can act as two devices.
 */
export async function connectFakeDriveIfAsked() {
  const base = localStorage.getItem('fakeDrive')
  if (!base) return
  enableTestMode()
  const bytes = async (r: Response) => new Uint8Array(await r.arrayBuffer())
  setRemote({
    list: async () => (await fetch(`${base}/files`)).json(),
    get: async (id) => bytes(await fetch(`${base}/files/${id}`)),
    create: async (name, data) => (await (await fetch(`${base}/files?name=${encodeURIComponent(name)}`, { method: 'POST', body: data })).json()).id,
    update: async (id, data) => {
      await fetch(`${base}/files/${id}`, { method: 'PUT', body: data })
    },
    remove: async (id) => {
      await fetch(`${base}/files/${id}`, { method: 'DELETE' })
    },
    who: async () => 'test@example.com',
  })
}
