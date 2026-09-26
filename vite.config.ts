/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_CONFIG } from './src/config/app.ts';

/**
 * Dev-only: serve the serverless functions in /api from the Vite dev server so
 * `npm run dev` works like Vercel. GEMINI_API_KEY is read from .env.local on the
 * server side only (it is not VITE_-prefixed, so it never reaches the bundle).
 */
function devApi(): Plugin {
  return {
    name: 'lifeforge-dev-api',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '');
      for (const k of ['GEMINI_API_KEY', 'GEMINI_MODEL']) if (env[k] && !process.env[k]) process.env[k] = env[k];
      server.middlewares.use(async (req, res, next) => {
        const route = req.url?.split('?')[0];
        if (!route || !['/api/ai', '/api/food', '/api/status'].includes(route)) return next();
        try {
          const mod = await server.ssrLoadModule('/server/ai/handlers.ts');
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
          });
          const handler = route === '/api/ai' ? mod.handleChat : route === '/api/food' ? mod.handleFood : mod.handleStatus;
          const response: Response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    devApi(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'icons/*.png'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
      },
      manifest: {
        id: '/',
        name: APP_CONFIG.displayName,
        short_name: APP_CONFIG.shortName,
        description: `${APP_CONFIG.displayName} — ${APP_CONFIG.tagline}`,
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#f4f4f7',
        background_color: '#ffffff',
        categories: ['health', 'fitness', 'productivity', 'games', 'lifestyle'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('recharts') || id.includes('d3-')) return 'charts';
            if (id.includes('motion')) return 'motion';
            if (id.includes('dexie')) return 'dexie';
            if (id.includes('react')) return 'react';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
