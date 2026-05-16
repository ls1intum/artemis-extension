import { describe, it, expect } from 'vitest';
import { replaySession } from '@extension/services/telemetry/replay/replayEngine';
import type { RecordedEvent, DiagnosticsEvent, SaveEvent, BuildResultEvent } from '@extension/services/telemetry/recording/types';
import { DEFAULT_EQ_CONFIG } from '@extension/services/telemetry/types';

function diagEvent(timestamp: number, uri: string, diagnostics: DiagnosticsEvent['diagnostics']): DiagnosticsEvent {
    return { type: 'diagnostics', timestamp, uri, diagnostics };
}

function saveEvent(timestamp: number, uri: string): SaveEvent {
    return { type: 'save', timestamp, uri };
}

function buildEvent(timestamp: number, buildFailed: boolean, buildErrorFamilies?: string[]): BuildResultEvent {
    return {
        type: 'buildResult',
        timestamp,
        successful: !buildFailed,
        errorCount: buildFailed ? 1 : 0,
        failedTests: [],
        buildFailed,
        ...(buildErrorFamilies ? { buildErrorFamilies } : {}),
    };
}

function compilerDiag(code: string) {
    return {
        code,
        message: `Error: ${code}`,
        severity: 0,
        range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 5 },
        source: 'ts',
    };
}

function lintDiag(code: string) {
    return {
        code,
        message: `Lint: ${code}`,
        severity: 0,
        range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 5 },
        source: 'eslint',
    };
}

describe('replaySession', () => {
    it('returns empty result for empty events', () => {
        expect(replaySession([])).toEqual([]);
    });

    it('returns empty result for events with no saves or builds', () => {
        const events: RecordedEvent[] = [
            diagEvent(1000, 'file:///a.ts', [compilerDiag('ts2304')]),
        ];
        expect(replaySession(events)).toEqual([]);
    });

    it('produces snapshot on save with diagnostics', () => {
        const events: RecordedEvent[] = [
            diagEvent(1000, 'file:///a.ts', [compilerDiag('ts2304')]),
            saveEvent(1500, 'file:///a.ts'),
        ];
        const result = replaySession(events);
        expect(result).toHaveLength(1);
        expect(result[0].source).toBe('save');
        expect(result[0].errorCount).toBe(1);
        expect(result[0].errorFamilies).toContain('ts:ts2304');
        expect(result[0].eq).toBe(0); // only 1 snapshot, need 2+ for EQ
    });

    it('calculates EQ from multiple save events with errors', () => {
        const t = 10_000;
        const events: RecordedEvent[] = [
            diagEvent(t, 'file:///a.ts', [compilerDiag('ts2304')]),
            saveEvent(t + 100, 'file:///a.ts'),
            // Second save 10s later (outside dedup window)
            diagEvent(t + 10_000, 'file:///a.ts', [compilerDiag('ts2304')]),
            saveEvent(t + 10_100, 'file:///a.ts'),
        ];
        const result = replaySession(events);
        expect(result).toHaveLength(2);
        // Both have errors with same family → pair score = 11/11 = 1.0
        expect(result[1].eq).toBe(1.0);
        expect(result[1].confidence).toBe('insufficient'); // only 1 pair, need 6
    });

    it('handles buildResult events', () => {
        const events: RecordedEvent[] = [
            buildEvent(1000, true), // build failed
        ];
        const result = replaySession(events);
        expect(result).toHaveLength(1);
        expect(result[0].source).toBe('build');
        expect(result[0].errorCount).toBe(1);
    });

    it('handles buildFailed=true followed by successful build', () => {
        const t = 10_000;
        const events: RecordedEvent[] = [
            buildEvent(t, true),
            buildEvent(t + 10_000, false),
        ];
        const result = replaySession(events);
        expect(result).toHaveLength(2);
        // First has errors, second doesn't → pair score = 0
        expect(result[1].eq).toBe(0);
    });

    it('filters out eslint diagnostics', () => {
        const events: RecordedEvent[] = [
            diagEvent(1000, 'file:///a.ts', [lintDiag('no-unused-vars')]),
            saveEvent(1500, 'file:///a.ts'),
        ];
        const result = replaySession(events);
        expect(result).toHaveLength(1);
        expect(result[0].errorCount).toBe(0);
        expect(result[0].errorFamilies).toHaveLength(0);
    });

    it('dedup within 5s window works', () => {
        const t = 10_000;
        const events: RecordedEvent[] = [
            diagEvent(t, 'file:///a.ts', [compilerDiag('ts2304')]),
            saveEvent(t + 100, 'file:///a.ts'),
            // Same errors 2s later (within dedup window)
            saveEvent(t + 2_000, 'file:///a.ts'),
            // Different errors 10s later (outside dedup window)
            diagEvent(t + 10_000, 'file:///a.ts', [compilerDiag('ts2345')]),
            saveEvent(t + 10_100, 'file:///a.ts'),
        ];
        const result = replaySession(events);
        // Second save is deduped (same families within 5s) → only 2 accepted snapshots
        expect(result).toHaveLength(2);
        // Save timestamps offset by 500ms lookahead window to match live timing
        expect(result[0].timestamp).toBe(t + 100 + 500);
        expect(result[1].timestamp).toBe(t + 10_100 + 500);
    });

    it('inactivity split after 30min gap', () => {
        const t = 10_000;
        const gap = 31 * 60 * 1000; // 31 minutes
        const events: RecordedEvent[] = [
            diagEvent(t, 'file:///a.ts', [compilerDiag('ts2304')]),
            saveEvent(t + 100, 'file:///a.ts'),
            diagEvent(t + 10_000, 'file:///a.ts', [compilerDiag('ts2304')]),
            saveEvent(t + 10_100, 'file:///a.ts'),
            // 31 min gap → new sub-session
            diagEvent(t + gap, 'file:///a.ts', [compilerDiag('ts2304')]),
            saveEvent(t + gap + 100, 'file:///a.ts'),
        ];
        const result = replaySession(events);
        expect(result).toHaveLength(3);
        // After gap, engine resets, so EQ goes back to 0 (only 1 snapshot in new sub-session)
        expect(result[2].eq).toBe(0);
    });

    it('lookahead stabilization includes diagnostics within 500ms after save', () => {
        const t = 10_000;
        const events: RecordedEvent[] = [
            // Save happens BEFORE diagnostics arrive (Language Server latency)
            saveEvent(t, 'file:///a.ts'),
            diagEvent(t + 300, 'file:///a.ts', [compilerDiag('ts2304')]),
        ];
        const result = replaySession(events);
        expect(result).toHaveLength(1);
        // Lookahead should pick up the diagnostics at t+300 (within 500ms window)
        expect(result[0].errorCount).toBe(1);
        expect(result[0].errorFamilies).toContain('ts:ts2304');
    });

    it('lookahead does NOT include diagnostics beyond 500ms window', () => {
        const t = 10_000;
        const events: RecordedEvent[] = [
            saveEvent(t, 'file:///a.ts'),
            diagEvent(t + 600, 'file:///a.ts', [compilerDiag('ts2304')]),
        ];
        const result = replaySession(events);
        expect(result).toHaveLength(1);
        // 600ms > 500ms window, so diagnostics not picked up
        expect(result[0].errorCount).toBe(0);
    });

    it('works with custom EQ config', () => {
        const t = 10_000;
        const events: RecordedEvent[] = [
            diagEvent(t, 'file:///a.ts', [compilerDiag('ts2304')]),
            saveEvent(t + 100, 'file:///a.ts'),
            diagEvent(t + 10_000, 'file:///a.ts', [compilerDiag('ts2304')]),
            saveEvent(t + 10_100, 'file:///a.ts'),
        ];
        // Custom config with different weights
        const config = {
            ...DEFAULT_EQ_CONFIG,
            WEIGHT_BOTH_ERROR: 4,
            WEIGHT_SAME_TYPE: 2,
            MAX_PAIR_SCORE: 6,
        };
        const result = replaySession(events, config);
        expect(result).toHaveLength(2);
        // Both errors, same family → (4+2)/6 = 1.0
        expect(result[1].eq).toBe(1.0);
    });

    it('accumulates diagnostic state across multiple URIs', () => {
        const t = 10_000;
        const events: RecordedEvent[] = [
            diagEvent(t, 'file:///a.ts', [compilerDiag('ts2304')]),
            diagEvent(t + 100, 'file:///b.ts', [compilerDiag('ts2345')]),
            saveEvent(t + 200, 'file:///a.ts'),
        ];
        const result = replaySession(events);
        expect(result).toHaveLength(1);
        expect(result[0].errorCount).toBe(2);
        expect(result[0].errorFamilies).toContain('ts:ts2304');
        expect(result[0].errorFamilies).toContain('ts:ts2345');
    });

    it('build error families affect pair scoring', () => {
        const t = 10_000;
        const events: RecordedEvent[] = [
            {
                type: 'buildResult',
                timestamp: t,
                successful: false,
                errorCount: 1,
                failedTests: [],
                buildFailed: true,
                buildErrorFamilies: ['build:Cannot find symbol foo'],
            } as BuildResultEvent,
            {
                type: 'buildResult',
                timestamp: t + 10_000,
                successful: false,
                errorCount: 1,
                failedTests: [],
                buildFailed: true,
                buildErrorFamilies: ['build:Cannot find symbol foo'],
            } as BuildResultEvent,
        ];
        const result = replaySession(events);
        expect(result).toHaveLength(2);
        // Same custom family in both → same-type weight applies → EQ = 1.0
        expect(result[1].eq).toBe(1.0);
        expect(result[0].errorFamilies).toContain('build:Cannot find symbol foo');
    });

    it('exercise root from sessionStart filters diagnostics', () => {
        const t = 10_000;
        const events: RecordedEvent[] = [
            { type: 'sessionStart', timestamp: t - 1000, exerciseId: 1, participantId: undefined, exerciseRoot: 'file:///workspace' },
            diagEvent(t, 'file:///workspace/a.ts', [compilerDiag('ts2304')]),
            diagEvent(t + 100, 'file:///other/b.ts', [compilerDiag('ts2345')]),
            saveEvent(t + 200, 'file:///workspace/a.ts'),
        ];
        const result = replaySession(events);
        expect(result).toHaveLength(1);
        // Only workspace diagnostic should be counted
        expect(result[0].errorCount).toBe(1);
        expect(result[0].errorFamilies).toContain('ts:ts2304');
        expect(result[0].errorFamilies).not.toContain('ts:ts2345');
    });

    it('coalesces rapid saves within 500ms — only last fires', () => {
        const t = 10_000;
        const events: RecordedEvent[] = [
            diagEvent(t, 'file:///a.ts', [compilerDiag('ts2304')]),
            saveEvent(t + 100, 'file:///a.ts'),   // save 1 — another save within 500ms → coalesced
            saveEvent(t + 400, 'file:///a.ts'),   // save 2 — no save within 500ms → fires
        ];
        const result = replaySession(events);
        expect(result).toHaveLength(1);
        expect(result[0].timestamp).toBe(t + 400 + 500);
    });

    it('three rapid saves — first two coalesced, last fires', () => {
        const t = 10_000;
        const events: RecordedEvent[] = [
            diagEvent(t, 'file:///a.ts', [compilerDiag('ts2304')]),
            saveEvent(t + 100, 'file:///a.ts'),   // save 1 → coalesced (save 2 within 500ms)
            saveEvent(t + 300, 'file:///a.ts'),   // save 2 → coalesced (save 3 within 500ms)
            saveEvent(t + 600, 'file:///a.ts'),   // save 3 → fires (no save within 500ms)
        ];
        const result = replaySession(events);
        expect(result).toHaveLength(1);
        expect(result[0].timestamp).toBe(t + 600 + 500);
    });

    it('snapshot timestamp is save_time + 500ms', () => {
        const t = 10_000;
        const events: RecordedEvent[] = [
            diagEvent(t, 'file:///a.ts', [compilerDiag('ts2304')]),
            saveEvent(t + 100, 'file:///a.ts'),
        ];
        const result = replaySession(events);
        expect(result).toHaveLength(1);
        expect(result[0].timestamp).toBe(t + 100 + 500);
    });

    it('dedup boundary at exactly 5s is not deduped', () => {
        const t = 10_000;
        const events: RecordedEvent[] = [
            diagEvent(t, 'file:///a.ts', [compilerDiag('ts2304')]),
            saveEvent(t + 100, 'file:///a.ts'),
            // Exactly 5s later (snapshot timestamps differ by exactly DEDUP_WINDOW_MS)
            diagEvent(t + 5_100, 'file:///a.ts', [compilerDiag('ts2304')]),
            saveEvent(t + 5_100, 'file:///a.ts'),
        ];
        const result = replaySession(events);
        // At the >= boundary, not deduped — both snapshots accepted
        expect(result).toHaveLength(2);
    });

    it('sufficient confidence after enough pairs', () => {
        const t = 10_000;
        const events: RecordedEvent[] = [];
        // Generate 7 saves with errors (6 pairs → sufficient)
        for (let i = 0; i < 7; i++) {
            const ts = t + i * 10_000;
            events.push(diagEvent(ts, 'file:///a.ts', [compilerDiag('ts2304')]));
            events.push(saveEvent(ts + 100, 'file:///a.ts'));
        }
        const result = replaySession(events);
        expect(result).toHaveLength(7);
        expect(result[6].confidence).toBe('sufficient');
    });
});
