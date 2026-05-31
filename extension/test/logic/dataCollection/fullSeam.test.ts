import { describe, expect, it, vi } from 'vitest';

// Spies referenced inside vi.mock factories MUST be hoisted (vitest requirement).
const h = vi.hoisted(() => ({
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    recorderDispose: vi.fn().mockResolvedValue(undefined),
    recorderDisposable: { dispose: vi.fn() },
    promptIfPending: vi.fn().mockResolvedValue(undefined),
    consentDispose: vi.fn(),
    executeReplayCommand: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('vscode', () => ({
    Uri: { joinPath: (base: { path: string }, seg: string) => ({ path: `${base.path}/${seg}` }) },
    commands: { executeCommand: vi.fn().mockResolvedValue(undefined), registerCommand: h.registerCommand },
    Disposable: { from: (...items: { dispose(): void }[]) => ({ dispose: () => items.forEach(i => i.dispose()) }) },
}));
vi.mock('@extension/services/auth', () => ({
    ConsentService: class { promptIfPending = h.promptIfPending; dispose = h.consentDispose; },
}));
vi.mock('@extension/activation/sessionRecorderWiring', () => ({
    wireSessionRecorder: () => ({ sessionRecorder: { dispose: h.recorderDispose }, disposable: h.recorderDisposable }),
}));
vi.mock('@extension/services/telemetry/replay', () => ({ executeReplayCommand: h.executeReplayCommand }));
vi.mock('@extension/services/loggingService', () => ({ logger: { error: vi.fn() }, LogCategory: { TELEMETRY: 'telemetry' } }));

import { createRecordingWebviewHandlers, wireDataCollection } from '@extension/dataCollection/index';

const deps = { context: { globalStorageUri: { path: '/storage' } } } as never;

describe('full data-collection seam', () => {
    it('exposes the two recording webview handlers', () => {
        expect(Object.keys(createRecordingWebviewHandlers({ path: '/storage' } as never)).sort())
            .toEqual(['openRecordingsFolder', 'replaySession']);
    });

    it('wireDataCollection prompts for consent and registers the recording palette commands', () => {
        h.promptIfPending.mockClear();
        h.registerCommand.mockClear();
        wireDataCollection(deps);
        expect(h.promptIfPending).toHaveBeenCalledOnce();
        const ids = h.registerCommand.mock.calls.map(c => (c as unknown[])[0]);
        expect(ids).toEqual(expect.arrayContaining(['artemis.replaySession', 'artemis.openRecordingsFolder']));
    });

    it('dispose awaits the recorder flush and is idempotent', async () => {
        h.recorderDispose.mockClear();
        const handle = wireDataCollection(deps);
        await handle.dispose();
        await handle.dispose();
        expect(h.recorderDispose).toHaveBeenCalledOnce();
    });
});
