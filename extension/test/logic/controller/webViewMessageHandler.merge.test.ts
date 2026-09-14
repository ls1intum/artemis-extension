import { describe, expect, it } from 'vitest';

import { mergeRecordingHandlers } from '@extension/controller/commands/mergeCommandHandlers';

describe('fail-closed handler merge', () => {
    it('throws when a seam handler collides with an existing command', () => {
        const existing = new Map([['openRecordingsFolder', async () => {}]]);
        expect(() => mergeRecordingHandlers(existing, { openRecordingsFolder: async () => {} }))
            .toThrow(/collides/);
    });

    it('adds non-colliding seam handlers', () => {
        const existing = new Map();
        mergeRecordingHandlers(existing, { openRecordingsFolder: async () => {} });
        expect(existing.has('openRecordingsFolder')).toBe(true);
    });
});
