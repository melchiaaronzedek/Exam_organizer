// Post-build: encrypt the published data and documents with the site passphrase (AES-256-GCM, PBKDF2-SHA256 key).
// Without SITE_PASSPHRASE the build stays open for local work; in CI that is an error so an unlocked site never ships.
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const pass = process.env.SITE_PASSPHRASE
if (!pass) {
  if (process.env.CI) {
    console.error('lock: SITE_PASSPHRASE secret not set — refusing to publish an unlocked site (add it under Settings → Secrets and variables → Actions)')
    process.exit(1)
  }
  console.log('lock: no SITE_PASSPHRASE, dist left unlocked')
  process.exit(0)
}
const iterations = 310_000
const salt = randomBytes(16)
const key = pbkdf2Sync(pass, salt, iterations, 32, 'sha256')

function enc(buf) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(buf), c.final()])
  return Buffer.concat([iv, ct, c.getAuthTag()]) // iv ‖ ciphertext ‖ tag — what WebCrypto's AES-GCM decrypt expects after the iv
}

function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

let n = 0
for (const d of ['data', 'documents']) {
  for (const f of walk(join(DIST, d))) {
    if (f.endsWith('.enc')) continue
    writeFileSync(f + '.enc', enc(readFileSync(f)))
    unlinkSync(f)
    n++
  }
}
writeFileSync(join(DIST, 'lock.json'), JSON.stringify({ v: 1, salt: salt.toString('base64'), iterations, check: enc(Buffer.from('jennys-tracker')).toString('base64') }))
console.log(`lock: encrypted ${n} files; lock.json written`)
