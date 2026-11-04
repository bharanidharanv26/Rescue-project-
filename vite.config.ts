import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.WEB_PORT || 5173), strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT || 3001}`, ws: true, timeout: 0 } } },
  preview: { proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT || 3001}`, ws: true, timeout: 0 } } },
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
})
