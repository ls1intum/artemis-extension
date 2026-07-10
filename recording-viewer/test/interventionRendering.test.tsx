import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { RecordedEvent } from '../src/types';
import { eventDetail } from '../src/utils/eventDisplay';

/**
 * `intervention` was retired from the canonical schema (EQ engine removal,
 * commit 87fd6578, synced into the generated types by 36fbe503) and is no
 * longer part of `RecordedEvent`. Old recordings on disk still contain
 * `intervention` rows and `eventDetail` still renders them (see the legacy
 * branch in eventDisplay.tsx), so this suite keeps exercising that path via a
 * viewer-local legacy shape + cast, mirroring eventDisplay.tsx's own
 * LegacyInterventionEvent.
 */
interface LegacyInterventionEvent {
    type: 'intervention';
    timestamp: number;
    action: string;
    level: string;
    shouldIntervene: boolean;
    eq: number;
    confidence: 'sufficient' | 'insufficient';
    triggerType?: string;
    blockedReason?: string;
}

const blocked: LegacyInterventionEvent = {
    type: 'intervention', timestamp: 1000, action: 'blocked', level: 'subtle',
    shouldIntervene: false, eq: 0.42, confidence: 'sufficient',
    triggerType: 'idle', blockedReason: 'recent-progress',
};

// A non-blocked intervention that nonetheless carries a blockedReason. The
// renderer must ignore it: blockedReason is only meaningful for action='blocked'.
const nonBlockedWithReason: LegacyInterventionEvent = {
    type: 'intervention', timestamp: 2000, action: 'shown', level: 'notification',
    shouldIntervene: true, eq: 0.7, confidence: 'sufficient',
    triggerType: 'execution-error', blockedReason: 'warmup',
};

describe('intervention event rendering', () => {
    it('eventDetail surfaces the blockedReason on a blocked intervention', () => {
        const { container } = render(<>{eventDetail(blocked as unknown as RecordedEvent)}</>);
        expect(container.textContent).toContain('BLOCKED');
        expect(container.textContent).toContain('recent-progress');
    });

    it('eventDetail surfaces last-dismissed as the blockedReason', () => {
        const event = { ...blocked, blockedReason: 'last-dismissed' } as unknown as RecordedEvent;
        const { container } = render(<>{eventDetail(event)}</>);
        expect(container.textContent).toContain('last-dismissed');
    });

    it('eventDetail does not render a reason for a non-blocked intervention even when blockedReason is present', () => {
        const { container } = render(<>{eventDetail(nonBlockedWithReason as unknown as RecordedEvent)}</>);
        expect(container.textContent).not.toContain('reason:');
        expect(container.textContent).not.toContain('warmup');
    });
});
