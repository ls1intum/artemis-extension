/**
 * E2E Test: Uncommitted Changes Flow
 * 
 * This test verifies that the extension correctly sends uncommitted files to Artemis/Iris.
 * 
 * PREREQUISITES:
 * - Artemis running on localhost:8080
 * - Iris running on localhost:8000
 * - Valid test user (artemis_admin/artemis_admin)
 * - Exercise ID 1 exists (bubblesort exercise)
 */

import * as assert from 'assert';

import { LogCategory, logger } from '@extension/services/loggingService';

const CONFIG = {
    artemisUrl: process.env.ARTEMIS_URL || 'http://localhost:8080',
    username: process.env.ARTEMIS_USER || 'artemis_admin',
    password: process.env.ARTEMIS_PASSWORD || 'artemis_admin',
    // Canonical name is ARTEMIS_EXERCISE_ID (matches the UI test); the
    // unprefixed EXERCISE_ID is still accepted as a fallback.
    exerciseId: parseInt(process.env.ARTEMIS_EXERCISE_ID ?? process.env.EXERCISE_ID ?? '1'),
    timeout: 30000, // 30 seconds for Iris response
};

const TEST_FILES = {
    // Buggy BubbleSort (swapped = false instead of true)
    buggyBubbleSort: {
        path: 'src/de/tum/cit/aet/BubbleSort.java',
        content: `package de.tum.cit.aet;

import java.util.Date;
import java.util.List;

public class BubbleSort implements SortStrategy {

    public void performSort(final List<Date> input) {
        if (input == null || input.size() < 2) {
            return;
        }

        int n = input.size();
        boolean swapped;

        for (int i = 0; i < n - 1; i++) {
            swapped = false;
            for (int j = 0; j < n - 1 - i; j++) {
                Date left = input.get(j);
                Date right = input.get(j + 1);

                if (left.after(right)) {
                    input.set(j, right);
                    input.set(j + 1, left);
                    swapped = false;  // BUG: Should be 'true'
                }
            }
            if (!swapped) {
                break;
            }
        }
    }
}
`
    },

    // New QuickSort file (doesn't exist in repo)
    newQuickSort: {
        path: 'src/de/tum/cit/aet/QuickSort.java',
        content: `package de.tum.cit.aet;

import java.util.Date;
import java.util.List;

/**
 * QuickSort - NEW FILE from E2E Test
 * This file does NOT exist in the committed repository.
 */
public class QuickSort implements SortStrategy {

    @Override
    public void performSort(List<Date> input) {
        if (input == null || input.size() < 2) {
            return;
        }
        quickSort(input, 0, input.size() - 1);
    }

    private void quickSort(List<Date> list, int low, int high) {
        if (low < high) {
            int pivotIndex = partition(list, low, high);
            quickSort(list, low, pivotIndex - 1);
            quickSort(list, pivotIndex + 1, high);
        }
    }

    private int partition(List<Date> list, int low, int high) {
        Date pivot = list.get(high);
        int i = low - 1;

        for (int j = low; j < high; j++) {
            if (list.get(j).before(pivot)) {
                i++;
                swap(list, i, j);
            }
        }
        swap(list, i + 1, high);
        return i + 1;
    }

    private void swap(List<Date> list, int i, int j) {
        Date temp = list.get(i);
        list.set(i, list.get(j));
        list.set(j, temp);
    }
}
`
    }
};

import { ArtemisTestClient as ArtemisTestClientBase } from './helpers/artemisTestClient';

class ArtemisTestClient extends ArtemisTestClientBase {
    async getOrCreateSession(exerciseId: number): Promise<number | null> {
        logger.info(`[E2E] Getting/creating Iris session for exercise ${exerciseId}...`, LogCategory.TEST);

        const params = new URLSearchParams({
            mode: 'PROGRAMMING_EXERCISE_CHAT',
            entityId: String(exerciseId),
        });

        let response = await fetch(
            `${this.baseUrl}/api/iris/chat/sessions/current?${params.toString()}`,
            { method: 'POST', headers: this.getHeaders() },
        );

        if (response.ok) {
            const data = await response.json() as { id: number };
            logger.info(`[E2E] Found existing session: ${data.id}`, LogCategory.TEST);
            return data.id;
        }

        response = await fetch(
            `${this.baseUrl}/api/iris/chat/sessions?${params.toString()}`,
            { method: 'POST', headers: this.getHeaders() },
        );

        if (response.ok) {
            const data = await response.json() as { id: number };
            logger.info(`[E2E] Created new session: ${data.id}`, LogCategory.TEST);
            return data.id;
        }

        logger.error(`[E2E] Failed to create session: ${response.status}`, LogCategory.TEST);
        return null;
    }

    async sendMessageWithUncommittedFiles(
        sessionId: number,
        message: string,
        uncommittedFiles: Map<string, string>
    ): Promise<{ success: boolean; response?: any; error?: string }> {
        logger.info(`[E2E] Sending message to session ${sessionId}...`, LogCategory.TEST);
        logger.info(`[E2E]   Message: ${message.substring(0, 50)}...`, LogCategory.TEST);
        logger.info(`[E2E]   Uncommitted files: ${Array.from(uncommittedFiles.keys()).join(', ')}`, LogCategory.TEST);

        const payload = {
            sentAt: new Date().toISOString(),
            content: [
                {
                    textContent: message,
                    type: 'text',
                },
            ],
            uncommittedFiles: Object.fromEntries(uncommittedFiles),
        };

        const response = await fetch(
            `${this.baseUrl}/api/iris/sessions/${sessionId}/messages`,
            {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(payload),
            }
        );

        if (response.ok) {
            const data = await response.json();
            logger.info('[E2E] Message sent successfully!', LogCategory.TEST);
            return { success: true, response: data };
        } else {
            const errorText = await response.text();
            logger.error(`[E2E] Failed to send message: ${response.status} - ${errorText}`, LogCategory.TEST);
            return { success: false, error: errorText };
        }
    }

    async sendMessageWithoutUncommittedFiles(
        sessionId: number,
        message: string
    ): Promise<{ success: boolean; response?: any; error?: string }> {
        logger.info(`[E2E] Sending message WITHOUT uncommitted files to session ${sessionId}...`, LogCategory.TEST);

        const payload = {
            sentAt: new Date().toISOString(),
            content: [
                {
                    textContent: message,
                    type: 'text',
                },
            ],
        };

        const response = await fetch(
            `${this.baseUrl}/api/iris/sessions/${sessionId}/messages`,
            {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(payload),
            }
        );

        if (response.ok) {
            const data = await response.json();
            return { success: true, response: data };
        } else {
            const errorText = await response.text();
            return { success: false, error: errorText };
        }
    }
}

suite('E2E: Uncommitted Changes Flow', function () {
    this.timeout(CONFIG.timeout);

    let client: ArtemisTestClient;
    let sessionId: number;

    suiteSetup(async function () {
        logger.info('\n========================================', LogCategory.TEST);
        logger.info('E2E Test: Uncommitted Changes Flow', LogCategory.TEST);
        logger.info('========================================\n', LogCategory.TEST);

        logger.info('Configuration:', LogCategory.TEST);
        logger.info(`  Artemis URL: ${CONFIG.artemisUrl}`, LogCategory.TEST);
        logger.info(`  Username: ${CONFIG.username}`, LogCategory.TEST);
        logger.info(`  Exercise ID: ${CONFIG.exerciseId}`, LogCategory.TEST);
        logger.info('', LogCategory.TEST);

        try {
            const healthCheck = await fetch(CONFIG.artemisUrl);
            if (!healthCheck.ok) {
                throw new Error(`Artemis returned ${healthCheck.status}`);
            }
        } catch (error) {
            logger.error('❌ Artemis is not running!', LogCategory.TEST);
            logger.error('   Please start Artemis on localhost:8080 before running E2E tests.', LogCategory.TEST);
            this.skip();
            return;
        }

        logger.info('✅ Artemis is running\n', LogCategory.TEST);

        client = new ArtemisTestClient(CONFIG.artemisUrl);
        const loggedIn = await client.login(CONFIG.username, CONFIG.password);
        if (!loggedIn) {
            logger.error('❌ Login failed!', LogCategory.TEST);
            this.skip();
            return;
        }

        const session = await client.getOrCreateSession(CONFIG.exerciseId);
        if (!session) {
            logger.error('❌ Could not create Iris session!', LogCategory.TEST);
            this.skip();
            return;
        }
        sessionId = session;

        logger.info('\n✅ Setup complete\n', LogCategory.TEST);
    });

    test('should send message with uncommitted BubbleSort.java', async function () {
        const uncommittedFiles = new Map<string, string>();
        uncommittedFiles.set(
            TEST_FILES.buggyBubbleSort.path,
            TEST_FILES.buggyBubbleSort.content
        );

        const result = await client.sendMessageWithUncommittedFiles(
            sessionId,
            'Was ist der Fehler in meiner BubbleSort Implementierung? Bitte schau dir meinen Code an.',
            uncommittedFiles
        );

        assert.strictEqual(result.success, true, `Message should be sent successfully. Error: ${result.error}`);
        assert.ok(result.response, 'Response should not be null');
        assert.ok(result.response.id, 'Response should have an ID');

        logger.info(`✅ Message sent with uncommitted BubbleSort.java (response ID: ${result.response.id})`, LogCategory.TEST);
    });

    test('should send message with NEW QuickSort.java file', async function () {
        const uncommittedFiles = new Map<string, string>();
        uncommittedFiles.set(
            TEST_FILES.newQuickSort.path,
            TEST_FILES.newQuickSort.content
        );

        const result = await client.sendMessageWithUncommittedFiles(
            sessionId,
            'Ich habe eine neue QuickSort Klasse erstellt. Kannst du dir diese anschauen?',
            uncommittedFiles
        );

        assert.strictEqual(result.success, true, `Message should be sent successfully. Error: ${result.error}`);
        assert.ok(result.response, 'Response should not be null');

        logger.info(`✅ Message sent with NEW QuickSort.java (response ID: ${result.response.id})`, LogCategory.TEST);
    });

    test('should send message with multiple uncommitted files', async function () {
        const uncommittedFiles = new Map<string, string>();
        uncommittedFiles.set(
            TEST_FILES.buggyBubbleSort.path,
            TEST_FILES.buggyBubbleSort.content
        );
        uncommittedFiles.set(
            TEST_FILES.newQuickSort.path,
            TEST_FILES.newQuickSort.content
        );

        const result = await client.sendMessageWithUncommittedFiles(
            sessionId,
            'Ich habe BubbleSort geändert und eine neue QuickSort Klasse erstellt. Kannst du beide anschauen?',
            uncommittedFiles
        );

        assert.strictEqual(result.success, true, `Message should be sent successfully. Error: ${result.error}`);

        logger.info(`✅ Message sent with 2 uncommitted files`, LogCategory.TEST);
    });

    test('should send message without uncommitted files (backward compatibility)', async function () {
        const result = await client.sendMessageWithoutUncommittedFiles(
            sessionId,
            'Was ist der Fehler in meinem Code?'
        );

        assert.strictEqual(result.success, true, `Message should be sent successfully. Error: ${result.error}`);

        logger.info(`✅ Message sent without uncommitted files (backward compatible)`, LogCategory.TEST);
    });

    test('should handle empty uncommitted files map', async function () {
        const uncommittedFiles = new Map<string, string>();

        const result = await client.sendMessageWithUncommittedFiles(
            sessionId,
            'Kannst du mir helfen?',
            uncommittedFiles
        );

        assert.strictEqual(result.success, true, `Message should be sent successfully. Error: ${result.error}`);

        logger.info(`✅ Message sent with empty uncommitted files map`, LogCategory.TEST);
    });

    suiteTeardown(function () {
        logger.info('\n========================================', LogCategory.TEST);
        logger.info('E2E Tests Complete', LogCategory.TEST);
        logger.info('========================================\n', LogCategory.TEST);
    });
});
