import { describe, it, expect } from 'vitest';
import { RECORDING_INFO_BADGES } from '../src/components/recordingInfoData';
import { ALL_EVENT_TYPES, MARKER_COLORS } from '../src/constants';

describe('RecordingInfo "What do we record?" panel', () => {
    it('lists exactly every recorded event type (no missing, no extra)', () => {
        expect(new Set(RECORDING_INFO_BADGES)).toEqual(new Set<string>(ALL_EVENT_TYPES));
    });

    it('lists each event type exactly once', () => {
        expect(RECORDING_INFO_BADGES.length).toBe(ALL_EVENT_TYPES.length);
        expect(new Set(RECORDING_INFO_BADGES).size).toBe(RECORDING_INFO_BADGES.length);
    });

    it('uses a real color for every badge (no colorless entries)', () => {
        for (const badge of RECORDING_INFO_BADGES) {
            expect((MARKER_COLORS as Record<string, string>)[badge]).toBeTruthy();
        }
    });
});
