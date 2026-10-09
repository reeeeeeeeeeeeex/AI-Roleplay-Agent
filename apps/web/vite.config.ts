import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({ registerType: 'autoUpdate', manifest: { name:'AI Roleplay Agent',short_name:'AI Roleplay',display:'standalone',start_url:'/',theme_color:'#111114',background_color:'#111114',icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}] }, workbox:{navigateFallbackDenylist:[/^\/api\//],globPatterns:['**/*.{js,css,html,svg}']} })],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4310' },
  },
});
