import * as vscode from 'vscode';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRecordingWebviewHandlers, wireDataCollection } from '@extension/dataCollection/noop';

describe('no-op data-collection seam', () => {
    afterEach(() => vi.restoreAllMocks());

    it('returns an empty webview handler map', () => {
        expect(createRecordingWebviewHandlers({} as never)).toEqual({});
    });

    it('marks the recorder inactive on wiring and on disposal', async () => {
        const setContext = vi.spyOn(vscode.commands, 'executeCommand');
        const handle = wireDataCollection({} as never);
        expect(setContext).toHaveBeenCalledWith('setContext', 'iris.recorder.active', false);
        setContext.mockClear();
        await expect(handle.dispose()).resolves.toBeUndefined();
        expect(setContext).toHaveBeenCalledWith('setContext', 'iris.recorder.active', false);
    });
});
