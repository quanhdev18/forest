import { format } from 'date-fns'
import { vi } from 'date-fns/locale'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

/** yyyy-MM-dd key for a date */
export const dkey = (d: Date | string) => format(typeof d === 'string' ? new Date(d) : d, 'yyyy-MM-dd')

export const fmt = (d: Date | string, pattern: string) =>
  format(typeof d === 'string' ? new Date(d) : d, pattern, { locale: vi })

export const money = (n: number) => n.toLocaleString('vi-VN') + ' ₫'

/** parse 'yyyy-MM-dd' as local date (not UTC) */
export const parseKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
