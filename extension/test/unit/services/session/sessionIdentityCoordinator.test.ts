import * as assert from 'assert';
import * as sinon from 'sinon';

import { ApiError } from '@extension/domain/errors';
import type { SessionIdentityDeps, SessionResetTargets } from '@extension/services/session/sessionIdentityCoordinator';
import { SessionIdentityCoordinator } from '@extension/services/session/sessionIdentityCoordinator';

function deps(overrides: Partial<SessionIdentityDeps> = {}): SessionIdentityDeps {
    return {
        serverKey: () => 'https://a.example',
        hasAuthToken: async () => true,
        getCurrentUser: async () => ({ id: 1, login: 'ab12cde' }),
        ...overrides,
    };
}

function recordingTargets(log: string[]): SessionResetTargets {
    return {
        resetConversation: () => log.push('conversation'),
        endTelemetrySession: () => log.push('telemetry'),
        clearWorkspaceTracker: () => log.push('workspace'),
        clearCatalog: () => log.push('catalog'),
        resetRegistry: () => log.push('registry'),
        publishEmptyChatSnapshot: () => log.push('snapshot'),
        rearmStartup: () => log.push('startup'),
    };
}

suite('SessionIdentityCoordinator', () => {
    test('starts resolving and bumps the epoch on a real transition', () => {
        const coordinator = new SessionIdentityCoordinator(deps());
        assert.strictEqual(coordinator.state.kind, 'resolving');
        const before = coordinator.epoch;
        coordinator.setAuthenticated('https://a.example', 'id:1');
        assert.strictEqual(coordinator.state.kind, 'authenticated');
        assert.ok(coordinator.epoch > before);
    });

    test('emitting the same identity twice resets nothing', () => {
        const log: string[] = [];
        const coordinator = new SessionIdentityCoordinator(deps());
        coordinator.attach(recordingTargets(log));
        coordinator.setAuthenticated('https://a.example', 'id:1');
        const epoch = coordinator.epoch;
        log.length = 0;
        coordinator.setAuthenticated('https://a.example', 'id:1');
        assert.deepStrictEqual(log, []);
        assert.strictEqual(coordinator.epoch, epoch);
    });

    test('resets in the documented order, startup last', () => {
        const log: string[] = [];
        const coordinator = new SessionIdentityCoordinator(deps());
        coordinator.attach(recordingTargets(log));
        coordinator.setAuthenticated('https://a.example', 'id:1');
        assert.deepStrictEqual(log, [
            'conversation', 'telemetry', 'workspace', 'catalog', 'registry', 'snapshot', 'startup',
        ]);
    });

    // Nothing else ends it: the tracker's clear event is deliberately ignored
    // by the telemetry bridge, so without this the detector keeps recording the
    // previous account's session across the identity boundary.
    test('an identity change ends the detector session before the tracker is cleared', () => {
        const log: string[] = [];
        const coordinator = new SessionIdentityCoordinator(deps());
        coordinator.attach(recordingTargets(log));
        coordinator.setAuthenticated('https://a.example', 'id:1');
        log.length = 0;

        coordinator.setAuthenticated('https://a.example', 'id:2');

        assert.ok(log.includes('telemetry'), 'the exercise session must be ended on every identity change');
        assert.ok(log.indexOf('telemetry') < log.indexOf('workspace'),
            'the session is closed while the exercise it belongs to is still known');
    });

    test('a second principal on the same server is a transition', () => {
        const coordinator = new SessionIdentityCoordinator(deps());
        coordinator.setAuthenticated('https://a.example', 'id:1');
        const epoch = coordinator.epoch;
        coordinator.setAuthenticated('https://a.example', 'id:2');
        assert.ok(coordinator.epoch > epoch);
    });

    test('a server change while anonymous is a transition', () => {
        const log: string[] = [];
        const coordinator = new SessionIdentityCoordinator(deps());
        coordinator.setAnonymous('https://a.example');
        coordinator.attach(recordingTargets(log));
        coordinator.beginResolving('https://b.example');
        assert.ok(log.includes('catalog'));
        assert.strictEqual(coordinator.state.kind, 'resolving');
    });

    test('an access scope exists only while authenticated', () => {
        const coordinator = new SessionIdentityCoordinator(deps());
        assert.strictEqual(coordinator.accessScope(), null);
        coordinator.setAnonymous('https://a.example');
        assert.strictEqual(coordinator.accessScope(), null);
        coordinator.setAuthenticated('https://a.example', 'id:1');
        assert.deepStrictEqual(coordinator.accessScope(), { serverKey: 'https://a.example', principal: 'id:1' });
    });

    test('the event carries the state that was just installed', () => {
        const coordinator = new SessionIdentityCoordinator(deps());
        const seen: string[] = [];
        coordinator.onDidChangeSession(state => seen.push(state.kind));
        coordinator.setAuthenticated('https://a.example', 'id:1');
        coordinator.setAnonymous('https://a.example');
        assert.deepStrictEqual(seen, ['authenticated', 'anonymous']);
    });

    test('resolves the principal without waiting for any webview', async () => {
        const coordinator = new SessionIdentityCoordinator(deps());
        await coordinator.resolvePrincipal();
        assert.deepStrictEqual(coordinator.state, {
            kind: 'authenticated', serverKey: 'https://a.example', principal: 'id:1',
        });
    });

    test('no token is anonymous, and the user is never asked for', async () => {
        let asked = 0;
        const coordinator = new SessionIdentityCoordinator(deps({
            hasAuthToken: async () => false,
            getCurrentUser: async () => { asked++; return { id: 1 }; },
        }));
        await coordinator.resolvePrincipal();
        assert.strictEqual(coordinator.state.kind, 'anonymous');
        assert.strictEqual(asked, 0);
    });

    test('a 401 is anonymous', async () => {
        const coordinator = new SessionIdentityCoordinator(deps({
            getCurrentUser: async () => { throw new ApiError('nope', 401); },
        }));
        await coordinator.resolvePrincipal();
        assert.strictEqual(coordinator.state.kind, 'anonymous');
    });

    test('a transient failure stays resolving and does not log the student out', async () => {
        const coordinator = new SessionIdentityCoordinator(deps({
            getCurrentUser: async () => { throw new Error('ETIMEDOUT'); },
        }));
        await coordinator.resolvePrincipal();
        assert.strictEqual(coordinator.state.kind, 'resolving');
        // Disposal, not decoration: the transient branch leaves an automatic
        // re-attempt armed, and a timer surviving this test would fire during
        // a later one.
        coordinator.dispose();
    });

    // The defect this token exists for: a logout, a 401 or a server change
    // lands while `getCurrentUser` is still open, and the stale answer would
    // otherwise reinstate the previous identity on the previous server.
    test('a resolution superseded while it was open publishes nothing', async () => {
        let release: (user: { id: number }) => void = () => undefined;
        let notifyCalled: () => void = () => undefined;
        const called = new Promise<void>(resolve => { notifyCalled = resolve; });
        const coordinator = new SessionIdentityCoordinator(deps({
            getCurrentUser: () => {
                notifyCalled();
                return new Promise(resolve => { release = resolve; });
            },
        }));
        const pending = coordinator.resolvePrincipal();
        await called;   // getCurrentUser is now genuinely in flight
        coordinator.setAnonymous('https://a.example');
        release({ id: 1 });
        await pending;
        assert.strictEqual(coordinator.state.kind, 'anonymous');
    });

    // The load-bearing one for the token's PLACEMENT. `beginResolving` with an
    // unchanged state is a no-op for the state but still a newer intent, so it
    // only invalidates the open lookup if `_attempt++` runs BEFORE the
    // equality early-return. The `setAnonymous` test above would pass either
    // way, because that is a real transition.
    test('a repeated resolve invalidates the one already open', async () => {
        let release: (user: { id: number }) => void = () => undefined;
        let call = 0;
        const coordinator = new SessionIdentityCoordinator(deps({
            getCurrentUser: () => {
                call++;
                return call === 1
                    ? new Promise(resolve => { release = resolve; })
                    : new Promise(() => undefined);   // the second never answers
            },
        }));
        const first = coordinator.resolvePrincipal();
        void coordinator.resolvePrincipal();
        release({ id: 1 });
        await first;
        assert.strictEqual(coordinator.state.kind, 'resolving');
    });

    // The thrower behind the server-URL listener's `anonymous` fallback:
    // `hasAuthToken` reads SecretStorage, which can reject. HERE staying
    // `resolving` is correct, because a later login calls `resolvePrincipal`
    // again; the listener has no such retry, which is why its catch publishes
    // `anonymous` instead. The two tests below are that asymmetry, pinned.
    test('a token read failure stays resolving and settles nothing', async () => {
        const seen: string[] = [];
        const coordinator = new SessionIdentityCoordinator(deps({
            hasAuthToken: async () => { throw new Error('keychain unavailable'); },
        }));
        coordinator.setAuthenticated('https://a.example', 'id:1');
        coordinator.onDidChangeSession(state => seen.push(state.kind));
        await coordinator.resolvePrincipal();
        assert.strictEqual(coordinator.state.kind, 'resolving');
        // `resolvePrincipal` opens with `beginResolving`, so the previous
        // identity's data is dropped either way. What a failed READ must not do
        // is settle: anonymous here would log out a student whose token is
        // probably still there.
        assert.deepStrictEqual(seen, ['resolving']);
        coordinator.dispose();
    });

    test('an anonymous session on a new server is terminal but leavable', async () => {
        let token = false;
        const coordinator = new SessionIdentityCoordinator(deps({
            serverKey: () => 'https://b.example',
            hasAuthToken: async () => token,
        }));
        coordinator.setAuthenticated('https://a.example', 'id:1');

        // What the server-URL listener does: reset first, then settle. Its
        // catch has to settle too, or the session is stranded in `resolving`.
        coordinator.beginResolving('https://b.example');
        coordinator.setAnonymous('https://b.example');
        assert.deepStrictEqual(coordinator.state, { kind: 'anonymous', serverKey: 'https://b.example' });
        assert.strictEqual(coordinator.accessScope(), null);

        // The login that follows the server change lifts it out again, which is
        // what makes `anonymous` a safe answer to publish on a failure.
        token = true;
        await coordinator.resolvePrincipal();
        assert.deepStrictEqual(coordinator.state, {
            kind: 'authenticated', serverKey: 'https://b.example', principal: 'id:1',
        });
    });

    test('a user the key cannot name leaves the session resolving', async () => {
        const coordinator = new SessionIdentityCoordinator(deps({
            getCurrentUser: async () => ({}),
        }));
        await coordinator.resolvePrincipal();
        assert.strictEqual(coordinator.state.kind, 'resolving');
        coordinator.dispose();
    });

    // Staying `resolving` is right (a credential is still held), but on its
    // own it is a dead end: nothing else in the shipped wiring re-attempts the
    // lookup for an already-logged-in student, so one failed request at
    // activation would cost the whole window. Two escapes, both here: a
    // bounded automatic re-attempt, and an announcement when those run out so
    // a UI can offer the student a Retry.

    suite('recovery', () => {
        let clock: sinon.SinonFakeTimers;

        setup(() => {
            clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        });

        teardown(() => {
            clock.restore();
        });

        /** Drains the retry the transient branch just armed, then its lookup. */
        async function runPendingRetry(): Promise<void> {
            await clock.nextAsync();
            // `_attemptResolve` awaits `hasAuthToken` and `getCurrentUser`, so
            // its outcome lands two microtask turns after the timer fires.
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        }

        test('a transient failure recovers on its own once the server answers again', async () => {
            let calls = 0;
            const coordinator = new SessionIdentityCoordinator(deps({
                getCurrentUser: async () => {
                    calls++;
                    if (calls === 1) { throw new Error('ETIMEDOUT'); }
                    return { id: 7 };
                },
            }));
            await coordinator.resolvePrincipal();
            assert.strictEqual(coordinator.state.kind, 'resolving');

            await runPendingRetry();

            assert.deepStrictEqual(coordinator.state, {
                kind: 'authenticated', serverKey: 'https://a.example', principal: 'id:7',
            });
            coordinator.dispose();
        });

        test('nothing is announced while an automatic re-attempt is still pending', async () => {
            let stalls = 0;
            const coordinator = new SessionIdentityCoordinator(deps({
                getCurrentUser: async () => { throw new Error('ETIMEDOUT'); },
            }));
            coordinator.onDidStallResolution(() => { stalls++; });
            await coordinator.resolvePrincipal();
            assert.strictEqual(stalls, 0, 'a retry is armed; the session is not stuck yet');
            coordinator.dispose();
        });

        test('the session announces that it is stuck once the retries run out', async () => {
            let stalls = 0;
            let calls = 0;
            const coordinator = new SessionIdentityCoordinator(deps({
                getCurrentUser: async () => { calls++; throw new Error('ETIMEDOUT'); },
            }));
            coordinator.onDidStallResolution(() => { stalls++; });
            await coordinator.resolvePrincipal();
            await runPendingRetry();
            await runPendingRetry();
            await runPendingRetry();

            assert.strictEqual(stalls, 1, 'the student must be told exactly once that this is stuck');
            assert.strictEqual(calls, 4, 'the first attempt plus a bounded three');
            assert.strictEqual(coordinator.state.kind, 'resolving', 'a held credential is still not a logout');
            coordinator.dispose();
        });

        test('an unnameable user announces immediately, without burning retries', async () => {
            let stalls = 0;
            let calls = 0;
            const coordinator = new SessionIdentityCoordinator(deps({
                getCurrentUser: async () => { calls++; return {}; },
            }));
            coordinator.onDidStallResolution(() => { stalls++; });
            await coordinator.resolvePrincipal();

            assert.strictEqual(stalls, 1);
            assert.strictEqual(calls, 1, 'the same request would return the same unnameable user');
            coordinator.dispose();
        });

        test('a login that lands first cancels the pending re-attempt', async () => {
            let calls = 0;
            const coordinator = new SessionIdentityCoordinator(deps({
                getCurrentUser: async () => { calls++; throw new Error('ETIMEDOUT'); },
            }));
            await coordinator.resolvePrincipal();
            assert.strictEqual(calls, 1);

            coordinator.setAuthenticated('https://a.example', 'id:9');
            await runPendingRetry();

            assert.strictEqual(calls, 1, 'the timer must lose to the newer identity');
            assert.deepStrictEqual(coordinator.state, {
                kind: 'authenticated', serverKey: 'https://a.example', principal: 'id:9',
            });
            coordinator.dispose();
        });

        test('disposing cancels the pending re-attempt', async () => {
            let calls = 0;
            const coordinator = new SessionIdentityCoordinator(deps({
                getCurrentUser: async () => { calls++; throw new Error('ETIMEDOUT'); },
            }));
            await coordinator.resolvePrincipal();
            coordinator.dispose();

            await runPendingRetry();

            assert.strictEqual(calls, 1);
        });

        // The escape hatch must not disappear behind a spinner on every click.
        // `ChatStartupCoordinator.retry()` publishes `unsettled` before it
        // re-resolves, so anything the coordinator does not answer promptly is
        // time the student spends with no Retry and no course chooser on
        // screen. A refilled budget would cost them the whole schedule, per
        // click, against a server that is still down.
        test('a retry after a stall answers promptly instead of spending a new budget', async () => {
            let stalls = 0;
            let calls = 0;
            const coordinator = new SessionIdentityCoordinator(deps({
                getCurrentUser: async () => { calls++; throw new Error('ETIMEDOUT'); },
            }));
            coordinator.onDidStallResolution(() => { stalls++; });
            await coordinator.resolvePrincipal();
            await runPendingRetry();
            await runPendingRetry();
            await runPendingRetry();
            assert.strictEqual(stalls, 1);
            assert.strictEqual(calls, 4);

            // What the chat's Retry reaches. No timer is advanced afterwards:
            // the second announcement has to be there already.
            await coordinator.resolvePrincipal();

            assert.strictEqual(calls, 5, 'the click makes a real request');
            assert.strictEqual(stalls, 2, 'and its failure is announced at once, not a budget later');
            coordinator.dispose();
        });

        test('a settled identity refills the budget for the next episode', async () => {
            let calls = 0;
            let failing = true;
            const coordinator = new SessionIdentityCoordinator(deps({
                getCurrentUser: async () => {
                    calls++;
                    if (failing) { throw new Error('ETIMEDOUT'); }
                    return { id: 7 };
                },
            }));
            await coordinator.resolvePrincipal();
            await runPendingRetry();
            await runPendingRetry();
            await runPendingRetry();
            assert.strictEqual(calls, 4, 'the budget is spent');

            // The retry that works. Settling is what earns patience back.
            failing = false;
            await coordinator.resolvePrincipal();
            assert.strictEqual(coordinator.state.kind, 'authenticated');

            failing = true;
            calls = 0;
            await coordinator.resolvePrincipal();
            await runPendingRetry();
            await runPendingRetry();
            await runPendingRetry();

            assert.strictEqual(calls, 4, 'a fresh episode is patient again');
            coordinator.dispose();
        });
    });
});
