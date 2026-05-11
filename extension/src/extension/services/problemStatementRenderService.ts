import * as vscode from 'vscode';
import type { ArtemisApiService } from '../api/artemisApi';
import type { ProblemStatementRenderRequest, TestFeedbackInput, ResultSummaryInput } from '../domain/problemStatementRendering';
import { VSCODE_CONFIG, CONFIG } from '../utils/constants';
import { logger, LogCategory } from './loggingService';

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
    readonly maxPoints?: number;
    readonly bonusPoints?: number;
}

/** Minimal participation shape (has submissions with results) */
interface ParticipationLike {
    readonly submissions?: ReadonlyArray<{
        readonly id?: number;
        readonly commitHash?: string;
        readonly submissionDate?: string;
        readonly results?: ReadonlyArray<{
            readonly id?: number;
            readonly completionDate?: string;
            readonly score?: number;
            readonly assessmentType?: string;
        }>;
    }>;
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
    async render(
        exercise: ExerciseLike,
        participation?: ParticipationLike,
        feedbacks?: FeedbackLike[],
        darkModeOverride?: boolean,
    ): Promise<ServerRenderResult | undefined> {
        const markdown = exercise.problemStatement || '';
        const exerciseId = exercise.id;
        if (!markdown || exerciseId === undefined) { return undefined; }

        // Server feature flag: disabled after 404/405/501 until config change
        if (this.serverSupportsRendering === false) { return undefined; }

        const darkMode = darkModeOverride ?? isDarkMode();
        const locale = 'en';
        const testInputs = feedbacks ? mapFeedbacksToTestInputs(feedbacks) : undefined;
        const resultSummary = participation ? buildResultSummary(participation, exercise) : undefined;

        const request: ProblemStatementRenderRequest = {
            markdown,
            testResults: testInputs,
            resultSummary,
            locale,
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

function mapFeedbacksToTestInputs(feedbacks: FeedbackLike[]): TestFeedbackInput[] {
    return feedbacks
        .filter(f => f.testCase?.id !== undefined && f.testCase?.id !== null)
        .map(f => ({
            testId: f.testCase!.id!,
            testName: f.testCase?.testName || f.text || 'Unknown',
            passed: f.positive === true,
            message: f.detailText || undefined,
            credits: f.credits ?? undefined,
        }));
}

function buildResultSummary(
    participation: ParticipationLike,
    exercise: ExerciseLike,
): ResultSummaryInput | undefined {
    const submissions = participation.submissions;
    if (!submissions || submissions.length === 0) { return undefined; }

    const latestSubmission = submissions.reduce((latest, current) => {
        const latestId = typeof latest.id === 'number' ? latest.id : -Infinity;
        const currentId = typeof current.id === 'number' ? current.id : -Infinity;
        return currentId > latestId ? current : latest;
    });

    const results = latestSubmission.results;
    if (!results || results.length === 0) { return undefined; }

    const latestResult = results.reduce((latest, current) => {
        const latestDate = latest.completionDate ? new Date(latest.completionDate).getTime() : -Infinity;
        const currentDate = current.completionDate ? new Date(current.completionDate).getTime() : -Infinity;
        if (latestDate === currentDate) {
            return (current.id ?? 0) > (latest.id ?? 0) ? current : latest;
        }
        return currentDate > latestDate ? current : latest;
    });

    return {
        score: latestResult.score,
        maxPoints: exercise.maxPoints,
        bonusPoints: exercise.bonusPoints,
        commitHash: latestSubmission.commitHash,
        submissionDate: latestSubmission.submissionDate,
        assessmentType: latestResult.assessmentType,
    };
}

// ── Utility functions ──

function isDarkMode(): boolean {
    const kind = vscode.window.activeColorTheme.kind;
    return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
}


function computeInputHash(request: ProblemStatementRenderRequest, serverUrl: string): string {
    const input = JSON.stringify({
        markdown: request.markdown,
        testResults: request.testResults || [],
        resultSummary: request.resultSummary,
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
