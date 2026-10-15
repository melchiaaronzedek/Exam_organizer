import { fetchData, isLocked } from './lock'

const base = import.meta.env.BASE_URL
const MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

/** Open or download a published document. Locked builds decrypt it into a Blob first; open builds use the plain URL. */
export async function openDoc(url: string, file: string, mode: 'open' | 'download'): Promise<void> {
  if (!isLocked()) {
    if (mode === 'open') window.open(`${base}${url}`, '_blank', 'noopener')
    else trigger(`${base}${url}`, file)
    return
  }
  const win = mode === 'open' ? window.open('', '_blank') : null // opened in the click itself so the browser allows it
  try {
    const buf = await fetchData(url)
    const ext = (file.split('.').pop() || '').toLowerCase()
    const blobUrl = URL.createObjectURL(new Blob([buf], { type: MIME[ext] ?? 'application/octet-stream' }))
    if (win) win.location.href = blobUrl
    else trigger(blobUrl, file)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
  } catch {
    win?.close()
    throw new Error('Could not open the file')
  }
}

function trigger(href: string, file: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = file
  a.rel = 'noreferrer'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
