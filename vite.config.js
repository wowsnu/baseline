import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = (env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/api\/?$/, '')
  return {
    plugins: [react()],
    server: { host: true, proxy: { '/api': { target: apiTarget, changeOrigin: true } } },
  }
})
