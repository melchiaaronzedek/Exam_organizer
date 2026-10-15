/** Passphrase lock: the published build carries only encrypted data; the key is derived in the browser and kept in memory
 *  (and, when the person asks, in localStorage) so the data files can be read. Unlocked builds (local work) pass straight through. */
const base = import.meta.env.BASE_URL
const KEY_STORE = 'jt:lock-key'

interface LockInfo {
  v: number
  salt: string
  iterations: number
  check: string
}

let info: LockInfo | null | undefined // undefined = not checked yet, null = this build is not locked
let key: CryptoKey | null = null
const cache = new Map<string, Promise<ArrayBuffer>>()

const b64 = {
  enc: (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))),
  dec: (s: string): Uint8Array<ArrayBuffer> => {
    const bin = atob(s)
    const out = new Uint8Array(new ArrayBuffer(bin.length))
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  },
}

export async function lockInfo(): Promise<LockInfo | null> {
  if (info !== undefined) return info
  try {
    const r = await fetch(`${base}lock.json?t=${Date.now()}`, { cache: 'no-store' })
    const j = r.ok ? await r.json() : null // a missing file on the preview server answers with the app shell, which fails to parse
    info = j && typeof j.salt === 'string' && typeof j.check === 'string' ? (j as LockInfo) : null
  } catch {
    info = null
  }
  return info
}

export function isLocked(): boolean {
  return !!info
}

export function hasKey(): boolean {
  return !!key
}

function importRaw(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt'])
}

async function decryptWith(k: CryptoKey, buf: ArrayBuffer): Promise<ArrayBuffer> {
  const u = new Uint8Array(buf) as Uint8Array<ArrayBuffer>
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, k, u.slice(12))
}

/** True when the build is open or a remembered key still opens it. */
export async function restoreKey(): Promise<boolean> {
  const i = await lockInfo()
  if (!i) return true
  if (key) return true
  try {
    const stored = localStorage.getItem(KEY_STORE)
    if (!stored) return false
    const k = await importRaw(b64.dec(stored))
    await decryptWith(k, b64.dec(i.check).buffer)
    key = k
    return true
  } catch {
    key = null
    try {
      localStorage.removeItem(KEY_STORE)
    } catch {
      /* storage unavailable */
    }
    return false
  }
}

/** Derive the key from the passphrase and prove it against the build's check value. */
export async function unlock(passphrase: string, remember: boolean): Promise<boolean> {
  const i = await lockInfo()
  if (!i) return true
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64.dec(i.salt), iterations: i.iterations }, material, 256)
  const k = await importRaw(new Uint8Array(bits) as Uint8Array<ArrayBuffer>)
  try {
    await decryptWith(k, b64.dec(i.check).buffer)
  } catch {
    return false
  }
  key = k
  cache.clear()
  if (remember) {
    try {
      localStorage.setItem(KEY_STORE, b64.enc(bits))
    } catch {
      /* storage unavailable */
    }
  }
  return true
}

export function lock(): void {
  key = null
  cache.clear()
  try {
    localStorage.removeItem(KEY_STORE)
  } catch {
    /* storage unavailable */
  }
}

/** Bytes of a published file (data/… or documents/…), decrypted when the build is locked. */
export function fetchData(path: string): Promise<ArrayBuffer> {
  const hit = cache.get(path)
  if (hit) return hit
  const p = (async () => {
    const i = await lockInfo()
    if (!i) {
      const res = await fetch(`${base}${path}?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      return res.arrayBuffer()
    }
    if (!key) throw new Error('locked')
    const res = await fetch(`${base}${path}.enc?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(String(res.status))
    return decryptWith(key, await res.arrayBuffer())
  })()
  cache.set(path, p)
  p.catch(() => cache.delete(path))
  return p
}

export async function fetchJSONData<T>(path: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await fetchData(path))) as T
}
