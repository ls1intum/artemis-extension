import { describe, expect, it } from 'vitest';

import type { BuildResultEvent } from '@extension/services/recording/types';
import { BuildDeltaTracker } from '@extension/services/struggle/signals/buildDelta';

import { rehydrateResultDTO } from './buildResultRehydrate';

/**
 * Build a minimal recorded buildResult event. The fields the rehydration (and
 * therefore buildDelta) cares about are `buildFailed` and `failedTestDetails`
 * (detail = the recorded detailText that the failed-set diff keys on). The
 * other recorded fields are filled with consistent-but-irrelevant values.
 */
function buildResultEvent(opts: {
    timestamp?: number;
    buildFailed: boolean;
    failedDetails?: string[];
    passedTestCaseCount?: number;
    testCaseCount?: number;
}): BuildResultEvent {
    const details = opts.failedDetails ?? [];
    return {
        type: 'buildResult',
        timestamp: opts.timestamp ?? 0,
        successful: !opts.buildFailed && details.length === 0,
        errorCount: details.length,
        failedTests: details,
        buildFailed: opts.buildFailed,
        passedTestCaseCount: opts.passedTestCaseCount,
        testCaseCount: opts.testCaseCount,
        failedTestDetails: details.length > 0
            ? details.map((detail, i) => ({ testName: `test${i}`, detail }))
            : undefined,
    };
}

describe('rehydrateResultDTO + buildDelta classification', () => {
    it('classifies a compile-error build (buildFailed=true)', () => {
        const tracker = new BuildDeltaTracker();
        const c = tracker.ingest(1, rehydrateResultDTO(buildResultEvent({ buildFailed: true })));
        expect(c.delta).toBe('compile-error');
        expect(c.failedCount).toBeNull();
        expect(c.isFM).toBe(true);
    });

    it('classifies the FIRST build with tests', () => {
        const tracker = new BuildDeltaTracker();
        const c = tracker.ingest(1, rehydrateResultDTO(buildResultEvent({
            buildFailed: false,
            failedDetails: ['a', 'b'],
        })));
        expect(c.delta).toBe('first');
        expect(c.failedCount).toBe(2);
    });

    it('classifies an IDENTICAL-SET re-run of the same failures', () => {
        const tracker = new BuildDeltaTracker();
        tracker.ingest(1, rehydrateResultDTO(buildResultEvent({ buildFailed: false, failedDetails: ['a', 'b'] })));
        const c = tracker.ingest(2, rehydrateResultDTO(buildResultEvent({ buildFailed: false, failedDetails: ['a', 'b'] })));
        expect(c.delta).toBe('identical-set');
        expect(c.failedCount).toBe(2);
    });

    it('classifies an IMPROVED build (fewer failures)', () => {
        const tracker = new BuildDeltaTracker();
        tracker.ingest(1, rehydrateResultDTO(buildResultEvent({ buildFailed: false, failedDetails: ['a', 'b'] })));
        const c = tracker.ingest(2, rehydrateResultDTO(buildResultEvent({ buildFailed: false, failedDetails: ['a'] })));
        expect(c.delta).toBe('improved');
        expect(c.improved).toBe(true);
    });

    it('classifies a WORSE build (more failures)', () => {
        const tracker = new BuildDeltaTracker();
        tracker.ingest(1, rehydrateResultDTO(buildResultEvent({ buildFailed: false, failedDetails: ['a'] })));
        const c = tracker.ingest(2, rehydrateResultDTO(buildResultEvent({ buildFailed: false, failedDetails: ['a', 'b'] })));
        expect(c.delta).toBe('worse');
        expect(c.failedCount).toBe(2);
    });

    it('classifies a SAME-COUNT build (different set, equal size)', () => {
        const tracker = new BuildDeltaTracker();
        tracker.ingest(1, rehydrateResultDTO(buildResultEvent({ buildFailed: false, failedDetails: ['a', 'b'] })));
        const c = tracker.ingest(2, rehydrateResultDTO(buildResultEvent({ buildFailed: false, failedDetails: ['a', 'c'] })));
        expect(c.delta).toBe('same-count');
        expect(c.failedCount).toBe(2);
    });

    it('carries test-case counts through to BuildClassification (live==replay parity)', () => {
        const tracker = new BuildDeltaTracker();
        const c = tracker.ingest(1, rehydrateResultDTO(buildResultEvent({
            buildFailed: false, failedDetails: ['a'], passedTestCaseCount: 4, testCaseCount: 5,
        })));
        expect(c.passedTestCaseCount).toBe(4);
        expect(c.testCaseCount).toBe(5);
    });

    it('nulls counts for a compile-error build even if the event carried them', () => {
        const tracker = new BuildDeltaTracker();
        const c = tracker.ingest(1, rehydrateResultDTO(buildResultEvent({
            buildFailed: true, passedTestCaseCount: 3, testCaseCount: 9,
        })));
        expect(c.delta).toBe('compile-error');
        expect(c.passedTestCaseCount).toBeNull();
        expect(c.testCaseCount).toBeNull();
    });

    it('populates only buildDelta-relevant fields (buildFailed + failed feedbacks)', () => {
        const dto = rehydrateResultDTO(buildResultEvent({ buildFailed: false, failedDetails: ['x', 'y'] }));
        expect(dto.submission?.buildFailed).toBe(false);
        expect((dto.feedbacks ?? []).filter(f => f.positive === false).map(f => f.detailText))
            .toEqual(['x', 'y']);
    });
});
