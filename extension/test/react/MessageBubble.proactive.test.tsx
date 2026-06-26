import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageBubble } from '@webview/views/IrisChat/components/MessageBubble';
import type { ChatMessage } from '@webview/views/IrisChat/types';

function proactive(): ChatMessage {
    return {
        localId: '1',
        role: 'assistant',
        content: 'Have you checked the empty-list case?',
        timestamp: 0,
        origin: 'proactive',
        status: 'sent',
    };
}

describe('MessageBubble proactive', () => {
    it('marks a proactive assistant bubble distinctly', () => {
        const { container } = render(<MessageBubble message={proactive()} onFeedback={() => {}} />);
        expect(container.querySelector('[data-origin="proactive"]')).not.toBeNull();
    });
});
