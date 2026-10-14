import { useState } from 'react'
import { useApp } from '../ctx'
import { ExamCard } from '../components/ExamCard'
import { Icon } from '../components/Icon'
import type { Exam, ExamStatus } from '../types'
import { STATUS_LABEL } from '../lib/data'

const FILTERS: (ExamStatus | 'all')[] = ['all', 'to-apply', 'applied', 'written', 'result-awaited', 'closed']

export function Exams() {
  const { exams, overrides, docCounts, setOverride, setPhase, addCustomExam, removeCustomExam } = useApp()
  const [filter, setFilter] = useState<ExamStatus | 'all'>('all')
  const [adding, setAdding] = useState(false)
  const list = exams.filter((e) => filter === 'all' || e.status === filter)
  return (
    <div className="view">
      <header className="view__head">
        <div>
          <h1 className="view__title">Exams</h1>
          <p className="muted">Every phase, date and centre. Click a card to expand; edits stay in this browser.</p>
        </div>
        <button className="btn btn--accent" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> Add exam
        </button>
      </header>
      <div className="filters">
        {FILTERS.map((f) => (
          <button key={f} className={`filter ${filter === f ? 'is-active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : STATUS_LABEL[f]}
            <span className="filter__n">{f === 'all' ? exams.length : exams.filter((e) => e.status === f).length}</span>
          </button>
        ))}
      </div>
      {adding ? <AddExam onCancel={() => setAdding(false)} onAdd={(ex) => { addCustomExam(ex); setAdding(false) }} /> : null}
      <div className="cards">
        {list.map((ex) => (
          <ExamCard
            key={ex.id}
            exam={ex}
            override={overrides[ex.id]}
            docCount={docCounts[ex.id] ?? 0}
            onOverride={(p) => setOverride(ex.id, p)}
            onPhaseChange={(pid, p) => setPhase(ex.id, pid, p)}
            onDeleteCustom={ex.custom ? () => removeCustomExam(ex.id) : undefined}
          />
        ))}
        {list.length === 0 ? <p className="muted">No exams in this filter.</p> : null}
      </div>
    </div>
  )
}

function AddExam({ onAdd, onCancel }: { onAdd: (e: Exam) => void; onCancel: () => void }) {
  const [short, setShort] = useState('')
  const [org, setOrg] = useState('')
  const [post, setPost] = useState('')
  const [url, setUrl] = useState('')
  const [closes, setCloses] = useState('')
  const [examDate, setExamDate] = useState('')
  const [centre, setCentre] = useState('')
  const [status, setStatus] = useState<ExamStatus>('to-apply')
  const valid = short.trim() && org.trim()
  return (
    <form
      className="addform"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        const id = `custom-${short.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`
        onAdd({
          id,
          org,
          short,
          title: `${short} — ${post || 'custom exam'}`,
          post: post || '—',
          status,
          officialUrl: url || '#',
          application: { closes: closes || undefined, applied: status !== 'to-apply' },
          phases: [
            ...(closes ? [{ id: 'apply', name: 'Application deadline', kind: 'application' as const, date: closes, dateType: 'confirmed' as const, status: 'upcoming' as const }] : []),
            { id: 'exam', name: 'Exam', kind: 'exam' as const, date: examDate || undefined, dateType: examDate ? ('tentative' as const) : ('tba' as const), status: examDate ? ('upcoming' as const) : ('tba' as const), centre: { preferences: centre ? centre.split(',').map((s) => s.trim()).filter(Boolean) : [], allotted: null } },
            { id: 'result', name: 'Result', kind: 'result' as const, dateType: 'tba' as const, status: 'tba' as const },
          ],
          custom: true,
        })
      }}
    >
      <h3>New exam</h3>
      <div className="addform__grid">
        <label>
          Short name*
          <input value={short} onChange={(e) => setShort(e.target.value)} placeholder="e.g. RBI Grade B" required />
        </label>
        <label>
          Organisation*
          <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Reserve Bank of India" required />
        </label>
        <label>
          Post
          <input value={post} onChange={(e) => setPost(e.target.value)} placeholder="Officer Grade B (General)" />
        </label>
        <label>
          Official URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </label>
        <label>
          Application closes
          <input type="date" value={closes} onChange={(e) => setCloses(e.target.value)} />
        </label>
        <label>
          Exam date
          <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
        </label>
        <label>
          Centre preferences (comma separated)
          <input value={centre} onChange={(e) => setCentre(e.target.value)} placeholder="Chennai, Visakhapatnam" />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as ExamStatus)}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="addform__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn--accent" disabled={!valid}>
          <Icon name="plus" size={14} /> Add
        </button>
      </div>
    </form>
  )
}
