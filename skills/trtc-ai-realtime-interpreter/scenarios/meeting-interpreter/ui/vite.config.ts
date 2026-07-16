import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 后端默认跑在 https://localhost:8020（backend 下有 cert.pem/key.pem 自动启用 HTTPS）
const BACKEND_TARGET = process.env.VITE_BACKEND_TARGET || 'https://localhost:8020'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // WebRTC 需要安全上下文：localhost 本身满足，开发期不需要 HTTPS
    proxy: {
      '/api': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        secure: false, // 后端用的是自签证书
      },
    },
  },
})
