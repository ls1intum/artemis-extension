import { AuthManager } from '../services/auth/authManager';
import { CONFIG, resolveServerUrl, getUserAgent } from '../utils';
import {
    ApiError, PROFILE_IRIS,
    parseArtemisUser, parseArtemisParticipation,
    parseIrisHealthStatus, parseProfileInfo, parseProgrammingSubmission, parseBuildLogEntry,
} from '../types';
import type {
    ArtemisUser, ArtemisParticipation, AuthenticationResult,
    IrisHealthStatus, ProfileInfo, ProgrammingSubmission, BuildLogEntry,
} from '../types';
import type {
    CourseDashboardResponse, CourseDashboardEntry, CourseDashboardCourse,
    ExerciseDetailsResponse, ResultSummary, IrisChatSession, IrisChatMessage, IrisSettingsResponse,
    ExamSummary, StudentExam, IrisChatMode, IrisChatSessionSummary,
} from '../types';
import { logger, LogCategory } from '../services/loggingService';

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

        const response = await fetch(url, {
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

            // Try to extract detailed error message from response body
            let errorMessage = `API request failed: ${response.status}`;
            let errorDetail: string | undefined;
            try {
                const errorBody = await response.text();
                if (errorBody) {
                    try {
                        const parsed: unknown = JSON.parse(errorBody);
                        // Artemis uses different fields for error messages
                        if (parsed && typeof parsed === 'object') {
                            const errorObj = parsed as { message?: string; detail?: string; title?: string; error?: string };
                            errorDetail = errorObj.message || errorObj.detail || errorObj.title || errorObj.error;
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

            throw new ApiError(errorMessage, response.status, errorDetail);
        }

        return response;
    }

    // Get current user information
    async getCurrentUser(): Promise<ArtemisUser> {
        const response = await this.makeRequest('/api/core/public/account');
        return parseArtemisUser(await response.json());
    }

    // Get archived courses (inactive courses from previous semesters)
    async getArchivedCourses(): Promise<CourseDashboardCourse[]> {
        const response = await this.makeRequest('/api/core/courses/for-archive');
        return response.json() as Promise<CourseDashboardCourse[]>;
    }

    // Get courses with comprehensive dashboard data (exercises, participations, scores)
    async getCoursesForDashboard(): Promise<CourseDashboardResponse> {
        const response = await this.makeRequest('/api/core/courses/for-dashboard');
        return response.json() as Promise<CourseDashboardResponse>;
    }

    // Get a single course with exercises and participations for dashboard
    async getCourseForDashboard(courseId: number): Promise<CourseDashboardEntry> {
        const response = await this.makeRequest(`/api/core/courses/${courseId}/for-dashboard`);
        return response.json() as Promise<CourseDashboardEntry>;
    }

    // Get exercise details for a specific exercise.
    // The backend always includes studentParticipations with submissions and results —
    // no query parameters needed (the endpoint accepts none).
    async getExerciseDetails(exerciseId: number): Promise<ExerciseDetailsResponse> {
        const response = await this.makeRequest(
            `/api/exercise/exercises/${exerciseId}/details`
        );
        return response.json() as Promise<ExerciseDetailsResponse>;
    }

    // Get latest pending submission for a participation
    // A pending submission is one that has NO result yet (build in progress)
    // Returns null if no pending submission exists
    async getLatestPendingSubmission(participationId: number): Promise<ProgrammingSubmission | null> {
        try {
            const response = await this.makeRequest(
                `/api/programming/programming-exercise-participations/${participationId}/latest-pending-submission`
            );

            // Check if response has content
            const text = await response.text();
            if (!text || text.trim() === '') {
                logger.info(`No pending submission for participation ${participationId}`, LogCategory.API);
                return null;
            }

            // Parse JSON
            return parseProgrammingSubmission(JSON.parse(text));
        } catch (error) {
            // If no pending submission exists, API may return 404 or empty response
            logger.info(`No pending submission for participation ${participationId}: ${error}`, LogCategory.API);
            return null;
        }
    }

    // Get the latest result with feedbacks for a programming exercise participation.
    // Same endpoint the Artemis webapp uses — returns a full Result with feedbacks embedded,
    // no need to know the resultId upfront.
    // Backend may return 200 with null body (exam results hidden), so this returns null in that case.
    async getLatestResultWithFeedbacks(participationId: number): Promise<ResultSummary | null> {
        const response = await this.makeRequest(
            `/api/programming/programming-exercise-participations/${participationId}/latest-result-with-feedbacks?withSubmission=false`
        );
        const text = await response.text();
        if (!text || text.trim() === '' || text.trim() === 'null') {
            return null;
        }
        return JSON.parse(text) as ResultSummary;
    }

    // Get build logs for a participation (optionally for a specific result)
    async getBuildLogs(participationId: number, resultId?: number): Promise<BuildLogEntry[]> {
        let endpoint = `/api/programming/participations/${participationId}/buildlogs`;
        if (resultId !== undefined) {
            endpoint += `?resultId=${resultId}`;
        }
        const response = await this.makeRequest(endpoint);
        const data: unknown = await response.json();
        return (data as unknown[]).map(e => parseBuildLogEntry(e));
    }

    // Get VCS access token for a specific participation (per-exercise token)
    async getVcsAccessToken(participationId: number): Promise<string> {
        const response = await this.makeRequest(
            `/api/core/account/participation-vcs-access-token?participationId=${participationId}`,
            { method: 'GET' }
        );
        return response.text();
    }

    // Create VCS access token (if one does not already exist)
    async createVcsAccessToken(participationId: number): Promise<string> {
        const response = await this.makeRequest(
            `/api/core/account/participation-vcs-access-token?participationId=${participationId}`,
            { method: 'PUT' }
        );
        return response.text();
    }

    // Get or create VCS access token helper
    async getOrCreateVcsAccessToken(participationId: number): Promise<string> {
        try {
            return await this.getVcsAccessToken(participationId);
        } catch (err) {
            // Attempt to create if GET failed (e.g., no token yet)
            return await this.createVcsAccessToken(participationId);
        }
    }

    // Start participation in an exercise (create a new participation)
    async startExerciseParticipation(exerciseId: number): Promise<ArtemisParticipation> {
        const response = await this.makeRequest(
            `/api/exercise/exercises/${exerciseId}/participations`,
            { method: 'POST' }
        );
        return parseArtemisParticipation(await response.json());
    }

    // Start practice participation in an exercise
    async startPracticeParticipation(exerciseId: number): Promise<ArtemisParticipation> {
        const response = await this.makeRequest(
            `/api/exercise/exercises/${exerciseId}/participations/practice`,
            { method: 'POST' }
        );
        return parseArtemisParticipation(await response.json());
    }

    // Authenticate user with username and password
    async authenticate(username: string, password: string, rememberMe: boolean = false): Promise<AuthenticationResult> {
        const url = `${this.getServerUrl()}${CONFIG.API.ENDPOINTS.AUTHENTICATE}`;

        const response = await fetch(url, {
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

        // Store as cookie string — Desktop auth sends Cookie header, not Bearer
        await this.authManager.storeArtemisCredentials(jwtCookie, this.getServerUrl(), rememberMe);

        return { success: true };
    }

    /**
     * Inform the Artemis server that the user is logging out.
     *
     * Best-effort: this method never throws. The calling logout flow
     * must always clear local state regardless of the server response,
     * so any failure here is logged and swallowed.
     *
     * Uses a direct fetch instead of `makeRequest()` so a non-2xx
     * response does not trigger the shared 401 handler (which would
     * re-clear auth and fire the auth-expired callback — both
     * pointless and confusing during an intentional logout).
     *
     * Note: Artemis uses strictly stateless JWTs — verified 2026-04-05 both
     * empirically (tokens stayed valid on /api/core/public/account after
     * multiple explicit logout calls) and via source: Artemis'
     * PublicUserJwtResource.logout() (core/web/open/PublicUserJwtResource.java)
     * only builds a Set-Cookie: jwt=; Max-Age=0 response header — no blacklist,
     * no audit log, no server-side token invalidation. This Extension manages
     * the JWT via VS Code secrets (not a cookie jar), so the Set-Cookie header
     * is discarded by fetch(). The call is kept for protocol symmetry with
     * the Artemis webapp.
     */
    async logoutFromServer(): Promise<void> {
        const headers = await this.authManager.getAuthHeaders();
        if (Object.keys(headers).length === 0) {
            // Not authenticated — nothing to tell the server.
            return;
        }

        try {
            const response = await fetch(`${this.getServerUrl()}${CONFIG.API.ENDPOINTS.LOGOUT}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': getUserAgent(),
                    ...headers,
                },
            });
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

    // Check Iris health status (course-scoped)
    async checkIrisHealth(courseId: number): Promise<IrisHealthStatus> {
        const response = await this.makeRequest(`/api/iris/courses/${courseId}/status`);
        return parseIrisHealthStatus(await response.json());
    }

    // Get server profile information (includes activeProfiles to check if Iris is globally enabled)
    async getProfileInfo(): Promise<ProfileInfo> {
        const response = await this.makeRequest('/management/info');
        return parseProfileInfo(await response.json());
    }

    // Check if Iris is active on the server (module feature or legacy profile)
    isIrisProfileActive(profileInfo: ProfileInfo): boolean {
        return profileInfo.activeModuleFeatures?.includes(PROFILE_IRIS)
            || profileInfo.activeProfiles?.includes(PROFILE_IRIS)
            || false;
    }

    // Render PlantUML diagram to SVG
    async renderPlantUmlToSvg(plantUml: string, useDarkTheme: boolean = false): Promise<string> {
        const encodedPlantUml = encodeURIComponent(plantUml);
        const endpoint = `/api/programming/plantuml/svg?plantuml=${encodedPlantUml}&useDarkTheme=${useDarkTheme}`;
        const response = await this.makeRequest(endpoint);
        return response.text();
    }

    // ============ IRIS CHAT API ============

    // Get Iris settings for a course
    async getIrisCourseChatSettings(courseId: number): Promise<IrisSettingsResponse> {
        const response = await this.makeRequest(`/api/iris/courses/${courseId}/iris-settings`);
        return response.json() as Promise<IrisSettingsResponse>;
    }

    // Get or create current chat session for a course
    async getCurrentCourseChat(courseId: number): Promise<IrisChatSession> {
        const response = await this.makeRequest(
            `/api/iris/course-chat/${courseId}/sessions/current`,
            { method: 'POST' }
        );
        return response.json() as Promise<IrisChatSession>;
    }

    // Get or create current chat session for an exercise
    async getCurrentExerciseChat(exerciseId: number): Promise<IrisChatSession> {
        const response = await this.makeRequest(
            `/api/iris/programming-exercise-chat/${exerciseId}/sessions/current`,
            { method: 'POST' }
        );
        return response.json() as Promise<IrisChatSession>;
    }

    // Get all chat sessions for an exercise (metadata only, lightweight)
    async getExerciseChatSessions(exerciseId: number): Promise<IrisChatSession[]> {
        const response = await this.makeRequest(`/api/iris/programming-exercise-chat/${exerciseId}/sessions`);
        return response.json() as Promise<IrisChatSession[]>;
    }

    // Get all chat sessions for a course WITH messages (heavy operation)
    // Uses the chat-history endpoint which returns full session data
    async getCourseChatSessionsWithMessages(courseId: number): Promise<IrisChatSession[]> {
        const response = await this.makeRequest(`/api/iris/chat-history/${courseId}/sessions`);
        return response.json() as Promise<IrisChatSession[]>;
    }

    // Get all chat sessions for an exercise WITH messages (heavy operation)
    // This fetches session list first, then fetches messages for each session
    async getExerciseChatSessionsWithMessages(exerciseId: number): Promise<IrisChatSession[]> {
        // First get the session list (metadata only)
        const sessions = await this.getExerciseChatSessions(exerciseId);

        // Then fetch messages for each session
        const sessionsWithMessages = await Promise.all(
            sessions.map(async (session) => {
                try {
                    const messages = await this.getChatMessages(session.id);
                    return {
                        ...session,
                        messages: messages
                    };
                } catch (error) {
                    logger.warn(`Failed to fetch messages for session ${session.id}: ${error}`, LogCategory.API);
                    return {
                        ...session,
                        messages: []
                    };
                }
            })
        );

        return sessionsWithMessages;
    }

    // Get messages for a chat session
    async getChatMessages(sessionId: number): Promise<IrisChatMessage[]> {
        const response = await this.makeRequest(`/api/iris/sessions/${sessionId}/messages`);
        return response.json() as Promise<IrisChatMessage[]>;
    }

    // Send a message to Iris
    async sendChatMessage(
        sessionId: number,
        content: string,
        uncommittedFiles?: Map<string, string>
    ): Promise<IrisChatMessage> {
        const messagePayload: Record<string, unknown> = {
            sentAt: new Date().toISOString(),
            content: [
                {
                    textContent: content,
                    type: 'text'
                }
            ]
        };

        // Add uncommitted files if provided
        // Note: Only add if non-empty to maintain backward compatibility
        // Older Artemis servers will ignore unknown fields (Jackson default behavior)
        if (uncommittedFiles && uncommittedFiles.size > 0) {
            messagePayload.uncommittedFiles = Object.fromEntries(uncommittedFiles);
            logger.info(`Sending ${uncommittedFiles.size} uncommitted files to Iris`, LogCategory.API);
        }

        try {
            const response = await this.makeRequest(
                `/api/iris/sessions/${sessionId}/messages`,
                {
                    method: 'POST',
                    body: JSON.stringify(messagePayload)
                }
            );
            return response.json() as Promise<IrisChatMessage>;
        } catch (error: unknown) {
            // If sending with uncommittedFiles fails, retry without them
            // This handles the case where the server doesn't support the feature yet
            if (uncommittedFiles && uncommittedFiles.size > 0 && error instanceof ApiError && error.status === 400) {
                logger.warn('Failed to send uncommitted files, retrying without them (server might not support this feature yet)', LogCategory.API);
                const fallbackPayload = {
                    sentAt: new Date().toISOString(),
                    content: [
                        {
                            textContent: content,
                            type: 'text'
                        }
                    ]
                };
                const fallbackResponse = await this.makeRequest(
                    `/api/iris/sessions/${sessionId}/messages`,
                    {
                        method: 'POST',
                        body: JSON.stringify(fallbackPayload)
                    }
                );
                return fallbackResponse.json() as Promise<IrisChatMessage>;
            }
            throw error;
        }
    }

    // Create a new chat session for a course
    async createCourseChatSession(courseId: number): Promise<IrisChatSession> {
        const response = await this.makeRequest(
            `/api/iris/course-chat/${courseId}/sessions`,
            { method: 'POST' }
        );
        return response.json() as Promise<IrisChatSession>;
    }

    // Create a new chat session for an exercise
    async createExerciseChatSession(exerciseId: number): Promise<IrisChatSession> {
        const response = await this.makeRequest(
            `/api/iris/programming-exercise-chat/${exerciseId}/sessions`,
            { method: 'POST' }
        );
        return response.json() as Promise<IrisChatSession>;
    }

    // Mark a message as helpful
    async markMessageHelpful(sessionId: number, messageId: number, helpful: boolean): Promise<void> {
        await this.makeRequest(
            `/api/iris/sessions/${sessionId}/messages/${messageId}/helpful`,
            {
                method: 'PUT',
                body: JSON.stringify(helpful)
            }
        );
    }

    // Unified Iris chat session endpoints (Artemis develop, PR #12504).
    async getCurrentChat(mode: IrisChatMode, entityId: number): Promise<IrisChatSession> {
        const params = new URLSearchParams({ mode, entityId: String(entityId) });
        const response = await this.makeRequest(
            `/api/iris/chat/sessions/current?${params.toString()}`,
            { method: 'POST' },
        );
        return response.json() as Promise<IrisChatSession>;
    }

    async createChatSession(mode: IrisChatMode, entityId: number): Promise<IrisChatSession> {
        const params = new URLSearchParams({ mode, entityId: String(entityId) });
        const response = await this.makeRequest(
            `/api/iris/chat/sessions?${params.toString()}`,
            { method: 'POST' },
        );
        return response.json() as Promise<IrisChatSession>;
    }

    async listChatSessionsForCourse(courseId: number): Promise<IrisChatSessionSummary[]> {
        const response = await this.makeRequest(`/api/iris/chat/${courseId}/sessions/overview`);
        return response.json() as Promise<IrisChatSessionSummary[]>;
    }

    // Get exam sidebar data for a specific course (student-accessible).
    // Returns lightweight exam metadata (id, title, startDate, workingTime, examMaxPoints).
    // Note: does NOT include endDate — use course.exams from getCourseForDashboard for full data.
    async getExamSidebarData(courseId: number): Promise<ExamSummary[]> {
        const response = await this.makeRequest(`/api/exam/courses/${courseId}/real-exams-sidebar-data`);
        return response.json() as Promise<ExamSummary[]>;
    }

    // Get the student's own exam for a specific exam (to check status)
    async getOwnStudentExam(courseId: number, examId: number): Promise<StudentExam> {
        const response = await this.makeRequest(`/api/exam/courses/${courseId}/exams/${examId}/own-student-exam`);
        return response.json() as Promise<StudentExam>;
    }

    // Start the exam and get conduction details
    async startStudentExam(courseId: number, examId: number, studentExamId: number): Promise<StudentExam> {
        const response = await this.makeRequest(`/api/exam/courses/${courseId}/exams/${examId}/student-exams/${studentExamId}/conduction`);
        return response.json() as Promise<StudentExam>;
    }

}
