/**
 * Tỷ giá USD → VND lấy tự động từ nguồn công khai (open.er-api.com, không cần khoá).
 * Đây là tỷ giá tham chiếu trung bình thị trường, cập nhật khoảng mỗi ngày một lần.
 * Giá đã lấy được lưu cache trên máy để vẫn xem được khi mất mạng.
 */
import { create } from 'zustand'
import { useStore } from '../store'

const API = 'https://open.er-api.com/v6/latest/USD'
const REFRESH_MS = 60 * 60 * 1000 // kiểm tra lại mỗi giờ

export const useFxStatus = create<{ loading: boolean; error?: string }>(() => ({ loading: false }))

let inFlight: Promise<void> | null = null

/** Lấy tỷ giá mới nhất và ghi vào store. Gọi nhiều lần cùng lúc chỉ gửi một yêu cầu. */
export function refreshFx(): Promise<void> {
  if (inFlight) return inFlight
  useFxStatus.setState({ loading: true, error: undefined })
  inFlight = (async () => {
    try {
      const res = await fetch(API)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as {
        result?: string
        time_last_update_unix?: number
        rates?: Record<string, number>
      }
      const vnd = json.rates?.VND
      if (json.result !== 'success' || !vnd) throw new Error('Không đọc được tỷ giá VND')
      const updatedAt = new Date((json.time_last_update_unix ?? Date.now() / 1000) * 1000).toISOString()
      useStore.getState().setFx({ usdVnd: vnd, updatedAt })
      useFxStatus.setState({ loading: false, error: undefined })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      useFxStatus.setState({ loading: false, error: msg })
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

/** Gọi một lần khi app khởi động: lấy ngay rồi lặp lại mỗi giờ */
export function startFxAutoRefresh() {
  void refreshFx()
  const t = setInterval(() => void refreshFx(), REFRESH_MS)
  return () => clearInterval(t)
}
