import { describe, expect, it } from 'vitest';

import { coalescePending } from '@extension/provider/baseWebviewProvider';

const EVENTS = new Set(['websocketUpdate', 'addMessage']);
const snap = (revision: number) => ({ type: 'updateIrisRunUi', revision } as never);
const commit = (id: number) => ({ type: 'addMessage', id } as never);

describe('coalescePending', () => {
    it('coalesces two snapshots when no event separates them', () => {
        const q = [snap(1)];
        coalescePending(q, snap(2), EVENTS);
        expect(q).toEqual([snap(2)]);
    });

    it('appends a snapshot that follows an event instead of replacing in place', () => {
        const q = [snap(1), commit(10)];
        coalescePending(q, snap(2), EVENTS);
        expect(q).toEqual([snap(1), commit(10), snap(2)]);
    });

    it('coalesces only within the segment after the last event', () => {
        const q = [snap(1), commit(10), snap(2)];
        coalescePending(q, snap(3), EVENTS);
        expect(q).toEqual([snap(1), commit(10), snap(3)]);
    });

    it('always appends event messages', () => {
        const q = [snap(1)];
        coalescePending(q, commit(10), EVENTS);
        expect(q).toEqual([snap(1), commit(10)]);
    });

    it('still coalesces unrelated non-event types independently', () => {
        const q = [{ type: 'updateNoAiStatus' } as never, snap(1)];
        coalescePending(q, { type: 'updateNoAiStatus', v: 2 } as never, EVENTS);
        expect(q).toEqual([{ type: 'updateNoAiStatus', v: 2 }, snap(1)]);
    });
});
