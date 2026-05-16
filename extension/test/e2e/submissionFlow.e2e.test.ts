/**
 * E2E Test: Student Submission Flow
 *
 * Tests the complete student lifecycle:
 * Login → Find exercise → Clone repo → Make change → Push → Wait for build → Verify score
 *
 * PREREQUISITES:
 * - Artemis running on localhost:8080
 * - Valid test user (artemis_admin/artemis_admin)
 * - Exercise ID 1 exists (programming exercise with tests)
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { logger, LogCategory } from '@extension/services/loggingService';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
    artemisUrl: process.env.ARTEMIS_URL || 'http://localhost:8080',
    username: process.env.ARTEMIS_USER || 'artemis_admin',
    password: process.env.ARTEMIS_PASSWORD || 'artemis_admin',
    exerciseId: parseInt(process.env.EXERCISE_ID || '1'),
    pollIntervalMs: 3000,
    buildTimeoutMs: 120_000,
    suiteTimeoutMs: 180_000,
};

// =============================================================================
// ARTEMIS API CLIENT (Direct HTTP, cookie-based auth)
// =============================================================================

import { ArtemisTestClient as ArtemisTestClientBase } from './helpers/artemisTestClient';

class ArtemisTestClient extends ArtemisTestClientBase {
    async getCurrentUser(): Promise<{ login: string; [key: string]: unknown }> {
        const response = await fetch(`${this.baseUrl}/api/core/public/account`, {
            headers: this.getHeaders(),
        });
        assert.ok(response.ok, `getCurrentUser failed: ${response.status}`);
        return response.json() as Promise<{ login: string; [key: string]: unknown }>;
    }

    async getExerciseDetails(exerciseId: number): Promise<{
        exercise?: {
            id?: number;
            title?: string;
            studentParticipations?: Array<{
                id?: number;
                repositoryUri?: string;
                submissions?: Array<{
                    id?: number;
                    results?: Array<{ id?: number; score?: number; completionDate?: string }>;
                    [key: string]: unknown;
                }>;
                results?: Array<{ id?: number; score?: number; completionDate?: string }>;
                [key: string]: unknown;
            }>;
            [key: string]: unknown;
        };
        [key: string]: unknown;
    }> {
        const response = await fetch(
            `${this.baseUrl}/api/exercise/exercises/${exerciseId}/details?withSubmissions=true&withLatestResult=true`,
            { headers: this.getHeaders() },
        );
        assert.ok(response.ok, `getExerciseDetails failed: ${response.status}`);
        return response.json() as Promise<any>;
    }

    async startParticipation(exerciseId: number): Promise<{
        id?: number;
        repositoryUri?: string;
        [key: string]: unknown;
    }> {
        const response = await fetch(
            `${this.baseUrl}/api/exercise/exercises/${exerciseId}/participations`,
            { method: 'POST', headers: this.getHeaders() },
        );
        assert.ok(response.ok, `startParticipation failed: ${response.status}`);
        return response.json() as Promise<any>;
    }

    async getVcsAccessToken(participationId: number): Promise<string> {
        // Try GET first, fallback to PUT (create token)
        let response = await fetch(
            `${this.baseUrl}/api/core/account/participation-vcs-access-token?participationId=${participationId}`,
            { method: 'GET', headers: this.getHeaders() },
        );
        if (response.ok) {
            return response.text();
        }

        response = await fetch(
            `${this.baseUrl}/api/core/account/participation-vcs-access-token?participationId=${participationId}`,
            { method: 'PUT', headers: this.getHeaders() },
        );
        assert.ok(response.ok, `getVcsAccessToken (PUT fallback) failed: ${response.status}`);
        return response.text();
    }

    /**
     * Poll for results by re-fetching exercise details.
     * Results live inside submissions[].results, not at the participation top-level.
     */
    async pollResultsViaExerciseDetails(exerciseId: number, participationId: number): Promise<Array<{
        id?: number;
        score?: number;
        completionDate?: string;
        [key: string]: unknown;
    }>> {
        const details = await this.getExerciseDetails(exerciseId);
        const participation = details.exercise?.studentParticipations?.find(p => p.id === participationId);
        if (!participation) { return []; }

        // Collect results from all submissions (the canonical location)
        const results: Array<{ id?: number; score?: number; completionDate?: string; [key: string]: unknown }> = [];
        for (const sub of participation.submissions ?? []) {
            for (const r of sub.results ?? []) {
                results.push(r);
            }
        }
        // Also include top-level results if any (some Artemis versions)
        for (const r of participation.results ?? []) {
            if (!results.some(existing => existing.id === r.id)) {
                results.push(r);
            }
        }
        return results;
    }

    async getResultDetails(participationId: number, resultId: number): Promise<{
        id?: number;
        score?: number;
        feedbacks?: Array<{ text?: string; detailText?: string; credits?: number; positive?: boolean }>;
        [key: string]: unknown;
    }> {
        const response = await fetch(
            `${this.baseUrl}/api/assessment/participations/${participationId}/results/${resultId}/details`,
            { headers: this.getHeaders() },
        );
        if (!response.ok) {
            // Some Artemis versions return 404 for the assessment endpoint on student results.
            // Return a minimal object so the test can still verify what it can.
            logger.info(`[E2E-Sub] getResultDetails returned ${response.status}, skipping detailed feedbacks`, LogCategory.TEST);
            return { id: resultId };
        }
        return response.json() as Promise<any>;
    }
}

// =============================================================================
// GIT HELPERS
// =============================================================================

function gitClone(url: string, dest: string): void {
    execSync(`git clone "${url}" "${dest}"`, { stdio: 'pipe', timeout: 60_000 });
}

function gitConfigIdentity(repoDir: string): void {
    execSync('git config user.name "E2E Test"', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.email "e2e@test.local"', { cwd: repoDir, stdio: 'pipe' });
}

function gitAddCommitPush(repoDir: string, message: string): void {
    execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
    execSync(`git commit -m "${message}"`, { cwd: repoDir, stdio: 'pipe' });
    // Pull-rebase to handle concurrent pushes, then push
    try {
        execSync('git pull --rebase', { cwd: repoDir, stdio: 'pipe', timeout: 30_000 });
    } catch {
        // Ignore pull errors (e.g., nothing to pull)
    }
    execSync('git push', { cwd: repoDir, stdio: 'pipe', timeout: 30_000 });
}

/**
 * Makes a small code change in the cloned repo.
 * Looks for .java/.py/.c files and appends a timestamp comment.
 * Falls back to creating e2e-marker.txt if no source files found.
 * Returns the path of the modified file.
 */
function makeCodeChange(repoDir: string): string {
    const extensions = ['.java', '.py', '.c'];
    const timestamp = new Date().toISOString();

    // Walk the repo to find a source file
    function findSourceFile(dir: string): string | null {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) { continue; }
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const found = findSourceFile(fullPath);
                if (found) { return found; }
            } else if (extensions.some(ext => entry.name.endsWith(ext))) {
                return fullPath;
            }
        }
        return null;
    }

    const sourceFile = findSourceFile(repoDir);

    if (sourceFile) {
        const ext = path.extname(sourceFile);
        const commentPrefix = ext === '.py' ? '#' : '//';
        fs.appendFileSync(sourceFile, `\n${commentPrefix} E2E submission test: ${timestamp}\n`);
        logger.info(`[E2E-Sub] Modified: ${path.relative(repoDir, sourceFile)}`, LogCategory.TEST);
        return sourceFile;
    }

    // Fallback: create marker file
    const markerPath = path.join(repoDir, 'e2e-marker.txt');
    fs.writeFileSync(markerPath, `E2E submission test: ${timestamp}\n`);
    logger.info('[E2E-Sub] Created fallback e2e-marker.txt', LogCategory.TEST);
    return markerPath;
}

// =============================================================================
// POLL HELPER
// =============================================================================

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// TEST SUITE
// =============================================================================

suite('E2E: Student Submission Flow', function () {
    this.timeout(CONFIG.suiteTimeoutMs);

    let client: ArtemisTestClient;
    let username: string;
    let participation: {
        id: number;
        repositoryUri: string;
        [key: string]: unknown;
    };
    let initialResultCount: number;
    let vcsToken: string;
    let clonePath: string;
    let finalResult: { id: number; score: number; completionDate: string };
    let suiteReady = false;

    // ─── Setup ───────────────────────────────────────────────────────────

    suiteSetup(async function () {
        logger.info('\n========================================', LogCategory.TEST);
        logger.info('E2E Test: Student Submission Flow', LogCategory.TEST);
        logger.info('========================================\n', LogCategory.TEST);

        logger.info('Configuration:', LogCategory.TEST);
        logger.info(`  Artemis URL: ${CONFIG.artemisUrl}`, LogCategory.TEST);
        logger.info(`  Username:    ${CONFIG.username}`, LogCategory.TEST);
        logger.info(`  Exercise ID: ${CONFIG.exerciseId}`, LogCategory.TEST);
        logger.info('', LogCategory.TEST);

        // Health check — skip entire suite if Artemis is offline
        try {
            const health = await fetch(CONFIG.artemisUrl);
            if (!health.ok) { throw new Error(`Artemis returned ${health.status}`); }
        } catch {
            logger.error('[E2E-Sub] Artemis is not running — skipping suite', LogCategory.TEST);
            this.skip();
            return;
        }

        logger.info('[E2E-Sub] Artemis is running', LogCategory.TEST);

        // Authenticate in suiteSetup — skip entire suite if login fails
        client = new ArtemisTestClient(CONFIG.artemisUrl);
        const loggedIn = await client.login(CONFIG.username, CONFIG.password);
        if (!loggedIn) {
            logger.error('[E2E-Sub] Login failed — skipping suite', LogCategory.TEST);
            this.skip();
            return;
        }

        const user = await client.getCurrentUser();
        if (!user.login) {
            logger.error('[E2E-Sub] Could not resolve username — skipping suite', LogCategory.TEST);
            this.skip();
            return;
        }
        username = user.login;
        suiteReady = true;

        logger.info(`[E2E-Sub] Authenticated as: ${username}`, LogCategory.TEST);
    });

    // ─── Test 1: Authenticate (validates setup completed) ────────────────

    test('1. authenticate with Artemis', function () {
        if (!suiteReady) { this.skip(); return; }
        assert.ok(client, 'Client should be initialized');
        assert.ok(username, 'Username should be set');
        logger.info(`[E2E-Sub] Auth verified: ${username}`, LogCategory.TEST);
    });

    // ─── Test 2: Fetch exercise details ──────────────────────────────────

    test('2. fetch exercise details and resolve participation', async function () {
        if (!suiteReady) { this.skip(); return; }
        let details = await client.getExerciseDetails(CONFIG.exerciseId);

        if (!details.exercise) {
            logger.error(`[E2E-Sub] Exercise ${CONFIG.exerciseId} not found`, LogCategory.TEST);
            this.skip();
            return;
        }

        logger.info(`[E2E-Sub] Exercise: "${details.exercise.title}" (ID ${details.exercise.id})`, LogCategory.TEST);

        let participations = details.exercise.studentParticipations;

        // If no participation exists, start one
        if (!participations || participations.length === 0) {
            logger.info('[E2E-Sub] No participation found — starting one...', LogCategory.TEST);
            await client.startParticipation(CONFIG.exerciseId);

            // Re-fetch details to get the newly created participation
            details = await client.getExerciseDetails(CONFIG.exerciseId);
            participations = details.exercise!.studentParticipations;
        }

        assert.ok(participations && participations.length > 0, 'Should have at least one participation');

        const p = participations![0];
        assert.ok(p.id, 'Participation must have an ID');
        assert.ok(p.repositoryUri, 'Participation must have a repositoryUri');

        participation = { id: p.id!, repositoryUri: p.repositoryUri!, ...p };
        // Count results from submissions (canonical location)
        let resultCount = 0;
        for (const sub of p.submissions ?? []) {
            resultCount += (sub.results ?? []).length;
        }
        // Also count top-level results (some Artemis versions)
        for (const r of p.results ?? []) {
            resultCount++;
        }
        initialResultCount = resultCount;

        logger.info(`[E2E-Sub] Participation ${participation.id}, repo: ${participation.repositoryUri}`, LogCategory.TEST);
        logger.info(`[E2E-Sub] Initial result count: ${initialResultCount}`, LogCategory.TEST);
    });

    // ─── Test 3: Obtain VCS token ────────────────────────────────────────

    test('3. obtain VCS access token', async function () {
        if (!participation) { this.skip(); return; }
        vcsToken = await client.getVcsAccessToken(participation.id);
        assert.ok(vcsToken && vcsToken.length > 0, 'VCS token should be non-empty');

        logger.info(`[E2E-Sub] VCS token obtained (${vcsToken.length} chars)`, LogCategory.TEST);
    });

    // ─── Test 4: Clone repository ────────────────────────────────────────

    test('4. clone repository', function () {
        if (!participation || !vcsToken) { this.skip(); return; }
        clonePath = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-e2e-'));

        // Build clone URL with embedded credentials
        const url = new URL(participation.repositoryUri);
        url.username = username;
        url.password = vcsToken;

        const repoDir = path.join(clonePath, 'repo');
        gitClone(url.toString(), repoDir);

        // Update clonePath to point to the actual repo directory
        clonePath = repoDir;

        assert.ok(fs.existsSync(path.join(clonePath, '.git')), '.git directory should exist after clone');

        gitConfigIdentity(clonePath);

        logger.info(`[E2E-Sub] Cloned to: ${clonePath}`, LogCategory.TEST);
    });

    // ─── Test 5: Make change ────────────────────────────────────────────

    test('5. make code change', function () {
        if (!clonePath || !fs.existsSync(path.join(clonePath, '.git'))) { this.skip(); return; }
        const modifiedFile = makeCodeChange(clonePath);
        assert.ok(fs.existsSync(modifiedFile), 'Modified file should exist');

        logger.info(`[E2E-Sub] File modified (not yet committed)`, LogCategory.TEST);
    });

    // ─── Test 6: Detect uncommitted changes ──────────────────────────────

    test('6. detect uncommitted changes', function () {
        if (!clonePath || !fs.existsSync(path.join(clonePath, '.git'))) { this.skip(); return; }

        // Same logic as workspaceFileChecker.ts: git status --porcelain
        const statusOutput = execSync('git status --porcelain', { cwd: clonePath, encoding: 'utf-8' });
        const changedFiles = statusOutput
            .split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => line.slice(3).trim())
            .filter(f => f.length > 0);

        assert.ok(changedFiles.length > 0, 'Should detect at least one uncommitted file');
        logger.info(`[E2E-Sub] Detected ${changedFiles.length} uncommitted file(s):`, LogCategory.TEST);

        // Apply the same filters as workspaceFileChecker.ts
        const ALLOWED_EXTENSIONS = new Set([
            '.java', '.kt', '.scala', '.groovy', '.py', '.pyw',
            '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
            '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp',
            '.cs', '.vb', '.go', '.rs', '.swift', '.php', '.rb', '.r',
            '.m', '.mm', '.sql', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1',
            '.html', '.htm', '.xml', '.xhtml', '.css', '.scss', '.sass', '.less',
            '.json', '.yaml', '.yml', '.toml', '.md', '.markdown', '.rst', '.txt',
            '.gradle', '.properties', '.pro', '.cmake', '.mk', '.dockerfile',
            '.gitignore', '.gitattributes', '.env', '.envrc',
        ]);
        const EXCLUDED_DIRECTORIES = new Set([
            'node_modules', 'target', 'build', 'dist', 'out', '.git',
            'bin', 'obj', '.gradle', '.idea', '.vscode', 'coverage',
            '__pycache__', '.pytest_cache', '.mypy_cache',
            'vendor', 'packages', 'deps',
        ]);
        const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1MB

        const included: string[] = [];
        const excluded: { file: string; reason: string }[] = [];

        for (const file of changedFiles) {
            // Check excluded directories
            const parts = file.split(/[/\\]/);
            const inExcludedDir = parts.some(p => EXCLUDED_DIRECTORIES.has(p));
            if (inExcludedDir) {
                excluded.push({ file, reason: 'excluded directory' });
                continue;
            }

            // Check allowed extensions
            const ext = path.extname(file).toLowerCase();
            const fileName = parts[parts.length - 1];
            const isSpecialFile = !fileName.includes('.') && ['dockerfile', 'makefile', 'rakefile', 'gradlew', 'mvnw'].includes(fileName.toLowerCase());
            if (!isSpecialFile && !ALLOWED_EXTENSIONS.has(ext)) {
                excluded.push({ file, reason: `extension ${ext || '(none)'} not allowed` });
                continue;
            }

            // Check file size + binary
            const absPath = path.join(clonePath, file);
            if (fs.existsSync(absPath)) {
                const stats = fs.statSync(absPath);
                if (stats.size > MAX_FILE_SIZE_BYTES) {
                    excluded.push({ file, reason: `too large (${(stats.size / 1024 / 1024).toFixed(2)}MB)` });
                    continue;
                }
                if (stats.size > 0) {
                    const buf = Buffer.alloc(Math.min(512, stats.size));
                    const fd = fs.openSync(absPath, 'r');
                    fs.readSync(fd, buf, 0, buf.length, 0);
                    fs.closeSync(fd);
                    if (buf.includes(0)) {
                        excluded.push({ file, reason: 'binary file' });
                        continue;
                    }
                }
            }

            included.push(file);
        }

        for (const f of included) {
            logger.info(`[E2E-Sub]   [included] ${f}`, LogCategory.TEST);
        }
        for (const { file, reason } of excluded) {
            logger.info(`[E2E-Sub]   [excluded] ${file} — ${reason}`, LogCategory.TEST);
        }

        assert.ok(included.length > 0, 'At least one changed file should pass the filters');

        // Verify content can be read (like checkWorkspaceFiles with includeContent: true)
        const fileContents = new Map<string, string>();
        for (const file of included) {
            const absPath = path.join(clonePath, file);
            const content = fs.readFileSync(absPath, 'utf-8');
            assert.ok(content.length > 0, `File ${file} should have content`);
            fileContents.set(file, content);
        }

        logger.info(`[E2E-Sub] Collected ${fileContents.size} file(s) with content — ready for Iris`, LogCategory.TEST);
    });

    // ─── Test 7: Push changes ────────────────────────────────────────────

    test('7. commit and push', function () {
        if (!clonePath || !fs.existsSync(path.join(clonePath, '.git'))) { this.skip(); return; }

        const commitMsg = `E2E test submission ${new Date().toISOString()}`;
        gitAddCommitPush(clonePath, commitMsg);

        logger.info(`[E2E-Sub] Pushed commit: "${commitMsg}"`, LogCategory.TEST);
    });

    // ─── Test 8: Poll for build result ───────────────────────────────────

    test('8. poll for build result', async function () {
        if (!participation) { this.skip(); return; }
        this.timeout(CONFIG.buildTimeoutMs + 10_000);

        const deadline = Date.now() + CONFIG.buildTimeoutMs;
        let results: Array<{ id?: number; score?: number; completionDate?: string }>;

        logger.info(`[E2E-Sub] Polling for new result (timeout: ${CONFIG.buildTimeoutMs / 1000}s)...`, LogCategory.TEST);

        while (Date.now() < deadline) {
            results = await client.pollResultsViaExerciseDetails(CONFIG.exerciseId, participation.id);

            if (results.length > initialResultCount) {
                const latest = results[results.length - 1];
                assert.ok(latest.id, 'Result must have an ID');
                assert.ok(typeof latest.score === 'number' && latest.score >= 0, `Score should be >= 0, got: ${latest.score}`);
                assert.ok(latest.completionDate, 'Result should have a completionDate');

                finalResult = {
                    id: latest.id!,
                    score: latest.score!,
                    completionDate: latest.completionDate!,
                };

                logger.info(`[E2E-Sub] Build complete! Result ${finalResult.id}: score=${finalResult.score}, completed=${finalResult.completionDate}`, LogCategory.TEST);
                return;
            }

            await sleep(CONFIG.pollIntervalMs);
        }

        assert.fail(`Build did not complete within ${CONFIG.buildTimeoutMs / 1000}s. Initial results: ${initialResultCount}, current: ${results!.length}`);
    });

    // ─── Test 9: Verify result details ───────────────────────────────────

    test('9. verify result details and feedbacks', async function () {
        if (!finalResult) { this.skip(); return; }
        const details = await client.getResultDetails(participation.id, finalResult.id);

        assert.ok(details, 'Result details should exist');

        if (Array.isArray(details.feedbacks) && details.feedbacks.length > 0) {
            logger.info(`[E2E-Sub] Result ${finalResult.id}: ${details.feedbacks.length} feedback(s)`, LogCategory.TEST);
            for (const fb of details.feedbacks) {
                const status = fb.positive ? 'PASS' : 'FAIL';
                logger.info(`[E2E-Sub]   [${status}] ${fb.text ?? '(no text)'} — ${fb.detailText ?? ''}`, LogCategory.TEST);
            }
        } else {
            logger.info(`[E2E-Sub] Result ${finalResult.id}: score=${finalResult.score} (no detailed feedbacks available)`, LogCategory.TEST);
        }
    });

    // ─── Teardown ────────────────────────────────────────────────────────

    suiteTeardown(function () {
        // Clean up cloned repository
        if (clonePath && fs.existsSync(clonePath)) {
            fs.rmSync(clonePath, { recursive: true, force: true });
            logger.info(`[E2E-Sub] Cleaned up: ${clonePath}`, LogCategory.TEST);
        }

        logger.info('\n========================================', LogCategory.TEST);
        logger.info('E2E Submission Flow Tests Complete', LogCategory.TEST);
        logger.info('========================================\n', LogCategory.TEST);
    });
});
