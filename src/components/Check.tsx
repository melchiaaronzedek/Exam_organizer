interface Props {
  checked: boolean
  onChange: () => void
  label: string
}

/** Checkbox whose tick draws in; the native input stays for a11y and keyboard. */
export function Check({ checked, onChange, label }: Props) {
  return (
    <label className={`check ${checked ? 'is-done' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="check__box" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="12" height="12">
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
        </svg>
      </span>
      <span className="check__label">{label}</span>
    </label>
  )
}
