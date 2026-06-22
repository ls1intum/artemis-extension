import * as assert from 'assert';

import { parseRecordedEvent } from '@extension/services/recording/parseRecordedData';

suite('schema v3: struggleScore + alert events', () => {
    test('parseRecordedEvent accepts a well-formed struggleScore', () => {
        const ev = parseRecordedEvent({
            type: 'struggleScore', timestamp: 1000, t: 10, s: 1, v: 1,
            fTyping: 1, fGap: 1, fFb: 0, fA8: 0, fN2: 0,
            typingRate: 0, longestGapS: 60,
        });
        assert.ok(ev);
        assert.strictEqual(ev!.type, 'struggleScore');
    });
    test('parseRecordedEvent accepts a well-formed alert (legacy v2: no urgency)', () => {
        const ev = parseRecordedEvent({
            type: 'alert', timestamp: 2000, t: 490, v: 0.7,
            types: ['STATE'], primary: 'STATE', path: 'armed',
            inWarmup: false, inGrace: false, theta: 0.7,
        });
        assert.ok(ev);
        assert.strictEqual(ev!.type, 'alert');
        assert.strictEqual((ev as { urgency?: number }).urgency, undefined);
    });
    test('parseRecordedEvent preserves urgency on a v3 alert', () => {
        const ev = parseRecordedEvent({
            type: 'alert', timestamp: 2000, t: 490, urgency: 0.72, v: 0.85,
            types: ['STATE'], primary: 'STATE', path: 'armed',
            inWarmup: false, inGrace: false, theta: 0.7,
        });
        assert.ok(ev);
        assert.strictEqual((ev as { urgency?: number }).urgency, 0.72);
    });
    test('rejects struggleScore with a non-finite score', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'struggleScore', timestamp: 1, t: 10, s: NaN, v: 0 }), null);
    });
    test('rejects alert with an invalid path', () => {
        assert.strictEqual(parseRecordedEvent({
            type: 'alert', timestamp: 1, t: 10, v: 0.7, types: ['STATE'],
            primary: 'STATE', path: 'bogus', inWarmup: false, inGrace: false, theta: 0.6,
        }), null);
    });
});
