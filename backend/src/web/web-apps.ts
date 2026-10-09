import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express, { Router, type RequestHandler } from 'express';
import helmet, { type HelmetOptions } from 'helmet';
import type { Env } from '../config/env.js';

/**
 * Single-domain hosting of the built web apps (enabled by WEB_ROOT).
 *
 *   /staff/...   staff dashboard  (WEB_ROOT/staff)
 *   /admin/...   admin portal     (WEB_ROOT/admin)
 *   /...         student web app  (WEB_ROOT/student)
 *
 * `/api` and `/socket.io` never reach this router: the API answers (or 404s)
 * first and Socket.IO handles its own path on the HTTP server.
 */
export const WEB_APPS = [
  { dir: 'staff', prefix: '/staff' },
  { dir: 'admin', prefix: '/admin' },
  { dir: 'student', prefix: '' },
] as const;

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

/** Marker written by `npm run build:web`: `{ "local": boolean, "builtAt": string }`. */
const BUILD_MARKER = '.serve-web-build';

/**
 * Resolves WEB_ROOT and fails fast when a built app is missing, or when a
 * production server is pointed at a `build:web --local` preview (wired to the
 * Auth Emulator and the demo project).
 */
export function resolveWebRoot(webRoot: string, nodeEnv: Env['NODE_ENV']): string {
  const root = path.resolve(webRoot);
  const missing = WEB_APPS.map((app) => path.join(app.dir, 'index.html')).filter(
    (file) => !existsSync(path.join(root, file)),
  );
  if (missing.length > 0) {
    throw new Error(
      `WEB_ROOT (${root}) is missing ${missing.join(', ')}. Run \`npm run build:web\` and point WEB_ROOT at its output.`,
    );
  }
  const marker = path.join(root, BUILD_MARKER);
  if (nodeEnv === 'production' && existsSync(marker)) {
    const { local } = JSON.parse(readFileSync(marker, 'utf8')) as { local?: unknown };
    if (local === true) {
      throw new Error(
        `WEB_ROOT (${root}) holds a local preview build (Auth Emulator, demo project). Build for production with \`npm run build:web\` (without --local).`,
      );
    }
  }
  return root;
}

/**
 * Content Security Policy for the HTML apps (the API keeps `default-src 'none'`).
 * Scripts come only from this origin; 'wasm-unsafe-eval' lets the Flutter
 * renderer compile its WebAssembly. Network access is limited to this origin
 * and https/wss endpoints: Firebase Auth's REST API and menu images, which
 * staff may host anywhere.
 */
export function pageContentSecurityPolicy(env: Env): Record<string, string[]> {
  const connectSrc = ["'self'", 'https:', 'wss:'];
  // Development/test only: production configuration rejects the emulator.
  if (env.FIREBASE_AUTH_EMULATOR_HOST) connectSrc.push(`http://${env.FIREBASE_AUTH_EMULATOR_HOST}`);
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
    connectSrc,
    workerSrc: ["'self'", 'blob:'],
    manifestSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    ...(env.NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {}),
  };
}

function pageHelmetOptions(env: Env): HelmetOptions {
  return {
    contentSecurityPolicy: { useDefaults: false, directives: pageContentSecurityPolicy(env) },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    // Sends the origin (never the path) to Firebase, so an API key restricted
    // to https://YOUR_DOMAIN/* keeps working.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xFrameOptions: { action: 'deny' },
  };
}

/** Static files of one app. Vite's content-hashed `assets/` are cached forever. */
function staticFiles(dir: string, hashedAssets: boolean): RequestHandler {
  return express.static(dir, {
    index: false, // index.html is served by the fallback, never cached
    redirect: false,
    dotfiles: 'ignore',
    setHeaders(res, filePath) {
      const immutable =
        hashedAssets && path.relative(dir, filePath).startsWith(`assets${path.sep}`);
      res.setHeader('Cache-Control', immutable ? IMMUTABLE : REVALIDATE);
    },
  });
}

/**
 * Client-side routing: a page refresh on /staff/orders must load the staff
 * app, not 404. Paths with a file extension are missing files and fall
 * through to the JSON 404 instead of receiving HTML.
 */
function appShell(indexFile: string): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (path.posix.extname(req.path) !== '') return next();
    res.setHeader('Cache-Control', REVALIDATE);
    res.sendFile(indexFile, (err) => {
      if (err) next(err);
    });
  };
}

/** `/staff` → `/staff/`, keeping the query string, so relative URLs resolve. */
function trailingSlash(prefix: string): RequestHandler {
  return (req, res, next) => {
    const [pathname, query] = req.originalUrl.split('?', 2);
    if (pathname !== prefix) return next();
    res.redirect(301, `${prefix}/${query === undefined ? '' : `?${query}`}`);
  };
}

export function createWebAppsRouter(env: Env, webRoot: string): Router {
  const router = Router();
  router.use(helmet(pageHelmetOptions(env)));
  for (const app of WEB_APPS) {
    const dir = path.join(webRoot, app.dir);
    const shell = appShell(path.join(dir, 'index.html'));
    if (app.prefix) {
      router.use(app.prefix, trailingSlash(app.prefix), staticFiles(dir, true), shell);
    } else {
      router.use(staticFiles(dir, false), shell);
    }
  }
  return router;
}
