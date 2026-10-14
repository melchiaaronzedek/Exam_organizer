import { useEffect, useState } from 'react'

const Q = '(max-width: 860px)'

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(Q).matches)
  useEffect(() => {
    const mq = window.matchMedia(Q)
    const on = () => setPhone(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}
