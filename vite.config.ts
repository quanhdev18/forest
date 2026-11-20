import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Khi dev ở máy: /api/tiktok chạy thẳng file api/tiktok.ts (giống Vercel Function trên production),
// không cần server riêng. Key bí mật (QPost, R2, Gemini) đọc từ .env.local, không gửi xuống trình duyệt.
function localApi(): Plugin {
  return {
    name: 'forest-local-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/tiktok')) return next()
        try {
          const mod = await server.ssrLoadModule('/api/tiktok.ts')
          const handler = mod[req.method ?? 'GET'] as ((r: Request) => Promise<Response>) | undefined
          if (!handler) {
            res.statusCode = 405
            return res.end()
          }
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
          const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0
          const r = await handler(new Request(`http://${req.headers.host}${req.url}`, {
            method: req.method,
            headers,
            body: hasBody ? Buffer.concat(chunks) : undefined,
          }))
          res.statusCode = r.status
          r.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await r.arrayBuffer()))
        } catch (e) {
          next(e)
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // nạp mọi biến trong .env.local (kể cả không có tiền tố VITE_) cho API chạy ở máy.
  // Ghi đè mỗi lần Vite khởi động lại, để sửa .env.local là có hiệu lực ngay.
  const fileEnv = loadEnv(mode, process.cwd(), '')
  for (const [k, v] of Object.entries(fileEnv)) process.env[k] = v

  return {
    plugins: [react(), localApi()],
    // Spotify yêu cầu Redirect URI khớp chính xác; dùng 127.0.0.1 cố định cổng 5173
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  }
})
