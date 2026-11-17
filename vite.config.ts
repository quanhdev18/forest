import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Spotify yêu cầu Redirect URI khớp chính xác; dùng 127.0.0.1 cố định cổng 5173
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
})
