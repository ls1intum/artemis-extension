import * as assert from 'assert';

import { shouldAutoRetryReload } from '@extension/provider/chatReloadDecision';
import type { LastAvailability } from '@extension/services/iris/chat/chatSessionService';
import type { ActiveContext } from '@extension/types';

const exerciseA: ActiveContext = {
    type: 'exercise',
    id: 1,
    title: 'Exercise A',
    source: 'user-selected',
    locked: false,
    selectedAt: Date.now(),
};

const exerciseB: ActiveContext = {
    type: 'exercise',
    id: 2,
    title: 'Exercise B',
    source: 'user-selected',
    locked: false,
    selectedAt: Date.now(),
};

const courseA: ActiveContext = {
    type: 'course',
    id: 1,
    title: 'Course A',
    source: 'user-selected',
    locked: false,
    selectedAt: Date.now(),
};

suite('shouldAutoRetryReload', () => {
    test('returns true when unavailable matches the current context', () => {
        const last: LastAvailability = { kind: 'unavailable', contextKey: 'exercise:1' };
        assert.strictEqual(shouldAutoRetryReload(last, exerciseA), true);
    });

    test('returns false when unavailable was recorded for a different context (id)', () => {
        // Auto-retry must not fire for context A's stale classification
        // after the user has switched to context B — otherwise reconnect
        // would pull A's sessions into B's view.
        const last: LastAvailability = { kind: 'unavailable', contextKey: 'exercise:1' };
        assert.strictEqual(shouldAutoRetryReload(last, exerciseB), false);
    });

    test('returns false when unavailable was recorded for a different context (type)', () => {
        // exercise:1 vs course:1 share an id but are different contexts.
        const last: LastAvailability = { kind: 'unavailable', contextKey: 'exercise:1' };
        assert.strictEqual(shouldAutoRetryReload(last, courseA), false);
    });

    test('returns false for disabled state — no point auto-retrying a known disable', () => {
        const last: LastAvailability = { kind: 'disabled', contextKey: 'exercise:1' };
        assert.strictEqual(shouldAutoRetryReload(last, exerciseA), false);
    });

    test('returns false for enabled state — nothing to retry', () => {
        const last: LastAvailability = { kind: 'enabled', contextKey: 'exercise:1' };
        assert.strictEqual(shouldAutoRetryReload(last, exerciseA), false);
    });

    test('returns false for unknown state — pre-classification or after reset', () => {
        const last: LastAvailability = { kind: 'unknown' };
        assert.strictEqual(shouldAutoRetryReload(last, exerciseA), false);
    });

    test('returns false when no active context exists', () => {
        // Edge case: reconnect fires while no context is selected.
        const last: LastAvailability = { kind: 'unavailable', contextKey: 'exercise:1' };
        assert.strictEqual(shouldAutoRetryReload(last, null), false);
    });
});
