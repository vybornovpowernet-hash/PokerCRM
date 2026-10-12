import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/uploads': 'http://127.0.0.1:3001'
    }
  },
  build: {
    outDir: 'dist'
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        pretendToBeVisual: true
      }
    },
    setupFiles: ['./tests/setup.ts']
  }
})
