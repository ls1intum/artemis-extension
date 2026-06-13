import * as assert from 'assert';

import { parseRecordedEvent } from '@extension/services/recording/parseRecordedData';

suite('schema v3: struggleScore + alert events', () => {
    test('parseRecordedEvent accepts a well-formed struggleScore', () => {
        const ev = parseRecordedEvent({
            type: 'struggleScore', timestamp: 1000, t: 10, s: 0.7, v: 0.7,
            fTyping: 1, fGap: 1, fN4: 0.1, fFb: 0, fA8: 0, fN2: 0,
            typingRate: 0, longestGapS: 60, n4Ratio: 1,
        });
        assert.ok(ev);
        assert.strictEqual(ev!.type, 'struggleScore');
    });
    test('parseRecordedEvent accepts a well-formed alert', () => {
        const ev = parseRecordedEvent({
            type: 'alert', timestamp: 2000, t: 490, v: 0.7,
            types: ['STATE'], primary: 'STATE', path: 'armed',
            inWarmup: false, inGrace: false, theta: 0.6,
        });
        assert.ok(ev);
        assert.strictEqual(ev!.type, 'alert');
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
