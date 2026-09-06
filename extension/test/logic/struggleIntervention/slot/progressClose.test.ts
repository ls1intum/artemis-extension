import { describe, expect, it } from 'vitest';

import type { ProgressCloseCfg } from '@extension/services/struggleIntervention/slot/progressClose';
import { ProgressCloseLatch } from '@extension/services/struggleIntervention/slot/progressClose';

const BASE_CFG: ProgressCloseCfg = { reArmSBase: 0.4, reArmHoldMs: 5_000 };

function latch(cfg: ProgressCloseCfg = BASE_CFG): ProgressCloseLatch {
    return new ProgressCloseLatch(cfg);
}

describe('ProgressCloseLatch', () => {
    describe('initial state', () => {
        it('starts in open', () => {
            expect(latch().state()).toBe('open');
        });

        it('shouldPost is false initially', () => {
            expect(latch().shouldPost()).toBe(false);
        });
    });

    describe('newGreenTest edge', () => {
        it('observe with newGreenTest=true moves open -> pending-post', () => {
            const l = latch();
            l.observe(1000, 0.8, true);
            expect(l.state()).toBe('pending-post');
        });

        it('shouldPost is true after newGreenTest edge', () => {
            const l = latch();
            l.observe(1000, 0.8, true);
            expect(l.shouldPost()).toBe(true);
        });

        it('observe with newGreenTest=false does not owe a close', () => {
            const l = latch();
            l.observe(1000, 0.8, false);
            expect(l.state()).toBe('open');
            expect(l.shouldPost()).toBe(false);
        });
    });

    describe('onPosted totality', () => {
        it('onPosted from open is a no-op (state stays open, shouldPost stays false)', () => {
            const l = latch();
            l.onPosted();
            expect(l.state()).toBe('open');
            expect(l.shouldPost()).toBe(false);
        });

        it('onPosted from pending-post moves to candidate-close', () => {
            const l = latch();
            l.observe(1000, 0.8, true);
            l.onPosted();
            expect(l.state()).toBe('candidate-close');
        });

        it('onPosted from pending-post clears shouldPost', () => {
            const l = latch();
            l.observe(1000, 0.8, true);
            l.onPosted();
            expect(l.shouldPost()).toBe(false);
        });

        it('onPosted from candidate-close is a no-op (state stays candidate-close)', () => {
            const l = latch();
            l.observe(1000, 0.8, true);
            l.onPosted();
            l.onPosted(); // second call from candidate-close
            expect(l.state()).toBe('candidate-close');
            expect(l.shouldPost()).toBe(false);
        });
    });

    describe('wire-busy: owed close survives extra ticks', () => {
        it('shouldPost stays true across multiple ticks without onPosted', () => {
            const l = latch();
            l.observe(1000, 0.8, true);
            expect(l.shouldPost()).toBe(true);
            // Simulate wire busy: more ticks arrive but onPosted not called
            l.observe(2000, 0.7, false);
            expect(l.shouldPost()).toBe(true);
            l.observe(3000, 0.6, false);
            expect(l.shouldPost()).toBe(true);
            expect(l.state()).toBe('pending-post');
        });
    });

    describe('no edge stacking', () => {
        it('second newGreenTest while pending-post does not stack (still one owed close)', () => {
            const l = latch();
            l.observe(1000, 0.8, true); // first edge
            expect(l.state()).toBe('pending-post');
            l.observe(2000, 0.8, true); // second edge while pending
            expect(l.state()).toBe('pending-post'); // same state
            // onPosted consumes exactly one owed close
            l.onPosted();
            expect(l.state()).toBe('candidate-close');
        });

        it('newGreenTest while candidate-close does not add another owed close', () => {
            const l = latch();
            l.observe(1000, 0.8, true);
            l.onPosted(); // candidate-close
            l.observe(2000, 0.8, true); // edge while candidate
            expect(l.state()).toBe('candidate-close'); // no regression to pending-post
            expect(l.shouldPost()).toBe(false);
        });
    });

    describe('onConfirmResult(true) -- terminal', () => {
        it('onConfirmResult(true) from candidate-close moves to a non-firing state', () => {
            const l = latch();
            l.observe(1000, 0.8, true);
            l.onPosted();
            l.onConfirmResult(true);
            // Must not fire again (state is not open)
            l.observe(2000, 0.8, true);
            expect(l.shouldPost()).toBe(false);
        });
    });

    describe('onConfirmResult(false) -- back to open, fresh edge required', () => {
        it('onConfirmResult(false) from candidate-close goes back to open', () => {
            const l = latch();
            l.observe(1000, 0.8, true);
            l.onPosted();
            l.onConfirmResult(false);
            expect(l.state()).toBe('open');
            expect(l.shouldPost()).toBe(false);
        });

        it('a stale tick (no new edge) after onConfirmResult(false) does not re-owe', () => {
            const l = latch();
            l.observe(1000, 0.8, true);
            l.onPosted();
            l.onConfirmResult(false);
            // tick with no newGreenTest
            l.observe(2000, 0.8, false);
            expect(l.state()).toBe('open');
            expect(l.shouldPost()).toBe(false);
        });

        it('a fresh newGreenTest after onConfirmResult(false) re-owes the close', () => {
            const l = latch();
            l.observe(1000, 0.8, true);
            l.onPosted();
            l.onConfirmResult(false);
            l.observe(2000, 0.8, true); // fresh green test
            expect(l.state()).toBe('pending-post');
            expect(l.shouldPost()).toBe(true);
        });
    });

    describe('sBase sustained-below edge', () => {
        it('sBase below reArmSBase for less than reArmHoldMs does not owe a close', () => {
            const l = latch();
            l.observe(0, 0.3, false); // below, t=0
            l.observe(4999, 0.3, false); // still below, 4999ms later -- not yet reArmHoldMs
            expect(l.state()).toBe('open');
            expect(l.shouldPost()).toBe(false);
        });

        it('sBase below for exactly reArmHoldMs owes one close', () => {
            const l = latch();
            l.observe(0, 0.3, false); // below, t=0
            l.observe(5000, 0.3, false); // at reArmHoldMs
            expect(l.state()).toBe('pending-post');
            expect(l.shouldPost()).toBe(true);
        });

        it('sBase below for more than reArmHoldMs owes exactly one close (not many)', () => {
            const l = latch();
            l.observe(0, 0.3, false); // below, t=0
            l.observe(5000, 0.3, false); // fires edge
            expect(l.state()).toBe('pending-post');
            l.onPosted(); // consume
            l.onConfirmResult(true); // terminal
            // No second owe should form from being below continuously
            const l2 = latch();
            l2.observe(0, 0.3, false);
            l2.observe(5000, 0.3, false); // fires, pending-post
            l2.observe(6000, 0.3, false); // still below but already pending-post, no stack
            expect(l2.state()).toBe('pending-post');
        });

        it('sBase at reArmSBase (not strictly below) does not start the timer', () => {
            const l = latch();
            l.observe(0, 0.4, false); // exactly at threshold, NOT below
            l.observe(5000, 0.4, false);
            expect(l.state()).toBe('open');
        });

        it('sBase that rises above reArmSBase resets the timer', () => {
            const l = latch();
            l.observe(0, 0.3, false); // below at t=0
            l.observe(3000, 0.5, false); // rises above threshold (timer resets)
            l.observe(6000, 0.3, false); // back below at t=6000 (3000ms elapsed since reset -- not 5000ms)
            expect(l.state()).toBe('open'); // not yet reArmHoldMs since the latest drop
        });

        it('sBase that rises then drops fires after a fresh reArmHoldMs below', () => {
            const l = latch();
            l.observe(0, 0.3, false); // below
            l.observe(3000, 0.5, false); // above (reset)
            l.observe(4000, 0.3, false); // below again, t=4000
            l.observe(9000, 0.3, false); // 5000ms below since t=4000 -- fires
            expect(l.state()).toBe('pending-post');
        });
    });

    describe('sBase re-arm after onConfirmResult(false)', () => {
        it('still-below sBase right after onConfirmResult(false) does not immediately re-fire', () => {
            const l = latch();
            l.observe(0, 0.3, false); // below
            l.observe(5000, 0.3, false); // fires -> pending-post
            l.onPosted();
            l.onConfirmResult(false); // back to open, armed=false
            // sBase is still below but armed flag cleared -- must NOT re-fire on the same condition
            l.observe(6000, 0.3, false); // 1000ms since confirm(false) -- does not re-fire yet
            expect(l.state()).toBe('open');
            l.observe(11000, 0.3, false); // 6000ms below since the confirm -- still must not fire
            expect(l.state()).toBe('open');
        });

        it('sBase must rise above reArmSBase then re-cross to owe again after onConfirmResult(false)', () => {
            const l = latch();
            l.observe(0, 0.3, false);
            l.observe(5000, 0.3, false); // fires
            l.onPosted();
            l.onConfirmResult(false);
            // Rise above threshold -- clears the armed block
            l.observe(5500, 0.5, false);
            // Drop back below and hold for reArmHoldMs
            l.observe(6000, 0.3, false); // below again at t=6000
            l.observe(11000, 0.3, false); // 5000ms below -- re-fires
            expect(l.state()).toBe('pending-post');
        });
    });

    describe('reset()', () => {
        it('reset from pending-post clears back to open', () => {
            const l = latch();
            l.observe(1000, 0.8, true);
            expect(l.state()).toBe('pending-post');
            l.reset();
            expect(l.state()).toBe('open');
            expect(l.shouldPost()).toBe(false);
        });

        it('reset from candidate-close clears back to open', () => {
            const l = latch();
            l.observe(1000, 0.8, true);
            l.onPosted();
            expect(l.state()).toBe('candidate-close');
            l.reset();
            expect(l.state()).toBe('open');
            expect(l.shouldPost()).toBe(false);
        });

        it('after reset, a fresh edge re-owes the close', () => {
            const l = latch();
            l.observe(1000, 0.8, true);
            l.reset();
            l.observe(2000, 0.8, true);
            expect(l.state()).toBe('pending-post');
        });

        it('after reset, sBase re-arm also works (armed flag cleared)', () => {
            const l = latch();
            l.observe(0, 0.3, false);
            l.observe(5000, 0.3, false); // fires -> pending-post
            l.reset();
            expect(l.state()).toBe('open');
            // Even with sustained sBase below, the armed flag was cleared by reset()
            // so a fresh below-period must start
            l.observe(5001, 0.3, false); // below but armed cleared
            l.observe(10001, 0.3, false); // 5000ms below since reset -- this IS a fresh run, should fire
            expect(l.state()).toBe('pending-post');
        });
    });

    describe('combined: newGreenTest takes priority when both would fire', () => {
        it('newGreenTest=true at the sBase threshold tick moves to pending-post once', () => {
            const l = latch();
            l.observe(0, 0.3, false); // start below
            l.observe(5000, 0.3, true); // also a new green test at the threshold tick
            expect(l.state()).toBe('pending-post');
            // Should still be exactly one owed close
            l.onPosted();
            expect(l.state()).toBe('candidate-close');
        });
    });
});
