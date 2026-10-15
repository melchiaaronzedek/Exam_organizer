const paths: Record<string, string> = {
  dashboard: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  exams: 'M4 4h12l4 4v12H4zM16 4v4h4M8 12h8M8 16h8',
  calendar: 'M4 5h16v15H4zM4 10h16M8 3v4M16 3v4',
  updates: 'M4 5a1 1 0 0 1 1-1 15 15 0 0 1 15 15 1 1 0 0 1-1 1M4 11a9 9 0 0 1 9 9M5 19a1 1 0 1 0 0 .01',
  documents: 'M3 6h6l2 2h10v12H3zM3 6V5',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  external: 'M14 4h6v6M20 4l-9 9M19 14v6H4V5h6',
  pin: 'M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  lock: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  check: 'M5 12l5 5L20 7',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  download: 'M12 4v12M6 11l6 6 6-6M4 20h16',
  upload: 'M12 16V4M6 9l6-6 6 6M4 20h16',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  alert: 'M12 3l10 18H2zM12 10v4M12 17.5v.5',
  chevron: 'M9 6l6 6-6 6',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  edit: 'M4 20h4l11-11-4-4L4 16zM13 7l4 4',
  x: 'M6 6l12 12M18 6L6 18',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M16 9a1 1 0 1 0 0-.01',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  send: 'M3 11l18-8-8 18-2-8z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  city: 'M3 21h18M5 21V8l5-3v16M14 21V11l5-2v12M8 9v.01M8 13v.01M8 17v.01M17 13v.01M17 17v.01',
}

export function Icon({ name, size = 18, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={paths[name] ?? paths.alert} />
    </svg>
  )
}
