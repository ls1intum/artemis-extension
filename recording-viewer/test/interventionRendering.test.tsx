import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { RecordedEvent } from '../src/types';
import { eventDetail } from '../src/utils/eventDisplay';

const blocked: RecordedEvent = {
    type: 'intervention', timestamp: 1000, action: 'blocked', level: 'subtle',
    shouldIntervene: false, eq: 0.42, confidence: 'sufficient',
    triggerType: 'idle', blockedReason: 'recent-progress',
};

// A non-blocked intervention that nonetheless carries a blockedReason. The
// renderer must ignore it: blockedReason is only meaningful for action='blocked'.
const nonBlockedWithReason: RecordedEvent = {
    type: 'intervention', timestamp: 2000, action: 'shown', level: 'notification',
    shouldIntervene: true, eq: 0.7, confidence: 'sufficient',
    triggerType: 'execution-error', blockedReason: 'warmup',
};

describe('intervention event rendering', () => {
    it('eventDetail surfaces the blockedReason on a blocked intervention', () => {
        const { container } = render(<>{eventDetail(blocked)}</>);
        expect(container.textContent).toContain('BLOCKED');
        expect(container.textContent).toContain('recent-progress');
    });

    it('eventDetail surfaces last-dismissed as the blockedReason', () => {
        const { container } = render(<>{eventDetail({ ...blocked, blockedReason: 'last-dismissed' })}</>);
        expect(container.textContent).toContain('last-dismissed');
    });

    it('eventDetail does not render a reason for a non-blocked intervention even when blockedReason is present', () => {
        const { container } = render(<>{eventDetail(nonBlockedWithReason)}</>);
        expect(container.textContent).not.toContain('reason:');
        expect(container.textContent).not.toContain('warmup');
    });
});
