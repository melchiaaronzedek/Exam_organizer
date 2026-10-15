/** Plain text out of a string that may carry HTML tags or entities (portal descriptions stored before the scraper cleaned them). */
export function plainText(s?: string | null): string {
  if (!s) return ''
  let t = String(s)
  if (/[<&]/.test(t)) {
    try {
      const doc = new DOMParser().parseFromString(t.replace(/<\s*(br|\/p|\/li|\/div|\/h\d|\/tr)\s*\/?>/gi, ' '), 'text/html')
      t = doc.body?.textContent ?? t
    } catch {
      t = t.replace(/<[^>]+>/g, ' ')
    }
  }
  return t.replace(/[ ​﻿]/g, ' ').replace(/\s+/g, ' ').trim()
}
