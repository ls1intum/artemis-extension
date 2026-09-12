import { describe, it, expect } from 'vitest';
import { RECORDING_INFO_BADGES } from '../src/components/recordingInfoData';
import { ALL_EVENT_TYPES_WITH_LEGACY, ALL_MARKER_COLORS } from '../src/constants';

describe('RecordingInfo "What do we record?" panel', () => {
    // Compared against ALL_EVENT_TYPES_WITH_LEGACY (not the bare, canonical-only
    // ALL_EVENT_TYPES): the panel documents everything this viewer can render,
    // including the eqSnapshot/eqEngineState/intervention types retired from the
    // live schema but still present in study-era recordings.
    it('lists exactly every recorded (or legacy-recorded) event type (no missing, no extra)', () => {
        expect(new Set(RECORDING_INFO_BADGES)).toEqual(new Set<string>(ALL_EVENT_TYPES_WITH_LEGACY));
    });

    it('lists each event type exactly once', () => {
        expect(RECORDING_INFO_BADGES.length).toBe(ALL_EVENT_TYPES_WITH_LEGACY.length);
        expect(new Set(RECORDING_INFO_BADGES).size).toBe(RECORDING_INFO_BADGES.length);
    });

    it('uses a real color for every badge (no colorless entries)', () => {
        for (const badge of RECORDING_INFO_BADGES) {
            expect(ALL_MARKER_COLORS[badge]).toBeTruthy();
        }
    });
});
