import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@github/spark/hooks': path.resolve(__dirname, './src/hooks/use-kv.ts'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    open: false,
  },
  base: process.env.TAURI_ENV_DEBUG ? '/' : './',
})
