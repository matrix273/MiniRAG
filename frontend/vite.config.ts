import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
 base: '/app1/',
 plugins: [react()],
 resolve: {
   alias: {
     '@': path.resolve(__dirname, './src'),
   },
 },
 server: {
   port: 5173,
   proxy: {
     '/api': {
       target: 'http://localhost:8000',
       changeOrigin: true,
     },
     // 代理 PDF 文件请求，直接返回静态文件（带缓存）
     '/files': {
       target: 'http://localhost:8000',
       changeOrigin: true,
       configure: (proxy) => {
         proxy.on('proxyRes', (proxyRes) => {
           // 移除流式传输相关的头，添加缓存
           delete proxyRes.headers['transfer-encoding']
           proxyRes.headers['Cache-Control'] = 'public, max-age=3600'
         })
       },
     },
   },
 },
 build: {
   outDir: 'dist',
   assetsDir: 'assets',
 },
})
