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

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
    artemisUrl: process.env.ARTEMIS_URL || 'http://localhost:8080',
    username: process.env.ARTEMIS_USER || 'artemis_admin',
    password: process.env.ARTEMIS_PASSWORD || 'artemis_admin',
    exerciseId: parseInt(process.env.EXERCISE_ID || '1'),
    timeout: 30000, // 30 seconds for Iris response
};

// =============================================================================
// TEST DATA
// =============================================================================

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

// =============================================================================
// ARTEMIS API CLIENT (Direct HTTP, no mocking)
// =============================================================================

class ArtemisTestClient {
    private baseUrl: string;
    private cookies: string[] = [];

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    async login(username: string, password: string): Promise<boolean> {
        console.log(`[E2E] Logging in as ${username}...`);

        const response = await fetch(`${this.baseUrl}/api/core/public/authenticate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username,
                password,
                rememberMe: true,
            }),
        });

        if (response.ok) {
            // Extract cookies from Set-Cookie header
            const setCookieHeader = response.headers.get('set-cookie');
            if (setCookieHeader) {
                this.cookies = setCookieHeader.split(',').map(c => c.split(';')[0].trim());
            }
            console.log('[E2E] Login successful!');
            return true;
        } else {
            console.error(`[E2E] Login failed: ${response.status}`);
            return false;
        }
    }

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (this.cookies.length > 0) {
            headers['Cookie'] = this.cookies.join('; ');
        }
        return headers;
    }

    async getOrCreateSession(exerciseId: number): Promise<number | null> {
        console.log(`[E2E] Getting/creating Iris session for exercise ${exerciseId}...`);

        // Try to get current session
        let response = await fetch(
            `${this.baseUrl}/api/iris/programming-exercise-chat/${exerciseId}/sessions/current`,
            { headers: this.getHeaders() }
        );

        if (response.ok) {
            const data = await response.json() as { id: number };
            console.log(`[E2E] Found existing session: ${data.id}`);
            return data.id;
        }

        // Create new session
        response = await fetch(
            `${this.baseUrl}/api/iris/programming-exercise-chat/${exerciseId}/sessions`,
            {
                method: 'POST',
                headers: this.getHeaders(),
            }
        );

        if (response.ok) {
            const data = await response.json() as { id: number };
            console.log(`[E2E] Created new session: ${data.id}`);
            return data.id;
        }

        console.error(`[E2E] Failed to create session: ${response.status}`);
        return null;
    }

    async sendMessageWithUncommittedFiles(
        sessionId: number,
        message: string,
        uncommittedFiles: Map<string, string>
    ): Promise<{ success: boolean; response?: any; error?: string }> {
        console.log(`[E2E] Sending message to session ${sessionId}...`);
        console.log(`[E2E]   Message: ${message.substring(0, 50)}...`);
        console.log(`[E2E]   Uncommitted files: ${Array.from(uncommittedFiles.keys()).join(', ')}`);

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
            console.log('[E2E] Message sent successfully!');
            return { success: true, response: data };
        } else {
            const errorText = await response.text();
            console.error(`[E2E] Failed to send message: ${response.status} - ${errorText}`);
            return { success: false, error: errorText };
        }
    }

    async sendMessageWithoutUncommittedFiles(
        sessionId: number,
        message: string
    ): Promise<{ success: boolean; response?: any; error?: string }> {
        console.log(`[E2E] Sending message WITHOUT uncommitted files to session ${sessionId}...`);

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

// =============================================================================
// TEST SUITE
// =============================================================================

suite('E2E: Uncommitted Changes Flow', function () {
    // Increase timeout for E2E tests
    this.timeout(CONFIG.timeout);

    let client: ArtemisTestClient;
    let sessionId: number;

    suiteSetup(async function () {
        console.log('\n========================================');
        console.log('E2E Test: Uncommitted Changes Flow');
        console.log('========================================\n');

        console.log('Configuration:');
        console.log(`  Artemis URL: ${CONFIG.artemisUrl}`);
        console.log(`  Username: ${CONFIG.username}`);
        console.log(`  Exercise ID: ${CONFIG.exerciseId}`);
        console.log('');

        // Check if Artemis is running
        try {
            const healthCheck = await fetch(CONFIG.artemisUrl);
            if (!healthCheck.ok) {
                throw new Error(`Artemis returned ${healthCheck.status}`);
            }
        } catch (error) {
            console.error('❌ Artemis is not running!');
            console.error('   Please start Artemis on localhost:8080 before running E2E tests.');
            this.skip();
            return;
        }

        console.log('✅ Artemis is running\n');

        // Login
        client = new ArtemisTestClient(CONFIG.artemisUrl);
        const loggedIn = await client.login(CONFIG.username, CONFIG.password);
        if (!loggedIn) {
            console.error('❌ Login failed!');
            this.skip();
            return;
        }

        // Get or create session
        const session = await client.getOrCreateSession(CONFIG.exerciseId);
        if (!session) {
            console.error('❌ Could not create Iris session!');
            this.skip();
            return;
        }
        sessionId = session;

        console.log('\n✅ Setup complete\n');
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

        console.log(`✅ Message sent with uncommitted BubbleSort.java (response ID: ${result.response.id})`);
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

        console.log(`✅ Message sent with NEW QuickSort.java (response ID: ${result.response.id})`);
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

        console.log(`✅ Message sent with 2 uncommitted files`);
    });

    test('should send message without uncommitted files (backward compatibility)', async function () {
        const result = await client.sendMessageWithoutUncommittedFiles(
            sessionId,
            'Was ist der Fehler in meinem Code?'
        );

        assert.strictEqual(result.success, true, `Message should be sent successfully. Error: ${result.error}`);

        console.log(`✅ Message sent without uncommitted files (backward compatible)`);
    });

    test('should handle empty uncommitted files map', async function () {
        const uncommittedFiles = new Map<string, string>();

        const result = await client.sendMessageWithUncommittedFiles(
            sessionId,
            'Kannst du mir helfen?',
            uncommittedFiles
        );

        assert.strictEqual(result.success, true, `Message should be sent successfully. Error: ${result.error}`);

        console.log(`✅ Message sent with empty uncommitted files map`);
    });

    suiteTeardown(function () {
        console.log('\n========================================');
        console.log('E2E Tests Complete');
        console.log('========================================\n');
    });
});
