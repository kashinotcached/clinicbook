const enc = new TextEncoder()

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, usage: KeyUsage[]) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  )
}

const MAGIC = enc.encode('CLBK1')

/** File layout: "CLBK1" | salt(16) | iv(12) | AES-256-GCM ciphertext */
export async function encrypt(data: Uint8Array<ArrayBuffer>, password: string): Promise<Uint8Array<ArrayBuffer>> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, ['encrypt'])
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data))
  const out = new Uint8Array(MAGIC.length + 16 + 12 + cipher.length)
  out.set(MAGIC, 0)
  out.set(salt, MAGIC.length)
  out.set(iv, MAGIC.length + 16)
  out.set(cipher, MAGIC.length + 28)
  return out
}

export async function decrypt(file: Uint8Array<ArrayBuffer>, password: string): Promise<Uint8Array<ArrayBuffer>> {
  for (let i = 0; i < MAGIC.length; i++)
    if (file[i] !== MAGIC[i]) throw new Error('This is not a ClinicBook backup file.')
  const salt = file.slice(MAGIC.length, MAGIC.length + 16)
  const iv = file.slice(MAGIC.length + 16, MAGIC.length + 28)
  const key = await deriveKey(password, salt, ['decrypt'])
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, file.slice(MAGIC.length + 28)))
  } catch {
    throw new Error('Wrong backup password, or the file is damaged.')
  }
}

/** For the app PIN: a slow hash so the stored value cannot simply be reversed. */
export async function hashPin(pin: string, saltHex?: string) {
  const salt = saltHex
    ? new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)))
    : crypto.getRandomValues(new Uint8Array(16))
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' }, base, 256)
  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return { salt: hex(salt), hash: hex(new Uint8Array(bits)) }
}
