import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/static/app/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8888',
      '/ws': {
        target: 'ws://localhost:8888',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../static/app',
    emptyOutDir: true,
  },
})
