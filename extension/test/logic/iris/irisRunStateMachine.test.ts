import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRunLifecycle, IrisRunStateMachine } from '@extension/services/iris/irisRunStateMachine';

describe('IrisRunStateMachine', () => {
    let m: IrisRunStateMachine;
    beforeEach(() => { m = new IrisRunStateMachine(); });

    describe('admission', () => {
        it('admits frames without a runId', () => {
            expect(m.admit({ type: 'STATUS' })).toBe(true);
        });
        it('binds the first run it sees', () => {
            expect(m.admit({ type: 'STATUS', runId: 'A' })).toBe(true);
            expect(m.currentRunId).toBe('A');
        });
        it('rejects a superseded run', () => {
            m.admit({ type: 'STATUS', runId: 'A' });
            m.admit({ type: 'STATUS', runId: 'B' });
            expect(m.admit({ type: 'STATUS', runId: 'A' })).toBe(false);
        });
        it('rejects the previous run while a new generation is pending', () => {
            m.admit({ type: 'STATUS', runId: 'A' });
            m.beginGeneration();
            expect(m.admit({ type: 'STATUS', runId: 'A' })).toBe(false);
        });
        it('binds a genuinely new run during a pending generation', () => {
            m.admit({ type: 'STATUS', runId: 'A' });
            m.beginGeneration();
            expect(m.admit({ type: 'STATUS', runId: 'B' })).toBe(true);
            expect(m.currentRunId).toBe('B');
            expect(m.pendingGeneration).toBe(false);
        });
        it('rejects a late RUNNING after the run went terminal', () => {
            m.admit({ type: 'STATUS', runId: 'A', runState: 'RUNNING' });
            m.applyRunState('A', 'FAILED');
            expect(m.admit({ type: 'STATUS', runId: 'A', runState: 'RUNNING' })).toBe(false);
        });
    });

    describe('sequence guards', () => {
        it('accepts strictly increasing partial sequences', () => {
            expect(m.acceptPartial('A', 1)).toBe(true);
            expect(m.acceptPartial('A', 2)).toBe(true);
        });
        it('rejects repeated and out-of-order partials', () => {
            m.acceptPartial('A', 2);
            expect(m.acceptPartial('A', 2)).toBe(false);
            expect(m.acceptPartial('A', 1)).toBe(false);
        });
        it('rejects a partial after the run was finalized', () => {
            m.acceptPartial('A', 1);
            m.finalizeRun('A', false);
            expect(m.acceptPartial('A', 2)).toBe(false);
        });
        it('guards activities independently of partials', () => {
            expect(m.acceptActivities('A', 5)).toBe(true);
            expect(m.acceptActivities('A', 5)).toBe(false);
            expect(m.acceptPartial('A', 1)).toBe(true);
        });
    });

    describe('waiting lifecycle', () => {
        it('is false initially', () => expect(m.waiting).toBe(false));
        it('becomes true on beginGeneration', () => {
            m.beginGeneration();
            expect(m.waiting).toBe(true);
        });
        it('abortGeneration only aborts its own generation', () => {
            const g1 = m.beginGeneration();
            const g2 = m.beginGeneration();
            m.abortGeneration(g1);
            expect(m.waiting).toBe(true);   // g1 is stale, must not clear g2
            m.abortGeneration(g2);
            expect(m.waiting).toBe(false);
        });
        it('stays true after an intermediate message', () => {
            m.beginGeneration();
            m.admit({ type: 'MESSAGE', runId: 'A' });
            m.finalizeRun('A', true);
            expect(m.waiting).toBe(true);
        });
        it('clears on a final message', () => {
            m.beginGeneration();
            m.admit({ type: 'MESSAGE', runId: 'A' });
            m.finalizeRun('A', false);
            expect(m.waiting).toBe(false);
        });
        it('clears on FINISHED alone, with no message', () => {
            m.beginGeneration();
            m.admit({ type: 'STATUS', runId: 'A' });
            m.applyRunState('A', 'FINISHED');
            expect(m.waiting).toBe(false);
        });
        it('clears on FAILED', () => {
            m.beginGeneration();
            m.admit({ type: 'STATUS', runId: 'A' });
            m.applyRunState('A', 'FAILED');
            expect(m.waiting).toBe(false);
        });
        it('a scoped late terminal from run A does not clear waiting for run B', () => {
            m.admit({ type: 'STATUS', runId: 'A' });
            m.beginGeneration();
            m.admit({ type: 'STATUS', runId: 'B' });
            m.applyRunState('A', 'FINISHED');
            expect(m.waiting).toBe(true);
        });
        // THE load-bearing case: unscoped terminal while the next generation is pending.
        it('an UNSCOPED late terminal does not clear waiting for a pending generation', () => {
            m.admit({ type: 'STATUS', runId: 'A' });
            m.beginGeneration();               // pending, no run bound yet
            expect(m.applyRunState(undefined, 'FINISHED')).toBe(false);
            expect(m.waiting).toBe(true);
        });
        it('reports acceptance so the caller can gate its projection', () => {
            m.admit({ type: 'STATUS', runId: 'A' });
            expect(m.applyRunState('A', 'FINISHED')).toBe(true);
            expect(m.applyRunState('B', 'FAILED')).toBe(false);   // not the current run
        });
        it('a run-ID-less MESSAGE never finalizes the current run', () => {
            m.beginGeneration();
            m.admit({ type: 'MESSAGE', runId: 'A' });
            m.finalizeRun(undefined, false);
            expect(m.waiting).toBe(true);
        });
        it('reset clears everything', () => {
            m.beginGeneration();
            m.admit({ type: 'STATUS', runId: 'A' });
            m.reset();
            expect(m.waiting).toBe(false);
            expect(m.currentRunId).toBeUndefined();
            expect(m.acceptPartial('A', 1)).toBe(true);
        });
    });

    describe('createRunLifecycle', () => {
        it('publishes on begin and on abort', () => {
            const onBegin = vi.fn();
            const onAbort = vi.fn();
            const lifecycle = createRunLifecycle(m, onBegin, onAbort);

            const g = lifecycle.beginGeneration();
            expect(onBegin).toHaveBeenCalledTimes(1);
            expect(onAbort).not.toHaveBeenCalled();
            expect(m.waiting).toBe(true);

            lifecycle.abortGeneration(g);
            expect(onAbort).toHaveBeenCalledTimes(1);
            expect(m.waiting).toBe(false);
        });

        it('a begin from a FAILED projection yields waiting:true with runState/error/draft/activities cleared', () => {
            // Model the handler projection the lifecycle's onBegin clears. onBegin
            // runs AFTER beginGeneration, so machine.waiting is already true when
            // the (mirrored) resetRunUiAndPublish builds its snapshot.
            let projection = {
                draft: { runId: 'A', text: 'partial' } as { runId: string; text: string } | null,
                activities: ['stale-activity'] as unknown[],
                runState: 'FAILED' as string | null,
                error: { message: 'boom' } as { message?: string } | null,
                waiting: false,
            };
            let snapshot: typeof projection | undefined;
            const onBegin = (): void => {
                // Mirrors handler.resetRunUiAndPublish: clear the projection
                // fields (NOT the machine), then publish off machine.waiting.
                projection = { draft: null, activities: [], runState: null, error: null, waiting: m.waiting };
                snapshot = projection;
            };

            const lifecycle = createRunLifecycle(m, onBegin, () => { /* no-op */ });
            lifecycle.beginGeneration();

            expect(snapshot).toBeDefined();
            expect(snapshot!.waiting).toBe(true);
            expect(snapshot!.runState).toBeNull();
            expect(snapshot!.error).toBeNull();
            expect(snapshot!.draft).toBeNull();
            expect(snapshot!.activities).toEqual([]);
        });
    });
});
