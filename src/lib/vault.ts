import { get, set, del, keys } from 'idb-keyval'
import JSZip from 'jszip'

export type DocType = 'application' | 'hall-ticket' | 'photo' | 'receipt' | 'result' | 'notification' | 'other'

export const DOC_TYPES: { id: DocType; label: string }[] = [
  { id: 'application', label: 'Application form' },
  { id: 'hall-ticket', label: 'Hall ticket / admit card' },
  { id: 'notification', label: 'Official notification' },
  { id: 'receipt', label: 'Fee receipt' },
  { id: 'photo', label: 'Photo / signature' },
  { id: 'result', label: 'Result / scorecard' },
  { id: 'other', label: 'Other' },
]

export interface VaultDoc {
  id: string
  name: string
  examId: string
  type: DocType
  mime: string
  size: number
  addedAt: string
}

const INDEX = 'vault:index'
const blobKey = (id: string) => `vault:blob:${id}`

export async function listDocs(): Promise<VaultDoc[]> {
  return (await get<VaultDoc[]>(INDEX)) ?? []
}

async function saveIndex(list: VaultDoc[]) {
  await set(INDEX, list)
}

export async function addDoc(file: File | Blob, name: string, examId: string, type: DocType): Promise<VaultDoc> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const doc: VaultDoc = {
    id,
    name,
    examId,
    type,
    mime: file.type || guessMime(name),
    size: file.size,
    addedAt: new Date().toISOString(),
  }
  await set(blobKey(id), file)
  const list = await listDocs()
  await saveIndex([doc, ...list])
  return doc
}

export async function updateDoc(id: string, patch: Partial<Pick<VaultDoc, 'name' | 'examId' | 'type'>>) {
  const list = await listDocs()
  await saveIndex(list.map((d) => (d.id === id ? { ...d, ...patch } : d)))
}

export async function removeDoc(id: string) {
  await del(blobKey(id))
  const list = await listDocs()
  await saveIndex(list.filter((d) => d.id !== id))
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  return get<Blob>(blobKey(id))
}

export async function clearVault() {
  const all = await keys()
  await Promise.all(all.filter((k) => String(k).startsWith('vault:')).map((k) => del(k)))
}

function guessMime(name: string) {
  const ext = name.toLowerCase().split('.').pop()
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  return 'application/octet-stream'
}

/** Zip layout: <examId>/<type>__<filename> plus manifest.json. */
export async function exportZip(): Promise<Blob> {
  const zip = new JSZip()
  const list = await listDocs()
  const manifest: VaultDoc[] = []
  for (const d of list) {
    const blob = await getBlob(d.id)
    if (!blob) continue
    zip.file(`${d.examId}/${d.type}__${d.name}`, blob)
    manifest.push(d)
  }
  zip.file('manifest.json', JSON.stringify({ exportedAt: new Date().toISOString(), docs: manifest }, null, 2))
  return zip.generateAsync({ type: 'blob' })
}

export async function importZip(file: File, validExamIds: Set<string>): Promise<number> {
  const zip = await JSZip.loadAsync(file)
  let count = 0
  const entries = Object.values(zip.files).filter((f) => !f.dir && !f.name.endsWith('manifest.json'))
  for (const entry of entries) {
    const parts = entry.name.split('/').filter(Boolean)
    if (parts.length < 2) continue
    const examId = validExamIds.has(parts[0]) ? parts[0] : 'other'
    const fname = parts[parts.length - 1]
    const [maybeType, ...rest] = fname.split('__')
    const type = (rest.length && DOC_TYPES.some((t) => t.id === maybeType) ? maybeType : 'other') as DocType
    const name = rest.length ? rest.join('__') : fname
    const blob = await entry.async('blob')
    await addDoc(new Blob([blob], { type: guessMime(name) }), name, examId, type)
    count++
  }
  return count
}

export function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
