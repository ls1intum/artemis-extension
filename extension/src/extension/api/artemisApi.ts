import { LoginOptionsResponse } from '@extension/domain/auth';
import type { ProblemStatementRenderRequest, RenderedProblemStatementDTO } from '@extension/domain/problemStatementRendering';
import { AuthManager } from '@extension/services/auth/authManager';
import { LogCategory, logger } from '@extension/services/loggingService';
import type {
    ArtemisParticipation,
    ArtemisUser,
    AuthenticationResult,
    BuildLogEntry,
    IrisHealthStatus,
    ProfileInfo,
    ProgrammingSubmission,
} from '@extension/types';
import type {
    CourseDashboardCourse,
    CourseDashboardEntry,
    CourseDashboardResponse,
    ExerciseDetailsResponse,
    IrisChatMessage,
    IrisChatMode,
    IrisChatSession,
    IrisChatSessionSummary,
    IrisSettingsResponse,
    ResultSummary,
    ServerContext,
    SessionDetail,
    SessionSummary,
} from '@extension/types';
import {
    ApiError,
    expectArray,
    expectObject,
    MalformedResponseError,
    parseApiObject,
    parseArtemisParticipation,
    parseArtemisUser,
    parseBuildLogEntry,
    parseIrisHealthStatus,
    parseProfileInfo,
    parseProgrammingSubmission,
    PROFILE_IRIS,
} from '@extension/types';
import { CONFIG, getUserAgent, resolveServerUrl } from '@extension/utils';

/**
 * `fetch` with a timeout backstop. The native `fetch` has no default timeout, so a
 * server that accepts the connection but never responds would hang the caller forever.
 * Aborts the request after `timeoutMs` (rejecting with a `TimeoutError`); a caller-
 * supplied `options.signal` is honoured in addition to the timeout.
 */
async function fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs: number = CONFIG.API.REQUEST_TIMEOUT_MS,
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
        timeoutMs,
    );
    const signal = options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal;
    try {
        return await fetch(url, { ...options, signal });
    } finally {
        clearTimeout(timer);
    }
}

export class ArtemisApiService {
    private authManager: AuthManager;
    private _onAuthExpired?: () => void | Promise<void>;
    private _authExpiredFired = false;

    constructor(authManager: AuthManager) {
        this.authManager = authManager;
    }

    /**
     * Set the handler invoked on 401 responses. Called at most once until reset
     * (e.g. by a successful re-authentication).
     */
    public set onAuthExpired(handler: (() => void | Promise<void>) | undefined) {
        this._onAuthExpired = handler;
    }

    /** Reset the one-shot guard so the next 401 fires the callback again. */
    public resetAuthExpiredGuard(): void {
        this._authExpiredFired = false;
    }

    protected getServerUrl(): string {
        return resolveServerUrl();
    }

    private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
        const headers = await this.authManager.getAuthHeaders();
        const url = `${this.getServerUrl()}${endpoint}`;

        const response = await fetchWithTimeout(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': getUserAgent(),
                ...headers,
                ...options.headers,
            },
        });

        if (!response.ok) {
            if (response.status === 401) {
                await this.authManager.clear();
                // Fire callback at most once to prevent duplicate prompts from concurrent 401s.
                // Fire-and-forget so the ApiError throws immediately without blocking on UI.
                if (!this._authExpiredFired && this._onAuthExpired) {
                    this._authExpiredFired = true;
                    void Promise.resolve(this._onAuthExpired()).catch(err => {
                        logger.error('Error in onAuthExpired handler', LogCategory.AUTH, err);
                    });
                }
                throw new ApiError('Authentication failed. Please log in again.', 401);
            }

            let errorMessage = `API request failed: ${response.status}`;
            let errorDetail: string | undefined;
            let errorKey: string | undefined;
            try {
                const errorBody = await response.text();
                if (errorBody) {
                    try {
                        const parsed: unknown = JSON.parse(errorBody);
                        // Artemis uses different fields for error messages
                        if (parsed && typeof parsed === 'object') {
                            const errorObj = parsed as { message?: string; detail?: string; title?: string; error?: string; errorKey?: string };
                            errorDetail = errorObj.message || errorObj.detail || errorObj.title || errorObj.error;
                            // Kept separately: `errorDetail` above is a fallback chain over
                            // human-facing fields, so it is not safe to branch on.
                            errorKey = typeof errorObj.errorKey === 'string' ? errorObj.errorKey : undefined;
                        }
                    } catch {
                        // Response is not JSON, use raw text if meaningful
                        if (errorBody.length < 200 && !errorBody.includes('<')) {
                            errorDetail = errorBody;
                        }
                    }
                }
            } catch {
                // Failed to read response body, continue with generic message
            }

            if (errorDetail) {
                errorMessage = `${errorMessage}: ${errorDetail}`;
            }

            throw new ApiError(errorMessage, response.status, errorDetail, errorKey);
        }

        return response;
    }

    async getCurrentUser(): Promise<ArtemisUser> {
        const response = await this.makeRequest('/api/core/public/account');
        const body = (await response.text()).trim();
        if (!body) {
            // /api/core/public/account is public: an unauthenticated request gets a
            // 200 with an empty body rather than a 401. Surface it as a 401 so callers
            // (notably startup credential validation) clear the stale token instead of
            // treating the empty response as a transient failure and keeping it.
            throw new ApiError('Not authenticated', 401);
        }
        return parseArtemisUser(JSON.parse(body));
    }

    // Get the login option (OIDC or password) for given username
    async getLoginOptions(username: string): Promise<LoginOptionsResponse> {
        const response = await this.makeRequest(`/api/core/public/login-options?usernameOrEmail=${encodeURIComponent(username)}`);
        const body = (await response.text()).trim();
        if (!body) {
            // if request is empty, the problem lies on the server side
            throw new ApiError('Server error', 500);
        }
        return (JSON.parse(body) as unknown) as LoginOptionsResponse;
    }

    /**
     * Redeem a single-use OIDC exchange code for a JWT, proving ownership with the PKCE verifier.
     *
     * Deliberately bypasses `makeRequest()`, exactly like `logoutFromServer()` and for the same reason:
     * `makeRequest` throws on any non-2xx, which would make the status mapping below unreachable, and its
     * 401 branch clears the stored credentials and fires the auth-expired callback. A rejected login code
     * must never disturb a session the user already has. The endpoint is public, so no auth header is sent.
     */
    public async exchangeCodeForToken(code: string, codeVerifier: string): Promise<string> {
        const url = `${this.getServerUrl()}/api/core/public/exchange-code`;

        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': getUserAgent(),
            },
            body: JSON.stringify({
                code: code,
                codeVerifier: codeVerifier,
            }),
        });

        if (!response.ok) {
            if (response.status === 404 || response.status === 401) {
                throw new Error('The login code has expired or is invalid. Please try logging in again.');
            }
            throw new Error(`Server returned status ${response.status} during code exchange.`);
        }

        const token = (await response.text()).trim();
        if (!token) {
            throw new Error('The server returned an empty token during code exchange.');
        }
        return token;
    }

    // Get archived courses (inactive courses from previous semesters)
    async getArchivedCourses(): Promise<CourseDashboardCourse[]> {
        const response = await this.makeRequest('/api/core/courses/for-archive');
        return expectArray<CourseDashboardCourse>(
            'archived courses',
            await response.json(),
            (item, i) => expectObject(`archived courses[${i}]`, item) as CourseDashboardCourse,
        );
    }

    // Dashboard data carries exercises, participations and scores.
    async getCoursesForDashboard(): Promise<CourseDashboardResponse> {
        const response = await this.makeRequest('/api/core/courses/for-dashboard');
        return parseApiObject<CourseDashboardResponse>('CourseDashboardResponse', await response.json());
    }

    async getCourseForDashboard(courseId: number): Promise<CourseDashboardEntry> {
        const response = await this.makeRequest(`/api/core/courses/${courseId}/for-dashboard`);
        return parseApiObject<CourseDashboardEntry>('CourseDashboardEntry', await response.json());
    }

    // The backend always includes studentParticipations with submissions and
    // results. The endpoint accepts no query parameters.
    async getExerciseDetails(exerciseId: number): Promise<ExerciseDetailsResponse> {
        const response = await this.makeRequest(
            `/api/exercise/exercises/${exerciseId}/details`
        );
        return parseApiObject<ExerciseDetailsResponse>('ExerciseDetailsResponse', await response.json());
    }

    // A pending submission is one that has NO result yet (build in progress).
    //
    // Artemis returns 200+null body when no submission is pending and 404 when
    // the participation does not exist. Both map to `null`. All other error
    // statuses (401/403/5xx) and malformed JSON propagate so the caller can
    // decide between retry, log-and-continue, or surface-to-user.
    async getLatestPendingSubmission(participationId: number): Promise<ProgrammingSubmission | null> {
        let response: Response;
        try {
            response = await this.makeRequest(
                `/api/programming/programming-exercise-participations/${participationId}/latest-pending-submission`
            );
        } catch (error) {
            if (error instanceof ApiError && error.status === 404) {
                return null;
            }
            throw error;
        }

        const text = await response.text();
        if (!text || text.trim() === '' || text.trim() === 'null') {
            return null;
        }

        try {
            return parseProgrammingSubmission(JSON.parse(text));
        } catch (parseError) {
            const detail = parseError instanceof Error ? parseError.message : String(parseError);
            throw new MalformedResponseError(
                `Malformed pending-submission response for participation ${participationId}: ${detail}`,
                response.status,
                detail,
            );
        }
    }

    // Same endpoint the Artemis webapp uses: it returns a full Result with
    // feedbacks embedded, so the resultId is not needed upfront. The backend
    // returns 200 with a null body when results are hidden.
    async getLatestResultWithFeedbacks(participationId: number): Promise<ResultSummary | null> {
        const response = await this.makeRequest(
            `/api/programming/programming-exercise-participations/${participationId}/latest-result-with-feedbacks?withSubmission=false`
        );
        const text = await response.text();
        if (!text || text.trim() === '' || text.trim() === 'null') {
            return null;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch (parseError) {
            const detail = parseError instanceof Error ? parseError.message : String(parseError);
            throw new MalformedResponseError(
                `Malformed latest-result response for participation ${participationId}: ${detail}`,
                response.status,
                detail,
            );
        }
        return parseApiObject<ResultSummary>(
            `latest-result for participation ${participationId}`,
            parsed,
        );
    }

    async getBuildLogs(participationId: number, resultId?: number): Promise<BuildLogEntry[]> {
        let endpoint = `/api/programming/participations/${participationId}/buildlogs`;
        if (resultId !== undefined) {
            endpoint += `?resultId=${resultId}`;
        }
        const response = await this.makeRequest(endpoint);
        return expectArray('build logs', await response.json(), parseBuildLogEntry);
    }

    async getVcsAccessToken(participationId: number): Promise<string> {
        const response = await this.makeRequest(
            `/api/core/account/participation-vcs-access-token?participationId=${participationId}`,
            { method: 'GET' }
        );
        return response.text();
    }

    async createVcsAccessToken(participationId: number): Promise<string> {
        const response = await this.makeRequest(
            `/api/core/account/participation-vcs-access-token?participationId=${participationId}`,
            { method: 'PUT' }
        );
        return response.text();
    }

    // Falls back to creation only when the server explicitly signals "no token
    // exists yet" (404). Other errors (401/403/5xx, network) propagate so the
    // caller does not retry on top of an already-failed auth state.
    async getOrCreateVcsAccessToken(participationId: number): Promise<string> {
        try {
            return await this.getVcsAccessToken(participationId);
        } catch (err) {
            if (err instanceof ApiError && err.status === 404) {
                return await this.createVcsAccessToken(participationId);
            }
            throw err;
        }
    }

    async startExerciseParticipation(exerciseId: number): Promise<ArtemisParticipation> {
        const response = await this.makeRequest(
            `/api/exercise/exercises/${exerciseId}/participations`,
            { method: 'POST' }
        );
        return parseArtemisParticipation(await response.json());
    }

    async startPracticeParticipation(exerciseId: number): Promise<ArtemisParticipation> {
        const response = await this.makeRequest(
            `/api/exercise/exercises/${exerciseId}/participations/practice`,
            { method: 'POST' }
        );
        return parseArtemisParticipation(await response.json());
    }

    async authenticate(username: string, password: string, rememberMe: boolean = false): Promise<AuthenticationResult> {
        const url = `${this.getServerUrl()}${CONFIG.API.ENDPOINTS.AUTHENTICATE}`;

        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': getUserAgent()
            },
            body: JSON.stringify({
                username: username,
                password: password,
                rememberMe: rememberMe
            })
        });

        if (!response.ok) {
            const rawError = await response.text();
            let parsedMessage = rawError.trim();

            if (parsedMessage) {
                try {
                    const parsed: unknown = JSON.parse(rawError);
                    if (parsed && typeof parsed === 'object') {
                        const errorObj = parsed as { title?: string; message?: string; detail?: string; error?: string };
                        parsedMessage = errorObj.title || errorObj.message || errorObj.detail || errorObj.error || parsedMessage;
                    }
                } catch (parseError) {
                    // Fall back to plain text error message when JSON parsing fails
                }
            }

            if (response.status === 400 || response.status === 401) {
                if (!parsedMessage || /method argument not valid/i.test(parsedMessage)) {
                    throw new Error('Invalid username or password.');
                }
                throw new Error(parsedMessage);
            } else if (response.status === 403) {
                throw new Error(parsedMessage || 'Account is not activated or access is forbidden.');
            } else {
                const statusText = response.statusText || 'Unexpected error';
                const detail = parsedMessage && parsedMessage !== statusText ? ` - ${parsedMessage}` : '';
                throw new Error(`${response.status} ${statusText}${detail}`.trim());
            }
        }

        // Extract JWT cookie from Set-Cookie header (Desktop auth uses Cookie header)
        const setCookieHeader = response.headers.get('set-cookie');
        let jwtCookie = '';

        if (setCookieHeader) {
            const jwtMatch = setCookieHeader.match(new RegExp(`${CONFIG.AUTH_COOKIE_NAME}=([^;]+)`));
            if (jwtMatch) {
                jwtCookie = `${CONFIG.AUTH_COOKIE_NAME}=${jwtMatch[1]}`;
            }
        }

        if (!jwtCookie) {
            throw new Error('Authentication succeeded but no JWT token received');
        }

        // Store as cookie string: Desktop auth sends a Cookie header, not Bearer.
        await this.authManager.storeArtemisCredentials(jwtCookie, rememberMe);

        return { success: true };
    }

    /**
     * Inform the Artemis server that the user is logging out.
     *
     * Best-effort: this method never throws. The calling logout flow
     * must always clear local state regardless of the server response,
     * so any failure here is logged and swallowed.
     *
     * Uses a direct fetch instead of `makeRequest()` so a non-2xx response does
     * not trigger the shared 401 handler, which would re-clear auth and fire the
     * auth-expired callback during an intentional logout.
     *
     * Artemis JWTs are strictly stateless: `PublicUserJwtResource.logout()` only
     * sets `Set-Cookie: jwt=; Max-Age=0`, with no blacklist and no server-side
     * invalidation. The extension keeps the JWT in VS Code secrets rather than a
     * cookie jar, so fetch() discards that header. The call exists purely for
     * protocol symmetry with the Artemis webapp.
     */
    async logoutFromServer(): Promise<void> {
        const headers = await this.authManager.getAuthHeaders();
        if (Object.keys(headers).length === 0) {
            // Not authenticated, so there is nothing to tell the server.
            return;
        }

        try {
            const response = await fetchWithTimeout(`${this.getServerUrl()}${CONFIG.API.ENDPOINTS.LOGOUT}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': getUserAgent(),
                    ...headers,
                },
            }, CONFIG.API.LOGOUT_TIMEOUT_MS);
            if (response.ok) {
                logger.info('Server-side logout successful', LogCategory.AUTH);
            } else {
                logger.warn(
                    `Server-side logout returned ${response.status}, continuing with local cleanup`,
                    LogCategory.AUTH
                );
            }
        } catch (err) {
            logger.warn(
                'Server-side logout failed, continuing with local cleanup',
                LogCategory.AUTH,
                err
            );
        }
    }

    async checkIrisHealth(courseId: number): Promise<IrisHealthStatus> {
        const response = await this.makeRequest(`/api/iris/courses/${courseId}/status`);
        return parseIrisHealthStatus(await response.json());
    }

    // activeProfiles reveals whether Iris is globally enabled.
    async getProfileInfo(): Promise<ProfileInfo> {
        const response = await this.makeRequest('/management/info');
        return parseProfileInfo(await response.json());
    }

    // Module feature is the current signal, profile the legacy fallback.
    isIrisProfileActive(profileInfo: ProfileInfo): boolean {
        return profileInfo.activeModuleFeatures?.includes(PROFILE_IRIS)
            || profileInfo.activeProfiles?.includes(PROFILE_IRIS)
            || false;
    }

    async getIrisCourseChatSettings(courseId: number): Promise<IrisSettingsResponse> {
        const response = await this.makeRequest(`/api/iris/courses/${courseId}/iris-settings`);
        return parseApiObject<IrisSettingsResponse>('IrisSettingsResponse', await response.json());
    }

    async getChatMessages(sessionId: number): Promise<IrisChatMessage[]> {
        const response = await this.makeRequest(`/api/iris/sessions/${sessionId}/messages`);
        return expectArray<IrisChatMessage>(
            'IrisChatMessage list',
            await response.json(),
            (item, i) => expectObject(`IrisChatMessage[${i}]`, item) as IrisChatMessage,
        );
    }

    async sendChatMessage(
        sessionId: number,
        content: string,
        uncommittedFiles?: Map<string, string>,
        pendingContext?: ServerContext,
    ): Promise<IrisChatMessage> {
        const buildPayload = (withFiles: boolean): Record<string, unknown> => {
            const payload: Record<string, unknown> = {
                sentAt: new Date().toISOString(),
                content: [{ textContent: content, type: 'text' }],
            };
            if (pendingContext) {
                // Only mode and entityId travel; `name` is a local display value.
                payload.pendingContext = { mode: pendingContext.mode, entityId: pendingContext.entityId };
            }
            if (withFiles && uncommittedFiles && uncommittedFiles.size > 0) {
                payload.uncommittedFiles = Object.fromEntries(uncommittedFiles);
            }
            return payload;
        };

        const post = async (withFiles: boolean): Promise<IrisChatMessage> => {
            const response = await this.makeRequest(`/api/iris/sessions/${sessionId}/messages`, {
                method: 'POST',
                body: JSON.stringify(buildPayload(withFiles)),
            });
            return parseApiObject<IrisChatMessage>('IrisChatMessage', await response.json());
        };

        try {
            return await post(true);
        } catch (error: unknown) {
            // The retry exists ONLY for servers that reject `uncommittedFiles`. It must
            // never fire when there were no files (a pendingContext 400 would then be
            // retried identically), and it must keep pendingContext (dropping it would
            // silently send the message into the wrong topic).
            const hasFiles = !!uncommittedFiles && uncommittedFiles.size > 0;
            if (hasFiles && error instanceof ApiError && error.status === 400) {
                logger.warn('Retrying send without uncommitted files (server may not support them)', LogCategory.API);
                return await post(false);
            }
            throw error;
        }
    }

    async markMessageHelpful(sessionId: number, messageId: number, helpful: boolean): Promise<void> {
        await this.makeRequest(
            `/api/iris/sessions/${sessionId}/messages/${messageId}/helpful`,
            {
                method: 'PUT',
                body: JSON.stringify(helpful)
            }
        );
    }

    /** Shared mapper: the detail DTO carries no courseId, so the caller supplies it. */
    private _toSessionDetail(raw: unknown, courseId: number): SessionDetail {
        const session = parseApiObject<IrisChatSession>('IrisChatSession', raw, [{ key: 'id', type: 'number' }]);
        // `mode` and `entityId` are guaranteed on a chat session. Defaulting them
        // would INFER a committed context, which invariant 3 forbids: the chip
        // would name a topic the server never reported, and the picker would
        // read a change as a no-op. A malformed response is a bug, not a course
        // chat, so it is rejected here where it is still cheap.
        if (typeof session.mode !== 'string' || typeof session.entityId !== 'number') {
            throw new MalformedResponseError(`Iris chat session ${session.id} has no mode/entityId`, 200);
        }
        const parsed = Date.parse(String(session.lastActivityDate ?? session.creationDate ?? ''));
        return {
            sessionId: session.id,
            courseId,
            context: { mode: session.mode, entityId: session.entityId },
            title: typeof session.title === 'string' ? session.title : undefined,
            lastActivity: Number.isNaN(parsed) ? 0 : parsed,
            // @JsonInclude(NON_EMPTY): `messages` is absent, not [], on an empty session.
            messages: Array.isArray(session.messages) ? session.messages : [],
        };
    }

    async getCurrentChat(mode: IrisChatMode, entityId: number, courseId: number): Promise<SessionDetail> {
        const params = new URLSearchParams({ mode, entityId: String(entityId) });
        const response = await this.makeRequest(`/api/iris/chat/sessions/current?${params.toString()}`, { method: 'POST' });
        return this._toSessionDetail(await response.json(), courseId);
    }

    /**
     * Creates (or reuses) an EMPTY course session. Every session is born
     * COURSE_CHAT and is repointed later by a message's pendingContext.
     */
    async createCourseSession(courseId: number): Promise<SessionDetail> {
        const params = new URLSearchParams({ courseId: String(courseId) });
        const response = await this.makeRequest(`/api/iris/chat/sessions?${params.toString()}`, { method: 'POST' });
        return this._toSessionDetail(await response.json(), courseId);
    }

    async getChatSessionById(courseId: number, sessionId: number): Promise<SessionDetail> {
        const response = await this.makeRequest(`/api/iris/chat/courses/${courseId}/sessions/${sessionId}`);
        return this._toSessionDetail(await response.json(), courseId);
    }

    async listChatSessionsForCourse(courseId: number): Promise<SessionSummary[]> {
        const response = await this.makeRequest(`/api/iris/chat/${courseId}/sessions/overview`);
        return expectArray<SessionSummary>('SessionSummary list', await response.json(), (item, i) => {
            const dto = parseApiObject<IrisChatSessionSummary>(`IrisChatSessionSummary[${i}]`, item, [
                { key: 'id', type: 'number' },
                { key: 'entityId', type: 'number' },
                { key: 'creationDate', type: 'string' },
                { key: 'mode', type: 'string' },
            ]);
            const parsed = Date.parse(dto.lastActivityDate ?? dto.creationDate);
            return {
                sessionId: dto.id,
                courseId,
                context: { mode: dto.mode, entityId: dto.entityId, name: dto.entityName },
                title: dto.title,
                lastActivity: Number.isNaN(parsed) ? 0 : parsed,
            };
        });
    }

    async renderProblemStatement(request: ProblemStatementRenderRequest): Promise<RenderedProblemStatementDTO> {
        const response = await this.makeRequest(
            CONFIG.API.ENDPOINTS.RENDER_PROBLEM_STATEMENT,
            {
                method: 'POST',
                body: JSON.stringify(request),
            }
        );
        const body = await response.json() as unknown;
        if (!isRenderedProblemStatementDTO(body)) {
            throw new Error('Invalid response from problem-statement render endpoint');
        }
        return body;
    }
}

// Body of this DTO is injected via dangerouslySetInnerHTML; validate shape before trusting it.
function isRenderedProblemStatementDTO(value: unknown): value is RenderedProblemStatementDTO {
    if (typeof value !== 'object' || value === null) { return false; }
    const v = value as Record<string, unknown>;
    return typeof v.html === 'string'
        && typeof v.contentHash === 'string'
        && typeof v.rendererVersion === 'string';
}
