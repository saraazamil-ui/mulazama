import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Separate artifact: the release build cannot accidentally enable synthetic access.
export default defineConfig(({ mode }) => {
  if (mode !== 'test') throw Error('V211_PREVIEW_REQUIRES_TEST_MODE');
  return {
    plugins: [react(), {
      name: 'private-preview-paths',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          let path: string;
          try { path = decodeURIComponent((request.url ?? '/').split('?')[0]); }
          catch { response.statusCode = 400; response.end('INVALID_PATH'); return; }
          // Source files needed by Vite are local development only. Content/review
          // artifacts are deliberately unavailable even on this private server.
          if (/^\/(?:content|references|docs|attachments)(?:\/|$)/.test(path) || /\.(?:docx|xml|txt)$/.test(path) || path.startsWith('/@fs/')) {
            response.statusCode = 404; response.end('NOT_FOUND'); return;
          }
          next();
        });
      },
    }],
    base: './',
    publicDir: false,
    server: { host: '127.0.0.1', port: 4181, strictPort: true },
    build: { outDir: 'dist-v211', rollupOptions: { input: 'v211.html' } },
  };
});
