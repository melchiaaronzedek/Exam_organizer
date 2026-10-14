import type { Opportunity, Profile } from '../types'

const SOUTH = ['andhra', 'telangana', 'tamil nadu', 'karnataka', 'chennai', 'hyderabad', 'visakhapatnam', 'vizag', 'bengaluru', 'bangalore', 'tirupati', 'vijayawada', 'all india', 'pan india', 'across india', 'anywhere in india', 'remote']

const EXP_RX = /(?:minimum|min\.?|at least|atleast)?\s*(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+(?:\.\d+)?)?\s*\+?\s*(?:yrs?|years?)('?s)?\s*(?:of\s+)?(?:post[- ]qualification\s+|relevant\s+|prior\s+|work\s+)?exp/

/** Minimum years of experience a notice asks for, or null when it does not ask. Mirror of fit.py. */
export function experienceMin(text: string): number | null {
  const t = text.toLowerCase().replace(/–/g, '-')
  if (/\b(fresher|freshers|no experience|experience not required|without experience)\b/.test(t)) return 0
  const m = EXP_RX.exec(t)
  if (m) return Number(m[1])
  const m2 = /experience\s*(?:of|:)?\s*(?:minimum|min\.?|at least)?\s*(\d+(?:\.\d+)?)\s*\+?\s*(?:yrs?|years?)/.exec(t)
  if (m2) return Number(m2[1])
  return null
}

function textOf(o: Opportunity) {
  return [o.org, o.post, o.eligibility, o.sector, o.track, o.title, o.note, o.experienceText].filter(Boolean).join(' ').toLowerCase()
}

/** True when the listing asks for more experience than the profile allows (default half a year). */
export function needsExperience(o: Opportunity, p: Profile): boolean {
  const max = p.maxExperienceYears ?? 0.5
  if (typeof o.experienceMinYears === 'number') return o.experienceMinYears > max
  const m = experienceMin(textOf(o))
  return m != null && m > max
}

/** Mirror of scraper/fit.py. */
export function fitScore(o: Opportunity, p: Profile): { score: number; why: string[] } {
  const text = textOf(o)
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
  const pay = o.payLakh ?? o.payMinLakh
  if (typeof pay === 'number' && pay >= p.minPayLakh) {
    s += 10
    why.push(`pay ≥ ${p.minPayLakh} LPA`)
  }
  const excl = p.excludeTerms.find((t) => text.includes(t))
  if (excl && !role) {
    s -= 30
    why.push('likely needs ' + excl.trim())
  }
  if (needsExperience(o, p)) {
    const m = typeof o.experienceMinYears === 'number' ? o.experienceMinYears : experienceMin(text)
    why.push(`needs ${m}+ yrs experience`)
    return { score: 0, why }
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

/** Govt / PSU / bank / regulator vs private market listing. */
export function isPrivate(o: Opportunity): boolean {
  return o.sourceType === 'portal' || o.sector === 'private' || o.sector === 'nbfc'
}
