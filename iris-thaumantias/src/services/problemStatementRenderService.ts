import * as vscode from 'vscode';
import { ArtemisApiService } from '../api/artemisApi';
import { ArtemisFeedback } from '../types/artemis';
import {
    ProblemStatementRenderRequest,
    RenderedProblemStatementDTO,
    TestFeedbackInput,
    ResultSummaryInput,
} from '../types/problemStatementRendering';
import { processMarkdown } from '../views/utils/markdownProcessor';
import { VSCODE_CONFIG, CONFIG } from '../utils/constants';
import { logger, LogCategory } from './loggingService';

// ── Public types ──

export interface RenderResult {
    source: 'server' | 'client';
    html: string;
    interactiveScript?: string;
    contentHash?: string;
    /** Only present for client-side fallback */
    downloadLinks?: Array<{ text: string; url: string }>;
    /** Only present for client-side fallback */
    plantUmlDiagrams?: string[];
}

export interface ExamContext {
    isExamExercise: boolean;
    courseId?: number;
    examId?: number;
}

// ── Cache internals ──

interface CacheEntry {
    exerciseId: number;
    inputHash: string;
    result: RenderResult;
    accessedAt: number;
}

const MAX_CACHE_SIZE = 10;

// ── Service ──

export class ProblemStatementRenderService {
    private readonly api: ArtemisApiService;
    private cache = new Map<number, CacheEntry>();
    private serverSupportsRendering: boolean | null = null;
    private requestCounter = 0;
    private debounceTimers = new Map<number, ReturnType<typeof setTimeout>>();

    constructor(api: ArtemisApiService) {
        this.api = api;

        // Reset feature flag when server URL changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.SERVER_URL_KEY}`)) {
                this.serverSupportsRendering = null;
                this.cache.clear();
            }
        });
    }

    /**
     * Render a problem statement, preferring server-side rendering with client-side fallback.
     * Returns immediately with client-rendered HTML on cache miss, then fires a background
     * server render whose result can be retrieved via the returned promise.
     */
    async render(
        exercise: { id: number; problemStatement?: string },
        participation?: any,
        feedbacks?: ArtemisFeedback[],
        examContext?: ExamContext,
        userLangKey?: string,
    ): Promise<RenderResult> {
        const markdown = exercise.problemStatement || '';

        // Exam mode: always client-side (no extra API calls)
        if (examContext?.isExamExercise) {
            return this.clientSideRender(markdown);
        }

        // Server feature flag: permanently disabled after 404/405/501
        if (this.serverSupportsRendering === false) {
            logger.info('[SSR] Server rendering disabled (previously got 404/405/501)', LogCategory.GENERAL);
            return this.clientSideRender(markdown);
        }

        logger.info(`[SSR] Attempting server render (markdown length: ${markdown.length})`, LogCategory.GENERAL);

        // Build request
        const darkMode = isDarkMode();
        const locale = getLocale(userLangKey);
        const testInputs = feedbacks ? mapFeedbacksToTestInputs(feedbacks) : undefined;
        const resultSummary = participation ? buildResultSummary(participation, exercise as any) : undefined;
        const interactive = !examContext?.isExamExercise && testInputs !== null && testInputs !== undefined && testInputs.length > 0;

        const request: ProblemStatementRenderRequest = {
            markdown,
            testResults: testInputs,
            resultSummary,
            locale,
            darkMode,
            interactive,
        };

        // Cache check
        const serverUrl = this.getServerUrl();
        const inputHash = computeInputHash(request, serverUrl);
        const cached = this.cache.get(exercise.id);
        if (cached && cached.inputHash === inputHash) {
            cached.accessedAt = Date.now();
            return cached.result;
        }

        // Monotonic request token for stale-response discard
        const token = ++this.requestCounter;

        try {
            const dto = await this.api.renderProblemStatement(request);

            // Discard if a newer request was fired while we were waiting
            if (token !== this.requestCounter) {
                logger.debug('Discarding stale server render response', LogCategory.GENERAL);
                return this.clientSideRender(markdown);
            }

            this.serverSupportsRendering = true;

            const result: RenderResult = {
                source: 'server',
                html: rewriteRelativeUrls(dto.html, serverUrl),
                interactiveScript: dto.interactiveScript,
                contentHash: dto.contentHash,
            };

            this.putCache(exercise.id, inputHash, result);
            return result;
        } catch (error: any) {
            const status = error?.status;
            if (status === 404 || status === 405 || status === 501) {
                this.serverSupportsRendering = false;
                logger.info(`Server does not support problem statement rendering (HTTP ${status}), using client-side fallback`, LogCategory.GENERAL);
            } else {
                logger.warn(`Server render failed (${status || 'network error'}), falling back to client-side`, LogCategory.GENERAL);
            }
            return this.clientSideRender(markdown);
        }
    }

    private pendingResolvers = new Map<number, (result: RenderResult) => void>();

    /**
     * Debounced re-render for WebSocket result updates.
     * Returns a promise that resolves when the debounced render completes.
     * Superseded promises are resolved with a client-side fallback to prevent leaks.
     */
    debouncedRender(
        exerciseId: number,
        exercise: { id: number; problemStatement?: string },
        participation?: any,
        feedbacks?: ArtemisFeedback[],
        userLangKey?: string,
    ): Promise<RenderResult> {
        // Resolve any previously pending promise for this exercise to prevent leaks
        const previousResolver = this.pendingResolvers.get(exerciseId);
        if (previousResolver) {
            previousResolver(this.clientSideRender(exercise.problemStatement || ''));
        }

        const existing = this.debounceTimers.get(exerciseId);
        if (existing) {
            clearTimeout(existing);
        }

        return new Promise((resolve) => {
            this.pendingResolvers.set(exerciseId, resolve);
            this.debounceTimers.set(exerciseId, setTimeout(async () => {
                this.debounceTimers.delete(exerciseId);
                this.pendingResolvers.delete(exerciseId);
                const result = await this.render(exercise, participation, feedbacks, undefined, userLangKey);
                resolve(result);
            }, 500));
        });
    }

    /** Invalidate cache for a specific exercise (e.g., on theme change) */
    invalidateExercise(exerciseId: number): void {
        this.cache.delete(exerciseId);
    }

    /** Invalidate all cached renders */
    invalidateAll(): void {
        this.cache.clear();
    }

    /** Whether the server endpoint is known to be available */
    get isServerAvailable(): boolean | null {
        return this.serverSupportsRendering;
    }

    // ── Private helpers ──

    private clientSideRender(markdown: string): RenderResult {
        const { html, downloadLinks, plantUmlDiagrams } = processMarkdown(markdown || 'No description available');
        return {
            source: 'client',
            html,
            downloadLinks,
            plantUmlDiagrams,
        };
    }

    private putCache(exerciseId: number, inputHash: string, result: RenderResult): void {
        // LRU eviction
        if (this.cache.size >= MAX_CACHE_SIZE && !this.cache.has(exerciseId)) {
            let oldestKey: number | undefined;
            let oldestTime = Infinity;
            for (const [key, entry] of this.cache) {
                if (entry.accessedAt < oldestTime) {
                    oldestTime = entry.accessedAt;
                    oldestKey = key;
                }
            }
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
        }
        this.cache.set(exerciseId, { exerciseId, inputHash, result, accessedAt: Date.now() });
    }

    private getServerUrl(): string {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        return config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY) || CONFIG.ARTEMIS_SERVER_URL_DEFAULT;
    }
}

// ── Mapping functions (exported for testing) ──

export function mapFeedbacksToTestInputs(feedbacks: ArtemisFeedback[]): TestFeedbackInput[] {
    return feedbacks
        .filter(f => f.testCase?.id !== null && f.testCase?.id !== undefined)
        .map(f => ({
            testId: f.testCase!.id,
            testName: f.testCase?.testName || f.text || 'Unknown',
            passed: f.positive === true,
            message: f.detailText || undefined,
            credits: f.credits ?? undefined,
        }));
}

export function buildResultSummary(
    participation: any,
    exercise: { maxPoints?: number; bonusPoints?: number },
): ResultSummaryInput | undefined {
    // Use existing participation selection logic
    const submissions = participation?.submissions;
    if (!Array.isArray(submissions) || submissions.length === 0) {return undefined;}

    // Find latest submission by ID (sequential)
    const latestSubmission = submissions.reduce((latest: any, current: any) => {
        const latestId = typeof latest?.id === 'number' ? latest.id : -Infinity;
        const currentId = typeof current?.id === 'number' ? current.id : -Infinity;
        return currentId > latestId ? current : latest;
    });

    // Find latest result from that submission
    const results = latestSubmission?.results;
    if (!Array.isArray(results) || results.length === 0) {return undefined;}

    const latestResult = results.reduce((latest: any, current: any) => {
        const latestDate = latest?.completionDate ? new Date(latest.completionDate).getTime() : -Infinity;
        const currentDate = current?.completionDate ? new Date(current.completionDate).getTime() : -Infinity;
        if (latestDate === currentDate) {
            return (current?.id ?? 0) > (latest?.id ?? 0) ? current : latest;
        }
        return currentDate > latestDate ? current : latest;
    });

    return {
        score: latestResult?.score,
        maxPoints: exercise.maxPoints,
        bonusPoints: exercise.bonusPoints,
        commitHash: latestSubmission?.commitHash,
        submissionDate: latestSubmission?.submissionDate,
        assessmentType: latestResult?.assessmentType,
    };
}

// ── Utility functions ──

function isDarkMode(): boolean {
    const kind = vscode.window.activeColorTheme.kind;
    return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
}

function getLocale(userLangKey?: string): string {
    if (userLangKey) {return userLangKey;}
    return vscode.env.language || 'en';
}

function computeInputHash(request: ProblemStatementRenderRequest, serverUrl: string): string {
    const input = JSON.stringify({
        markdown: request.markdown,
        testResults: request.testResults || [],
        resultSummary: request.resultSummary,
        locale: request.locale,
        darkMode: request.darkMode,
        interactive: request.interactive,
        serverUrl,
    });
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return hash.toString(36);
}

function rewriteRelativeUrls(html: string, serverUrl: string): string {
    // Rewrite relative src attributes (images etc.) to absolute
    return html.replace(/src="\/([^"]+)"/g, `src="${serverUrl}/$1"`);
}
