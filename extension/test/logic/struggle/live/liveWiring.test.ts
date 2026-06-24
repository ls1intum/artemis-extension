import * as vscode from 'vscode';

import type { WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, WebviewCmd } from '@shared/messageContracts';

import { NavigationCommandModule } from '@extension/controller/commands/navigationCommands';
import type { CommandContext } from '@extension/controller/commands/types';
import { LiveEngineFeed } from '@extension/services/struggle/live/liveEngineFeed';

function fakeTick(t: number, over: any = {}): any {
    return {
        t, ts: t * 1000, sBase: 0.4, s: 0.4, v: 0.3, fastDecay: false,
        boundariesPreGate: [], alert: null,
        decisionTrace: {
            outcome: 'suppressed', reason: 'no-candidate', discreteTrigger: null,
            urgency: 0.4, theta: 0.7, typingRate: 0, boundariesPresent: [],
            secondsSinceLastAlert: Number.POSITIVE_INFINITY, inWarmup: false, graceActive: false,
            gates: { fluentTyping: false, grace: false, warmup: false, belowThreshold: false, cooldown: false, notRearmed: false },
        },
        ...over,
    };
}

/** Drives the REAL feed through the REAL NavigationCommandModule routing. */
function makeLiveWiringHarness() {
    const emitter = new vscode.EventEmitter<any>();
    const posted: any[] = [];
    const feed = new LiveEngineFeed({ onDidTick: emitter.event }, m => posted.push(m), () => true, 600);
    // Minimal context: only struggleLiveFeed is touched by the two routes.
    const ctx = { struggleLiveFeed: feed } as unknown as CommandContext;
    const handlers = new NavigationCommandModule(ctx).getHandlers();
    const handleCommand = (command: WebviewCmd): Promise<void> =>
        handlers[command]({ type: 'command', command } as WebviewToExtensionMessage);
    return { handleCommand, posted, fireTick: (t: number) => emitter.fire(fakeTick(t)) };
}

test('struggleLiveSubscribe routes to the feed (reset + backfill of buffered ticks)', async () => {
    const { handleCommand, posted, fireTick } = makeLiveWiringHarness();
    fireTick(10);
    fireTick(20);
    await handleCommand(WebviewCmd.StruggleLiveSubscribe);
    const backfill = posted.find(m => m.type === ExtensionMsg.StruggleLiveBackfill);
    expect(posted.some(m => m.type === ExtensionMsg.StruggleLiveReset)).toBe(true);
    expect(backfill?.ticks.map((t: any) => t.t)).toEqual([10, 20]);
    // After subscribe, live ticks stream through.
    fireTick(30);
    expect(posted.some(m => m.type === ExtensionMsg.StruggleLiveTick && m.tick.t === 30)).toBe(true);
});

test('struggleLiveUnsubscribe stops the live stream', async () => {
    const { handleCommand, posted, fireTick } = makeLiveWiringHarness();
    await handleCommand(WebviewCmd.StruggleLiveSubscribe);
    await handleCommand(WebviewCmd.StruggleLiveUnsubscribe);
    posted.length = 0;
    fireTick(40);
    expect(posted).toHaveLength(0);
});
