import { createRecordingsApi } from './recordingsApi';
import type { AppConfig, IncomingRequest, ServerResponse } from './types';

/**
 * Minimal shape shared by Vite's dev (`ViteDevServer`) and preview
 * (`PreviewServer`) objects: both expose a connect-style `middlewares` stack.
 */
interface MiddlewareServer {
    middlewares: {
        use(fn: (req: IncomingRequest, res: ServerResponse, next: () => void) => void): void;
    };
}

/**
 * Vite plugin that serves the recordings API.
 *
 * The same handler is mounted on BOTH the dev server (`configureServer`) and the
 * preview server (`configurePreviewServer`). The preview hook is what lets a live
 * study run against the production build (`vite build && vite preview`) instead of
 * the dev server.
 *
 * Why that matters: React's development build instruments every component render
 * with `performance.measure(..., { detail })`, structured-cloning a diff of the
 * component's props. In live mode the large, identity-changing `events` array is
 * passed to several components every animation frame, so those clones pile up in
 * the never-cleared user-timing buffer until the tab runs out of memory and
 * crashes. The production build carries no such instrumentation, so serving the
 * built app via `vite preview` makes that crash structurally impossible.
 *
 * Both hooks reuse one handler instance so the live-tailer registry and upload
 * locks are shared rather than duplicated.
 */
export function createRecordingsApiPlugin(config: AppConfig) {
    const handler = createRecordingsApi(config);
    // Block body (no implicit return): `middlewares.use()` returns the connect app,
    // and Vite treats a hook's return value as a post-hook to invoke. Returning that
    // app would make Vite call it with no request and crash the preview server.
    const mount = (server: MiddlewareServer) => { server.middlewares.use(handler); };
    return {
        name: 'recordings-api',
        configureServer: mount,
        configurePreviewServer: mount,
    };
}
