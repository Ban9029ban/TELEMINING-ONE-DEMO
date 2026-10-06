import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const allowedHosts = (process.env.VITE_ALLOWED_HOSTS || 'localhost,127.0.0.1,devtm.denial.cl,stagtm.denial.cl,10.18.43.147,10.18.43.171,10.24.203.38')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts,
  },
})
