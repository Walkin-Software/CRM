import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
const localCertKey  = path.resolve(__dirname, '../cert/key.pem')
const localCertFile = path.resolve(__dirname, '../cert/cert.pem')
const useHttps = fs.existsSync(localCertKey) && fs.existsSync(localCertFile)

export default defineConfig({
  plugins: [react()],
  server: {
    https: useHttps
      ? { key: fs.readFileSync(localCertKey), cert: fs.readFileSync(localCertFile) }
      : undefined,
    host: '0.0.0.0',
    port: 5173,
  },
})
