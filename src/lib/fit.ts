import type { Opportunity, Profile } from '../types'

const SOUTH = ['andhra', 'telangana', 'tamil nadu', 'karnataka', 'chennai', 'hyderabad', 'visakhapatnam', 'vizag', 'bengaluru', 'bangalore', 'tirupati', 'vijayawada', 'all india', 'pan india', 'across india', 'anywhere in india']

/** Mirror of scraper/fit.py. */
export function fitScore(o: Opportunity, p: Profile): { score: number; why: string[] } {
  const text = [o.org, o.post, o.eligibility, o.sector, o.track, o.title].filter(Boolean).join(' ').toLowerCase()
  const why: string[] = []
  let s = 0
  const role = p.roles.find((r) => text.includes(r))
  if (role) {
    s += 40
    why.push('role: ' + role)
  }
  if (['mba', 'pgdm', 'management'].some((q) => text.includes(q)) && p.qualifications.includes('mba')) {
    s += 20
    why.push('MBA eligible')
  } else if (['graduate', 'any degree', 'bachelor', 'degree'].some((q) => text.includes(q))) {
    s += 15
    why.push('graduate eligible')
  }
  if (text.includes('agricultur') && p.qualifications.includes('agriculture')) {
    s += 20
    why.push('agriculture degree')
  }
  const sector = (o.sector || '').toLowerCase()
  if (sector && p.sectors.includes(sector)) {
    s += 15
    why.push(sector)
  }
  const locs = ((o.locations ?? []).join(' ') + ' ' + (o.state ?? '') + ' ' + text).toLowerCase()
  if (SOUTH.some((x) => locs.includes(x))) {
    s += 10
    why.push('South / all-India')
  }
  if (typeof o.payLakh === 'number' && o.payLakh >= p.minPayLakh) {
    s += 10
    why.push(`pay ≥ ${p.minPayLakh} LPA`)
  }
  const excl = p.excludeTerms.find((t) => text.includes(t))
  if (excl && !role) {
    s -= 30
    why.push('likely needs ' + excl.trim())
  }
  const exp = /(\d+)\s*\+?\s*(yrs?|years?)'?s?\s*(of\s+)?(post[- ]qualification\s+)?(work\s+)?exp/.exec(text)
  if (exp && Number(exp[1]) >= 2) {
    s -= 35
    why.push(`needs ${exp[1]}+ yrs experience`)
  }
  if (text.includes('deputation') || (text.includes('contract') && text.includes('retired'))) {
    s -= 30
    why.push('deputation / retiree post')
  }
  if (typeof o.ageMax === 'number' && o.ageMax < 26) {
    s -= 20
    why.push('age limit below 26')
  }
  return { score: Math.max(0, Math.min(100, s)), why }
}

export function isSouth(o: Opportunity): boolean {
  const locs = ((o.locations ?? []).join(' ') + ' ' + (o.state ?? '')).toLowerCase()
  return SOUTH.some((x) => locs.includes(x))
}
