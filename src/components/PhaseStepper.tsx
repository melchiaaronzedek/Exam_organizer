import type { Exam, ExamOverride, Phase, PhaseOverride } from '../types'
import { normalizePhase } from '../lib/data'
import { daysUntil, fmtDate, relative } from '../lib/dates'
import { DateTypeTag } from './StatusChip'
import { Icon } from './Icon'
import { useState } from 'react'

interface Props {
  exam: Exam
  override?: ExamOverride
  onPhaseChange: (phaseId: string, patch: PhaseOverride) => void
}

export function PhaseStepper({ exam, override, onPhaseChange }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <ol className="stepper">
      {exam.phases.map((raw) => {
        const p = normalizePhase(raw)
        const po = override?.phases?.[p.id]
        const d = daysUntil(p.date)
        const isNext = p.status === 'upcoming' && d != null && d >= 0
        return (
          <li key={p.id} className={`step step--${p.status} ${isNext ? 'step--next' : ''}`}>
            <span className="step__dot" aria-hidden="true">
              {p.status === 'done' ? <Icon name="check" size={11} /> : null}
            </span>
            <div className="step__body">
              <div className="step__head">
                <span className="step__name">{p.name}</span>
                <DateTypeTag type={p.dateType} />
                <button className="iconbtn iconbtn--ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(editing === p.id ? null : p.id)}>
                  <Icon name={editing === p.id ? 'x' : 'edit'} size={14} />
                </button>
              </div>
              <div className="step__meta">
                <span className="mono">
                  {p.date ? fmtDate(p.date) : 'Date TBA'}
                  {p.dateEnd ? ` → ${fmtDate(p.dateEnd)}` : ''}
                </span>
                {p.date && p.status !== 'done' ? <span className="step__rel">{relative(d)}</span> : null}
                {p.timeNote ? <span className="muted">{p.timeNote}</span> : null}
              </div>
              <CentreLine p={p} venue={po?.venue} />
              {p.note ? <p className="step__note">{p.note}</p> : null}
              {editing === p.id ? <PhaseEditor p={raw} po={po} onChange={(patch) => onPhaseChange(p.id, patch)} /> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function CentreLine({ p, venue }: { p: Phase; venue?: string }) {
  if (!p.centre && !venue) return null
  const c = p.centre
  return (
    <div className="step__centre">
      <Icon name="pin" size={13} />
      {c?.allotted ? (
        <span>
          <strong>{c.allotted}</strong>
          {venue || c.venue ? <span className="muted"> · {venue || c.venue}</span> : null}
        </span>
      ) : c?.preferences?.length ? (
        <span>
          <span className="muted">Preferences: </span>
          {c.preferences.map((x, i) => (
            <span key={x} className="pref">
              <span className="pref__n">{i + 1}</span>
              {x}
            </span>
          ))}
        </span>
      ) : (
        <span className="muted">Centre not chosen yet</span>
      )}
    </div>
  )
}

function PhaseEditor({ p, po, onChange }: { p: Phase; po?: PhaseOverride; onChange: (patch: PhaseOverride) => void }) {
  const date = po?.date ?? p.date ?? ''
  const dateType = po?.dateType ?? p.dateType
  const allotted = po?.allotted ?? p.centre?.allotted ?? ''
  const venue = po?.venue ?? p.centre?.venue ?? ''
  const status = po?.status ?? p.status
  return (
    <div className="editor">
      <label>
        Date
        <input type="date" value={date} onChange={(e) => onChange({ date: e.target.value, dateType: e.target.value ? (dateType === 'tba' ? 'tentative' : dateType) : 'tba' })} />
      </label>
      <label>
        Certainty
        <select value={dateType} onChange={(e) => onChange({ dateType: e.target.value as Phase['dateType'] })}>
          <option value="confirmed">Confirmed</option>
          <option value="tentative">Tentative</option>
          <option value="tba">TBA</option>
        </select>
      </label>
      <label>
        Status
        <select value={status} onChange={(e) => onChange({ status: e.target.value as Phase['status'] })}>
          <option value="upcoming">Upcoming</option>
          <option value="done">Done</option>
          <option value="tba">TBA</option>
        </select>
      </label>
      <label>
        Allotted city
        <input type="text" placeholder="e.g. Chennai" value={allotted ?? ''} onChange={(e) => onChange({ allotted: e.target.value || null })} />
      </label>
      <label className="editor__wide">
        Venue (kept on this device)
        <input type="text" placeholder="Full venue address from admit card" value={venue} onChange={(e) => onChange({ venue: e.target.value })} />
      </label>
    </div>
  )
}
