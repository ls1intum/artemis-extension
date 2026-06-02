import { describe, it, expect, vi } from 'vitest';
import { createRecordingsApiPlugin } from '../../server/recordingsApiPlugin';
import type { AppConfig } from '../../server/types';

const config: AppConfig = {
    recordingsDir: '/tmp/recording-viewer-plugin-test',
    liveToken: 'tok',
    researcherToken: undefined,
    sessionSecret: 'x'.repeat(64),
    allowWrite: false,
};

// Mimics connect's chaining contract: `app.use()` returns the app. This is what
// makes the "hooks must return undefined" assertion meaningful — a hook that
// implicitly returns `middlewares.use(...)` would leak the app, not undefined.
function fakeMiddlewareServer() {
    const middlewares = { use: vi.fn(() => middlewares) };
    return { middlewares };
}

describe('createRecordingsApiPlugin', () => {
    it('exposes both the dev and preview server hooks', () => {
        const plugin = createRecordingsApiPlugin(config);
        expect(plugin.name).toBe('recordings-api');
        expect(typeof plugin.configureServer).toBe('function');
        expect(typeof plugin.configurePreviewServer).toBe('function');
    });

    // The live-mode tab crash only happens on the React dev build, so studies must be
    // able to run the production build via `vite preview`. That requires the recordings
    // API to be mounted on the preview server too, using the very same handler instance
    // as the dev server (one LiveTailerRegistry, one set of upload locks).
    it('mounts the same handler instance on both the dev and preview servers', () => {
        const plugin = createRecordingsApiPlugin(config);
        const dev = fakeMiddlewareServer();
        const preview = fakeMiddlewareServer();

        // The hooks must return undefined: `middlewares.use()` returns the connect app,
        // and Vite invokes a hook's return value as a post-hook — returning the app would
        // crash the preview server (it would be called with no request).
        expect(plugin.configureServer(dev)).toBeUndefined();
        expect(plugin.configurePreviewServer(preview)).toBeUndefined();

        expect(dev.middlewares.use).toHaveBeenCalledTimes(1);
        expect(preview.middlewares.use).toHaveBeenCalledTimes(1);

        const devHandler = dev.middlewares.use.mock.calls[0][0];
        const previewHandler = preview.middlewares.use.mock.calls[0][0];
        expect(typeof devHandler).toBe('function');
        expect(devHandler).toBe(previewHandler);
    });
});
