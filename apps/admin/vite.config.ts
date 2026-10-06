import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Admin portal — http://localhost:5174 in development.
 * Production builds refuse to run without an explicit API URL or with the
 * Firebase emulator configured, so nothing can fall back to localhost.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (mode === 'production') {
    const missing = ['VITE_API_URL', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID'].filter(
      (key) => !env[key],
    );
    if (missing.length > 0) throw new Error(`Production build requires: ${missing.join(', ')}`);
    if (env.VITE_FIREBASE_AUTH_EMULATOR_URL)
      throw new Error('VITE_FIREBASE_AUTH_EMULATOR_URL must not be set for production builds');
    if (/localhost|127\.0\.0\.1/.test(env.VITE_API_URL ?? ''))
      throw new Error('VITE_API_URL must not point at localhost in production');
  }
  return {
    plugins: [react()],
    server: { port: 5174, strictPort: true },
    preview: { port: 4174, strictPort: true },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'firebase', test: /node_modules[\\/]@firebase/ },
              { name: 'vendor', test: /node_modules/ },
            ],
          },
        },
      },
    },
    resolve: {
      dedupe: [
        'react',
        'react-dom',
        'react-router-dom',
        '@firebase/app',
        '@firebase/auth',
        'socket.io-client',
      ],
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
      env: {
        VITE_API_URL: 'http://localhost:5001',
        VITE_FIREBASE_API_KEY: 'test-key',
        VITE_FIREBASE_PROJECT_ID: 'demo-serve',
      },
    },
  };
});
