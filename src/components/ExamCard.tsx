import { useState } from 'react'
import type { Exam, ExamOverride, PhaseOverride, RepoDoc } from '../types'
import { StatusChip } from './StatusChip'
import { PhaseStepper } from './PhaseStepper'
import { Icon } from './Icon'
import { cityOf, mapsUrl, nextPhase } from '../lib/data'
import { daysUntil, fmtShort, isoToday, relative } from '../lib/dates'
import { DOC_TYPES } from '../lib/vault'

interface Props {
  exam: Exam
  override?: ExamOverride
  docCount?: number
  files?: RepoDoc[]
  onOverride: (patch: Partial<ExamOverride>) => void
  onPhaseChange: (phaseId: string, patch: PhaseOverride) => void
  onDeleteCustom?: () => void
  defaultOpen?: boolean
}

const base = import.meta.env.BASE_URL

export function ExamCard({ exam, override, docCount = 0, files = [], onOverride, onPhaseChange, onDeleteCustom, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const next = nextPhase(exam)
  const closes = exam.application.closes
  const closeDays = daysUntil(closes)
  const applyOpen = !exam.application.applied && closes && closeDays != null && closeDays >= 0
  const nextCity = cityOf(next)
  const carry = exam.facts?.carry ?? []
  const checked = new Set(override?.checklist ?? [])
  const toggle = (item: string) => {
    const s = new Set(checked)
    s.has(item) ? s.delete(item) : s.add(item)
    onOverride({ checklist: [...s] })
  }
  const typeLabel = (t: string) => DOC_TYPES.find((x) => x.id === t)?.label ?? t

  return (
    <article className={`card card--${exam.status} ${open ? 'card--open' : ''}`} id={`exam-${exam.id}`}>
      <header className="card__head" onClick={() => setOpen(!open)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)} aria-expanded={open}>
        <div className="card__id">
          <span className="card__org">{exam.org}</span>
          <h3 className="card__title">
            {exam.short}
            <span className="card__sub"> — {exam.post}</span>
          </h3>
        </div>
        <div className="card__right">
          <StatusChip status={exam.status} />
          <Icon name="chevron" className={`card__chev ${open ? 'is-open' : ''}`} />
        </div>
      </header>

      <div className="card__glance">
        {applyOpen ? (
          <div className="glance glance--deadline">
            <Icon name="alert" size={14} />
            <span>
              Apply by <strong className="mono">{fmtShort(closes)}</strong> · {relative(closeDays)}
              {exam.application.mode === 'offline' ? ' · offline form' : ''}
            </span>
          </div>
        ) : null}
        {next ? (
          <div className="glance">
            <Icon name="clock" size={14} />
            <span>
              {next.name} · <strong className="mono">{fmtShort(next.date)}</strong> · {relative(daysUntil(next.date))}
              {next.dateType === 'tentative' ? ' (tentative)' : ''}
            </span>
          </div>
        ) : (
          <div className="glance muted">
            <Icon name="clock" size={14} />
            <span>Next date not announced yet</span>
          </div>
        )}
        {nextCity ? (
          <div className="glance">
            <Icon name="pin" size={14} />
            <span>{next?.centre?.allotted ? nextCity : `${nextCity} (pref. 1)`}</span>
          </div>
        ) : null}
        {files.length ? (
          <div className="glance muted">
            <Icon name="file" size={14} />
            <span>{files.length} file{files.length > 1 ? 's' : ''}</span>
          </div>
        ) : null}
        {docCount ? (
          <div className="glance muted">
            <Icon name="documents" size={14} />
            <span>{docCount} in vault</span>
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="card__body">
          <div className="card__actions">
            <a className="btn btn--ghost" href={exam.officialUrl} target="_blank" rel="noreferrer">
              <Icon name="external" size={14} /> Official site
            </a>
            {exam.notificationUrl ? (
              <a className="btn btn--ghost" href={exam.notificationUrl} target="_blank" rel="noreferrer">
                <Icon name="file" size={14} /> Notices
              </a>
            ) : null}
            {nextCity ? (
              <a className="btn btn--ghost" href={mapsUrl(override?.phases?.[next!.id]?.venue || nextCity)} target="_blank" rel="noreferrer">
                <Icon name="pin" size={14} /> Map
              </a>
            ) : null}
            {!exam.application.applied ? (
              <>
                {exam.applyUrl ? (
                  <a className="btn btn--accent" href={exam.applyUrl} target="_blank" rel="noreferrer">
                    <Icon name="send" size={14} /> Apply now
                  </a>
                ) : null}
                <button className="btn" onClick={() => onOverride({ applied: true, appliedOn: isoToday(), status: 'applied' })}>
                  <Icon name="check" size={14} /> Mark as applied
                </button>
              </>
            ) : (
              <span className="applied-on mono">
                Applied{exam.application.appliedOn ? ` on ${fmtShort(exam.application.appliedOn)}` : ''}
              </span>
            )}
            <label className="select-inline">
              Status
              <select value={exam.status} onChange={(e) => onOverride({ status: e.target.value as Exam['status'] })}>
                <option value="to-apply">To apply</option>
                <option value="applied">Applied</option>
                <option value="written">Written</option>
                <option value="result-awaited">Result awaited</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            {onDeleteCustom ? (
              <button className="btn btn--danger" onClick={onDeleteCustom}>
                <Icon name="trash" size={14} /> Remove
              </button>
            ) : null}
          </div>

          <div className="card__cols">
            <div className="card__main">
              <dl className="facts">
                <div>
                  <dt>Title</dt>
                  <dd>{exam.title}</dd>
                </div>
                {exam.advt ? (
                  <div>
                    <dt>Advertisement</dt>
                    <dd>{exam.advt}</dd>
                  </div>
                ) : null}
                {exam.application.opens || exam.application.closes ? (
                  <div>
                    <dt>Application window</dt>
                    <dd className="mono">
                      {exam.application.opens ? fmtShort(exam.application.opens) : '—'} → {exam.application.closes ? fmtShort(exam.application.closes) : '—'}
                      {exam.application.mode ? ` · ${exam.application.mode}` : ''}
                    </dd>
                  </div>
                ) : null}
                {exam.application.note ? (
                  <div>
                    <dt>Application note</dt>
                    <dd>{exam.application.note}</dd>
                  </div>
                ) : null}
              </dl>

              <h4 className="card__h4">Phases & centres</h4>
              <PhaseStepper exam={exam} override={override} onPhaseChange={onPhaseChange} />

              {exam.notes?.length ? (
                <ul className="notes">
                  {exam.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </div>

            <aside className="card__side">
              {exam.facts ? (
                <div className="sidebox">
                  <h4 className="card__h4">Quick facts</h4>
                  <dl className="qf">
                    {exam.facts.vacancies ? <Row k="Vacancies" v={exam.facts.vacancies} /> : null}
                    {exam.facts.age ? <Row k="Age" v={exam.facts.age} /> : null}
                    {exam.facts.fee ? <Row k="Fee" v={exam.facts.fee} /> : null}
                    {exam.facts.pay ? <Row k="Pay" v={exam.facts.pay} /> : null}
                    {exam.facts.selection ? <Row k="Selection" v={exam.facts.selection} /> : null}
                    {exam.facts.pattern ? <Row k="Pattern" v={exam.facts.pattern} /> : null}
                  </dl>
                  <p className="muted small">As per notification / public sources. Verify on the official notice.</p>
                </div>
              ) : null}

              {carry.length ? (
                <div className="sidebox">
                  <h4 className="card__h4">
                    Exam-day checklist <span className="muted">{checked.size}/{carry.length}</span>
                  </h4>
                  <ul className="checklist">
                    {carry.map((item) => (
                      <li key={item}>
                        <label className={`check ${checked.has(item) ? 'is-done' : ''}`}>
                          <input type="checkbox" checked={checked.has(item)} onChange={() => toggle(item)} />
                          <span>{item}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {files.length ? (
                <div className="sidebox">
                  <h4 className="card__h4">Files</h4>
                  <ul className="filelist">
                    {files.map((f) => (
                      <li key={f.url}>
                        <a href={`${base}${f.url}`} target="_blank" rel="noreferrer" className="filelist__name">
                          <Icon name="file" size={14} /> {f.name}
                        </a>
                        <span className="muted small">{typeLabel(f.type)}</span>
                        <a href={`${base}${f.url}`} download={f.file} className="iconbtn iconbtn--ghost" aria-label="Download">
                          <Icon name="download" size={14} />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </aside>
          </div>

          <div className="private">
            <h4 className="card__h4">
              Private notes <span className="muted">(stored only in this browser)</span>
            </h4>
            <div className="private__grid">
              <label>
                Registration / roll no.
                <input type="text" value={override?.regNo ?? ''} onChange={(e) => onOverride({ regNo: e.target.value })} placeholder="Kept on this device" />
              </label>
              <label className="editor__wide">
                Notes
                <textarea rows={2} value={override?.notes ?? ''} onChange={(e) => onOverride({ notes: e.target.value })} placeholder="Password hints, shift timing, travel plan…" />
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  )
}
