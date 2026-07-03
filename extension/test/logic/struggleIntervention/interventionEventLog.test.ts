import { describe, expect, it } from 'vitest';

import { InterventionEventLog, type InterventionLogEvent } from '@extension/services/struggleIntervention/interventionEventLog';

describe('InterventionEventLog', () => {
    it('appends one JSON line per event via the injected writer', async () => {
        const lines: string[] = [];
        const log = new InterventionEventLog(async (line: string) => { lines.push(line); }, () => 1000);
        const signal = { alert: { tSessionS: 540, primaryBoundary: 'FM' as const, boundaryTypes: ['FM' as const], severity: 0.7, path: 'armed' as const, inWarmup: false, inGrace: false }, trajectory: [], dominantComponents: [], sessionSeconds: 540 };
        const ev: InterventionLogEvent = { action: 'active', confidence: 0.8, finalAction: 'active', surface: 'bubble', source: 'server', signal };
        await log.record(ev);
        expect(lines).toHaveLength(1);
        const parsed = JSON.parse(lines[0]);
        expect(parsed).toMatchObject({ type: 'struggle-intervention', action: 'active', surface: 'bubble', timestamp: 1000 });
        expect(parsed.signal.alert.primaryBoundary).toBe('FM');
    });
});
