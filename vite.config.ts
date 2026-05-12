import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Dev-only HTTP proxy to privchat-application. Same-origin from
    // the browser's perspective → no CORS preflight on `/auth/*`.
    // Path is `/app/*` (the production route-group prefix), so the
    // browser-visible URL is identical to production
    // (`/app/auth/sms-login` etc.) — no synthetic `/__platform/`
    // prefix to confuse anyone reading network panel. Override the
    // upstream via `VITE_PRIVCHAT_DEV_PLATFORM_PROXY` (defaults to
    // localhost:8080).
    proxy: {
      '/app': {
        target: process.env.VITE_PRIVCHAT_DEV_PLATFORM_PROXY ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split a few obvious vendor groups out of the main app
        // bundle. Goal: keep main < 500 KB so the chunk-size warning
        // stops being noise, AND give CDNs / browser cache a chance
        // to dedupe stable vendor code across deploys.
        //
        //   - react / react-dom / scheduler: changes least, biggest
        //     cache win across deploys
        //   - @radix-ui/*: large but stable; updating one primitive
        //     shouldn't bust the rest of the vendor cache
        //   - privchat SDK + react integration: changes per release,
        //     but separately from app code, so app-only patches
        //     don't re-download these
        //   - i18next family: medium, low churn
        //   - lucide icons: tree-shaken but the imports still total
        //     a chunk; isolating them keeps app-shell hot updates
        //     from invalidating the icon cache
        //
        // Anything else stays in the main app chunk. No per-feature
        // splits beyond what the lazy() boundaries already produce —
        // overly-fine manualChunks defeats HTTP/2 multiplexing and
        // makes the waterfall slower instead of faster.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/')
            ) {
              return 'vendor-react';
            }
            if (id.includes('@radix-ui/')) return 'vendor-radix';
            if (
              id.includes('i18next') ||
              id.includes('react-i18next')
            ) {
              return 'vendor-i18n';
            }
            if (id.includes('lucide-react')) return 'vendor-icons';
          }
          // Linked workspace packages — these resolve to absolute
          // paths (file: deps), not node_modules.
          if (
            id.includes('/privchat-sdk-typescript/') ||
            id.includes('/privchat-react/')
          ) {
            return 'vendor-privchat';
          }
          return undefined;
        },
      },
    },
  },
});
