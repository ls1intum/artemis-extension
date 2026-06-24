import { describe, expect, it } from 'vitest';

import { classifyIrisFrame } from '@extension/services/struggleIntervention/classifyIrisFrame';

describe('classifyIrisFrame', () => {
    it('flags a proactive MESSAGE via message.origin', () => {
        const r = classifyIrisFrame({ type: 'MESSAGE', message: { id: 1, sender: 'LLM', origin: 'PROACTIVE_STRUGGLE', content: [{ textContent: 'hi', type: 'text' }] } });
        expect(r.kind).toBe('message');
        if (r.kind === 'message') { expect(r.proactive).toBe(true); }
    });
    it('treats a normal MESSAGE as non-proactive', () => {
        const r = classifyIrisFrame({ type: 'MESSAGE', message: { id: 1, sender: 'LLM', content: [] } });
        expect(r).toMatchObject({ kind: 'message', proactive: false });
    });
    it('ignores unknown / typeless frames; STATUS is its own kind', () => {
        expect(classifyIrisFrame({ foo: 1 }).kind).toBe('ignore');
        expect(classifyIrisFrame({ type: 'STATUS' }).kind).toBe('status');
        expect(classifyIrisFrame({ type: 'STRUGGLE_AMBIENT' }).kind).toBe('ignore');
    });
});
