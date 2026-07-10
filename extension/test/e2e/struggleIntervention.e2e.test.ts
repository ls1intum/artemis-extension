/**
 * E2E Test: Proactive Struggle-Intervention round-trip
 *
 * Drives the REAL extension client (`ArtemisApiService.postStruggleIntervention`)
 * against a live Artemis + Pyris stack and verifies the full round-trip:
 * client POST -> Artemis -> Pyris (real chat LLM) -> callback -> Artemis surfacing.
 *
 * For an `active` decision the server materializes the per-exercise chat session
 * and persists an origin-tagged proactive bubble; we discover that session via
 * the get-or-create endpoint and assert the `PROACTIVE_STRUGGLE` message appears.
 *
 * PREREQUISITES:
 * - Artemis on localhost:8080 with Iris wired to a live Pyris (localhost:8000).
 * - Pyris reachable with a chat-role LLM for `struggle_intervention_pipeline`.
 * - A programming exercise (CONFIG.exerciseId) whose course the student is in.
 * - The student is opted into LLM usage (ai_selection_decision != NO_AI).
 */

import * as assert from 'assert';

import { ArtemisApiService } from '@extension/api';
import { AuthManager } from '@extension/services/auth/authManager';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { StruggleInterventionRequest } from '@extension/services/struggleIntervention/struggleContract';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

const CONFIG = {
    artemisUrl: process.env.ARTEMIS_URL || 'http://localhost:8080',
    // The struggle endpoint is @EnforceAtLeastStudent + LLM opt-in, so we act as a student, not admin.
    username: process.env.ARTEMIS_STUDENT_USER || 'artemis_test_user_1',
    password: process.env.ARTEMIS_STUDENT_PASSWORD || 'artemis_test_user_1',
    exerciseId: parseInt(process.env.ARTEMIS_EXERCISE_ID ?? '1'),
    suiteTimeoutMs: 180_000,
    pollIntervalMs: 3000,
    bubbleTimeoutMs: 120_000,
};

/** The real ArtemisApiService, but with the server URL pinned to the live test stack (no vscode setting). */
class E2EApiService extends ArtemisApiService {
    constructor(authManager: AuthManager, private readonly _url: string) {
        super(authManager);
    }

    protected getServerUrl(): string {
        return this._url;
    }
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** A deliberately "stuck" signal (failed build + a constant-return stub) to bias the gate toward an intervention. */
function buildStuckRequest(): StruggleInterventionRequest {
    return {
        struggleSignal: {
            alert: {
                tSessionS: 540,
                primaryBoundary: 'FM',
                boundaryTypes: ['FM', 'STATE'],
                severity: 0.78,
                path: 'armed',
                inWarmup: false,
                inGrace: false,
            },
            trajectory: [
                { t: 500, s: 0.5 },
                { t: 520, s: 0.62 },
                { t: 540, s: 0.74 },
            ],
            sessionSeconds: 540,
        },
        uncommittedFiles: {
            'src/Sum.java': 'class Sum {\n    int sum(int[] a) {\n        // TODO: still returns a constant, tests keep failing\n        return 0;\n    }\n}\n',
        },
        intent: 'decide',
        episode: { episodeId: 'e2e-ep-uuid', isNew: true, hints: [] },
        requestToken: 'e2e-request-token',
    };
}

suite('E2E: Proactive Struggle-Intervention round-trip', function () {
    this.timeout(CONFIG.suiteTimeoutMs);

    let apiService: E2EApiService;
    let suiteReady = false;

    suiteSetup(async function () {
        logger.info('\n==== E2E: Struggle-Intervention round-trip ====', LogCategory.TEST);
        logger.info(`  Artemis: ${CONFIG.artemisUrl}  student: ${CONFIG.username}  exercise: ${CONFIG.exerciseId}`, LogCategory.TEST);

        // Skip the suite if the stack is offline rather than failing it.
        try {
            const health = await fetch(CONFIG.artemisUrl);
            if (!health.ok) { throw new Error(`Artemis returned ${health.status}`); }
        } catch {
            logger.error('[E2E-Struggle] Artemis not running — skipping suite', LogCategory.TEST);
            this.skip();
            return;
        }

        // Build the REAL extension client and log in through its own auth flow (Desktop Cookie mode).
        apiService = new E2EApiService(new AuthManager(new MockExtensionContext()), CONFIG.artemisUrl);
        try {
            const result = await apiService.authenticate(CONFIG.username, CONFIG.password, true);
            assert.ok(result.success, 'authenticate() should succeed');
        } catch (err) {
            logger.error(`[E2E-Struggle] Student login failed (${(err as Error).message}) — skipping suite`, LogCategory.TEST);
            this.skip();
            return;
        }

        // Sanity: the authenticated client resolves the account (auth wiring is correct).
        const account = await apiService.getCurrentUser();
        assert.ok(account?.login, 'Authenticated account should resolve');

        suiteReady = true;
        logger.info(`[E2E-Struggle] Authenticated as ${account.login}`, LogCategory.TEST);
    });

    test('1. postStruggleIntervention is accepted (202) by the live endpoint', async function () {
        if (!suiteReady) { this.skip(); return; }

        const result = await apiService.postStruggleIntervention(CONFIG.exerciseId, buildStuckRequest());

        logger.info(`[E2E-Struggle] postStruggleIntervention -> ${result}`, LogCategory.TEST);
        assert.strictEqual(result, 'accepted', `Expected 'accepted', got '${result}' (unavailable=404/feature missing, failed=other error)`);
    });

    test('2. an active decision surfaces a persisted PROACTIVE_STRUGGLE bubble', async function () {
        if (!suiteReady) { this.skip(); return; }
        this.timeout(CONFIG.bubbleTimeoutMs + 15_000);

        logger.info(`[E2E-Struggle] Polling the exercise chat session for a proactive bubble (<= ${CONFIG.bubbleTimeoutMs / 1000}s)...`, LogCategory.TEST);

        const deadline = Date.now() + CONFIG.bubbleTimeoutMs;
        let lastSeen = 'no session yet';

        while (Date.now() < deadline) {
            try {
                // get-or-create the immutable per-exercise chat session (the same one an `active` decision materializes).
                const session = await apiService.getCurrentChat('PROGRAMMING_EXERCISE_CHAT', CONFIG.exerciseId);
                const messages = await apiService.getChatMessages(session.id);
                const proactive = messages.find(m => (m as { origin?: string }).origin === 'PROACTIVE_STRUGGLE');

                if (proactive) {
                    const text = JSON.stringify((proactive as { content?: unknown }).content ?? proactive);
                    logger.info(`[E2E-Struggle] Proactive bubble found in session ${session.id}: ${text.slice(0, 240)}`, LogCategory.TEST);
                    assert.ok(text.length > 0, 'Proactive bubble should carry content');
                    return;
                }
                lastSeen = `session ${session.id}, ${messages.length} message(s), none proactive`;
            } catch (err) {
                lastSeen = `lookup error: ${(err as Error).message}`;
            }
            await sleep(CONFIG.pollIntervalMs);
        }

        assert.fail(`No PROACTIVE_STRUGGLE bubble within ${CONFIG.bubbleTimeoutMs / 1000}s. Last: ${lastSeen}. ` +
            `(The POST was accepted; the gate may have returned ambient/silent for this signal, or the LLM round-trip exceeded the timeout.)`);
    });

    suiteTeardown(function () {
        logger.info('==== E2E: Struggle-Intervention round-trip complete ====\n', LogCategory.TEST);
    });
});
