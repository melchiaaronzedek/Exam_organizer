import type { DateType, ExamStatus } from '../types'
import { STATUS_LABEL } from '../lib/data'

export function StatusChip({ status }: { status: ExamStatus }) {
  return <span className={`chip chip--${status}`}>{STATUS_LABEL[status]}</span>
}

export function DateTypeTag({ type }: { type: DateType }) {
  if (type === 'confirmed') return null
  return <span className={`tag tag--${type}`}>{type === 'tentative' ? 'tentative' : 'TBA'}</span>
}
