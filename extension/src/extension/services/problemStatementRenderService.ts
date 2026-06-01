import * as vscode from 'vscode';

import type { ArtemisApiService } from '@extension/api/artemisApi';
import type { ProblemStatementRenderRequest, TestFeedbackInput } from '@extension/domain/problemStatementRendering';
import { CONFIG, VSCODE_CONFIG } from '@extension/utils/constants';
import { extractLatestFeedbacks } from '@extension/utils/participationHelpers';

import { LogCategory, logger } from './loggingService';

/** Minimal feedback shape needed for test input mapping */
interface FeedbackLike {
    readonly testCase?: { id?: number; testName?: string };
    readonly text?: string;
    readonly detailText?: string;
    readonly credits?: number;
    readonly positive?: boolean;
}

/** Minimal exercise shape needed for rendering */
interface ExerciseLike {
    readonly id?: number;
    readonly problemStatement?: string;
}

/** Minimal participation shape (has submissions with results with feedbacks) */
interface ParticipationLike {
    readonly submissions?: ReadonlyArray<{
        readonly id?: number;
        readonly results?: ReadonlyArray<{
            readonly id?: number;
            readonly feedbacks?: unknown[];
        }>;
    }>;
}

interface RenderOptions {
    readonly participation?: ParticipationLike;
    readonly darkModeOverride?: boolean;
}

// ── Internal types ──

interface ServerRenderResult {
    html: string;
    contentHash: string;
}

// ── Cache internals ──

interface CacheEntry {
    exerciseId: number;
    inputHash: string;
    result: ServerRenderResult;
    accessedAt: number;
}

const MAX_CACHE_SIZE = 10;

// Match Artemis ProblemStatementRenderRequestDTO validation on `markdown`:
// @Size(max = 100_000) and a null-byte pattern reject.
const MAX_MARKDOWN_LENGTH = 100_000;

// ── Service ──

export class ProblemStatementRenderService implements vscode.Disposable {
    private readonly api: ArtemisApiService;
    private cache = new Map<number, CacheEntry>();
    private serverSupportsRendering: boolean | null = null;
    private requestCounter = 0;
    private readonly configListener: vscode.Disposable;

    constructor(api: ArtemisApiService) {
        this.api = api;

        this.configListener = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.SERVER_URL_KEY}`)) {
                this.serverSupportsRendering = null;
                this.cache.clear();
            }
        });
    }

    dispose(): void {
        this.configListener.dispose();
    }

    /**
     * Render a problem statement via the server endpoint.
     * Returns undefined when server rendering is unavailable.
     */
    async render(exercise: ExerciseLike, options: RenderOptions = {}): Promise<ServerRenderResult | undefined> {
        const markdown = exercise.problemStatement || '';
        const exerciseId = exercise.id;
        if (!markdown || exerciseId === undefined) { return undefined; }

        // Backend rejects markdown >100k chars or containing null bytes.
        // Short-circuit to avoid a wasted round-trip with no recovery on next attempt.
        if (markdown.length > MAX_MARKDOWN_LENGTH || containsNullByte(markdown)) {
            logger.info(`[SSR] Markdown fails backend validation for exercise ${exerciseId} (length=${markdown.length}), skipping`, LogCategory.GENERAL);
            return undefined;
        }

        // Server feature flag: disabled after 404/405/501 until config change
        if (this.serverSupportsRendering === false) { return undefined; }

        const darkMode = options.darkModeOverride ?? isDarkMode();
        const rawFeedbacks = extractLatestFeedbacks(options.participation);
        const testInputs = rawFeedbacks ? mapFeedbacksToTestInputs(rawFeedbacks as FeedbackLike[]) : undefined;

        const request: ProblemStatementRenderRequest = {
            markdown,
            testResults: testInputs,
            locale: 'en',
            darkMode,
            includeJs: false,
            inlineImages: true,
        };

        // Cache check
        const serverUrl = this.getServerUrl();
        const inputHash = computeInputHash(request, serverUrl);
        const cached = this.cache.get(exerciseId);
        if (cached && cached.inputHash === inputHash) {
            cached.accessedAt = Date.now();
            return cached.result;
        }

        // Monotonic request token for stale-response discard
        const token = ++this.requestCounter;

        try {
            logger.info(`[SSR] Requesting server render for exercise ${exerciseId} (darkMode=${request.darkMode}, locale=${request.locale})`, LogCategory.GENERAL);
            const dto = await this.api.renderProblemStatement(request);

            if (token !== this.requestCounter) {
                logger.info('[SSR] Discarding stale server render response', LogCategory.GENERAL);
                return undefined;
            }

            this.serverSupportsRendering = true;

            const result: ServerRenderResult = {
                html: rewriteRelativeUrls(dto.html, serverUrl),
                contentHash: dto.contentHash,
            };

            this.putCache(exerciseId, inputHash, result);
            logger.info(`[SSR] Server render successful (hash: ${dto.contentHash.slice(0, 8)})`, LogCategory.GENERAL);
            return result;
        } catch (error: unknown) {
            const status = (error as { status?: number })?.status;
            if (status === 404 || status === 405 || status === 501) {
                this.serverSupportsRendering = false;
                logger.info(`[SSR] Server does not support rendering (HTTP ${status}), disabled until config change`, LogCategory.GENERAL);
            } else {
                logger.info(`[SSR] Server render failed (${status || 'network error'}), skipping`, LogCategory.GENERAL);
            }
            return undefined;
        }
    }

    invalidateAll(): void { this.cache.clear(); }

    // ── Private helpers ──

    private putCache(exerciseId: number, inputHash: string, result: ServerRenderResult): void {
        if (this.cache.size >= MAX_CACHE_SIZE && !this.cache.has(exerciseId)) {
            let oldestKey: number | undefined;
            let oldestTime = Infinity;
            for (const [key, entry] of this.cache) {
                if (entry.accessedAt < oldestTime) {
                    oldestTime = entry.accessedAt;
                    oldestKey = key;
                }
            }
            if (oldestKey !== undefined) { this.cache.delete(oldestKey); }
        }
        this.cache.set(exerciseId, { exerciseId, inputHash, result, accessedAt: Date.now() });
    }

    private getServerUrl(): string {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        return config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY) || CONFIG.ARTEMIS_SERVER_URL_DEFAULT;
    }
}

// ── Mapping functions ──

// Match Artemis ProblemStatementRenderRequestDTO + TestFeedbackInputDTO validation:
// testResults @Size(max=100), testName @Size(max=500), message @Size(max=5000),
// duplicate testIds are rejected by the resource layer (422).
const MAX_TEST_RESULTS = 100;
const MAX_TEST_NAME_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 5000;

function mapFeedbacksToTestInputs(feedbacks: FeedbackLike[]): TestFeedbackInput[] {
    const seen = new Set<number>();
    const result: TestFeedbackInput[] = [];
    for (const f of feedbacks) {
        const id = f.testCase?.id;
        if (id === undefined || id === null || seen.has(id)) { continue; }
        seen.add(id);
        const rawName = f.testCase?.testName || f.text || 'Unknown';
        const rawMessage = f.detailText || undefined;
        result.push({
            testId: id,
            testName: rawName.slice(0, MAX_TEST_NAME_LENGTH),
            passed: f.positive === true,
            message: rawMessage ? rawMessage.slice(0, MAX_MESSAGE_LENGTH) : undefined,
            credits: f.credits ?? undefined,
        });
        if (result.length >= MAX_TEST_RESULTS) { break; }
    }
    return result;
}

// ── Utility functions ──

function containsNullByte(s: string): boolean {
    return s.indexOf(String.fromCharCode(0)) !== -1;
}

function isDarkMode(): boolean {
    const kind = vscode.window.activeColorTheme.kind;
    return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
}


function computeInputHash(request: ProblemStatementRenderRequest, serverUrl: string): string {
    const input = JSON.stringify({
        markdown: request.markdown,
        testResults: request.testResults || [],
        locale: request.locale,
        darkMode: request.darkMode,
        includeJs: request.includeJs,
        inlineImages: request.inlineImages,
        serverUrl,
    });
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return hash.toString(36);
}

function rewriteRelativeUrls(html: string, serverUrl: string): string {
    return html.replace(/src="\/([^"]+)"/g, `src="${serverUrl}/$1"`);
}
