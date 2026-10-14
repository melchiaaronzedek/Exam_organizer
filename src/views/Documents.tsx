import { useEffect, useRef, useState } from 'react'
import { useApp } from '../ctx'
import { Icon } from '../components/Icon'
import { DOC_TYPES, addDoc, exportZip, fmtSize, getBlob, importZip, listDocs, removeDoc, updateDoc, type DocType, type VaultDoc } from '../lib/vault'
import { downloadBlob } from '../lib/ics'

export function Documents() {
  const { exams, refreshDocCounts } = useApp()
  const [docs, setDocs] = useState<VaultDoc[]>([])
  const [examId, setExamId] = useState(exams[0]?.id ?? 'other')
  const [type, setType] = useState<DocType>('application')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [filter, setFilter] = useState('all')
  const fileRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)

  const reload = async () => {
    setDocs(await listDocs())
    refreshDocCounts()
  }
  useEffect(() => {
    reload()
  }, [])

  const nameOf = (id: string) => exams.find((e) => e.id === id)?.short ?? 'Other'
  const typeOf = (t: DocType) => DOC_TYPES.find((x) => x.id === t)?.label ?? t

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    for (const f of Array.from(files)) await addDoc(f, f.name, examId, type)
    await reload()
    setBusy(false)
  }

  const open = async (d: VaultDoc) => {
    const blob = await getBlob(d.id)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  const download = async (d: VaultDoc) => {
    const blob = await getBlob(d.id)
    if (blob) downloadBlob(d.name, blob)
  }

  const shown = docs.filter((d) => filter === 'all' || d.examId === filter)

  return (
    <div className="view">
      <header className="view__head">
        <div>
          <h1 className="view__title">Documents</h1>
          <p className="muted">Hall tickets and application forms live only in this browser's storage. Nothing is uploaded anywhere.</p>
        </div>
        <div className="row">
          <button className="btn btn--ghost" onClick={() => zipRef.current?.click()}>
            <Icon name="upload" size={14} /> Import zip
          </button>
          <button className="btn" disabled={!docs.length} onClick={async () => downloadBlob('pariksha-documents.zip', await exportZip())}>
            <Icon name="download" size={14} /> Export zip
          </button>
          <input ref={zipRef} type="file" accept=".zip" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setBusy(true); await importZip(f, new Set(exams.map((x) => x.id))); await reload(); setBusy(false) } e.target.value = '' }} />
        </div>
      </header>

      <div
        className={`drop ${drag ? 'is-drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files) }}
      >
        <div className="drop__controls">
          <label>
            Exam
            <select value={examId} onChange={(e) => setExamId(e.target.value)}>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.short}
                </option>
              ))}
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value as DocType)}>
              {DOC_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn--accent" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Icon name="plus" size={14} /> {busy ? 'Saving…' : 'Add files'}
          </button>
          <input ref={fileRef} type="file" multiple accept=".pdf,image/*" hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }} />
        </div>
        <p className="drop__hint">or drag PDFs / images here · tagged as <strong>{nameOf(examId)}</strong> · {typeOf(type)}</p>
      </div>

      {docs.length ? (
        <div className="filters">
          <button className={`filter ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>
            All <span className="filter__n">{docs.length}</span>
          </button>
          {[...new Set(docs.map((d) => d.examId))].map((id) => (
            <button key={id} className={`filter ${filter === id ? 'is-active' : ''}`} onClick={() => setFilter(id)}>
              {nameOf(id)} <span className="filter__n">{docs.filter((d) => d.examId === id).length}</span>
            </button>
          ))}
        </div>
      ) : null}

      {docs.length === 0 ? (
        <div className="empty">
          <Icon name="documents" size={32} />
          <p>Vault is empty. Add your application forms and hall tickets, or import the organised zip.</p>
        </div>
      ) : (
        <ul className="docs">
          {shown.map((d) => (
            <li key={d.id} className="doc">
              <div className="doc__icon">
                <Icon name={d.mime.startsWith('image/') ? 'image' : 'file'} size={22} />
              </div>
              <div className="doc__body">
                <div className="doc__name" title={d.name}>
                  {d.name}
                </div>
                <div className="doc__meta">
                  <select value={d.examId} onChange={async (e) => { await updateDoc(d.id, { examId: e.target.value }); reload() }}>
                    {exams.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.short}
                      </option>
                    ))}
                    <option value="other">Other</option>
                  </select>
                  <select value={d.type} onChange={async (e) => { await updateDoc(d.id, { type: e.target.value as DocType }); reload() }}>
                    {DOC_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <span className="muted small mono">{fmtSize(d.size)}</span>
                </div>
              </div>
              <div className="doc__actions">
                <button className="iconbtn" onClick={() => open(d)} aria-label="Open">
                  <Icon name="eye" />
                </button>
                <button className="iconbtn" onClick={() => download(d)} aria-label="Download">
                  <Icon name="download" />
                </button>
                <button className="iconbtn iconbtn--danger" onClick={async () => { if (confirm(`Delete ${d.name}?`)) { await removeDoc(d.id); reload() } }} aria-label="Delete">
                  <Icon name="trash" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
