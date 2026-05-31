import { describe, expect, it } from 'vitest';

import { createRecordingWebviewHandlers, wireDataCollection } from '@extension/dataCollection/noop';

describe('no-op data-collection seam', () => {
    it('returns an empty webview handler map', () => {
        expect(createRecordingWebviewHandlers({} as never)).toEqual({});
    });

    it('returns a handle whose dispose resolves without side effects', async () => {
        const handle = wireDataCollection({} as never);
        await expect(handle.dispose()).resolves.toBeUndefined();
    });
});
