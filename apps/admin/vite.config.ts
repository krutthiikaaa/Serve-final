import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Admin portal — http://localhost:5174 in development, served under /admin/ in
 * builds (the single-domain deployment, see docs/deployment.md).
 * Production builds refuse a localhost or plain-http API. Without
 * VITE_API_URL a build calls the origin that serves it. Sign-in (Google via
 * Better Auth) is entirely backend-side: no auth secret or key is built in.
 */
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (mode === 'production') {
    if (env.VITE_API_URL && !env.VITE_API_URL.startsWith('https://'))
      throw new Error('VITE_API_URL must use https in production (or be unset for same-origin)');
    if (/localhost|127\.0\.0\.1/.test(env.VITE_API_URL ?? ''))
      throw new Error('VITE_API_URL must not point at localhost in production');
  }
  return {
    base: command === 'build' ? '/admin/' : '/',
    plugins: [react()],
    server: { port: 5174, strictPort: true },
    preview: { port: 4174, strictPort: true },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'auth', test: /node_modules[\\/](better-auth|@better-auth|better-call)/ },
              { name: 'vendor', test: /node_modules/ },
            ],
          },
        },
      },
    },
    resolve: {
      dedupe: ['react', 'react-dom', 'react-router-dom', 'better-auth', 'socket.io-client'],
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
      env: {
        VITE_API_URL: 'http://localhost:5001',
      },
    },
  };
});
