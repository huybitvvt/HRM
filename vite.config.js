import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const attendanceNetworkDevPlugin = () => ({
  name: 'attendance-network-dev-endpoint',
  configureServer(server) {
    server.middlewares.use('/api/attendance-network', (req, res) => {
      if (req.method !== 'GET') {
        res.statusCode = 405
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Chỉ hỗ trợ phương thức GET.' }))
        return
      }
      const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      const rawIp = forwarded || req.socket?.remoteAddress || ''
      const ip = String(rawIp).replace(/^::ffff:/i, '').trim() || null
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify({ ip, timestamp: new Date().toISOString() }))
    })
  }
})

export default defineConfig({
  plugins: [react(), attendanceNetworkDevPlugin()],
  server: {
    port: 3000,
    open: true
  }
})

