import * as vscode from 'vscode';
import { AuthManager } from '../services/auth/authManager';
import { CONFIG, VSCODE_CONFIG } from '../utils';
import {
    ApiError, PROFILE_IRIS,
    parseArtemisUser, parseArtemisResult, parseArtemisParticipation,
    parseIrisHealthStatus, parseProfileInfo, parseProgrammingSubmission, parseBuildLogEntry,
} from '../types';
import type {
    ArtemisUser, ArtemisResult, ArtemisParticipation, AuthenticationResult,
    IrisHealthStatus, ProfileInfo, ProgrammingSubmission, BuildLogEntry,
} from '../types';
import type {
    CourseDashboardResponse, CourseDashboardEntry, CourseDashboardCourse,
    ExerciseDetailsResponse, FeedbackSummary, IrisChatSession, IrisChatMessage, IrisSettingsResponse,
    ExamSummary, StudentExam,
} from '../types';
import { logger, LogLevel, LogCategory } from '../services/loggingService';

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
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        return config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY) || CONFIG.ARTEMIS_SERVER_URL_DEFAULT;
    }

    private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
        const headers = await this.authManager.getAuthHeaders();
        const url = `${this.getServerUrl()}${endpoint}`;

        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': CONFIG.API.USER_AGENT,
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

    // Get all courses for the current user
    async getCourses(): Promise<CourseDashboardCourse[]> {
        const response = await this.makeRequest('/api/core/courses');
        return response.json() as Promise<CourseDashboardCourse[]>;
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

    // Get detailed course information for a specific course
    async getCourseDetails(courseId: number): Promise<CourseDashboardCourse> {
        const response = await this.makeRequest(`/api/core/courses/${courseId}`);
        return response.json() as Promise<CourseDashboardCourse>;
    }

    // Get exercise details for a specific exercise
    // According to Artemis client code, this endpoint already includes:
    // - studentParticipations with ALL submissions and results
    // No query parameters or additional enrichment needed
    async getExerciseDetails(exerciseId: number): Promise<ExerciseDetailsResponse> {
        // Request exercise details with all submissions and their latest results
        // withSubmissions=true ensures we get submission data
        // withLatestResult=true ensures each submission includes its most recent result
        const response = await this.makeRequest(
            `/api/exercise/exercises/${exerciseId}/details?withSubmissions=true&withLatestResult=true`
        );
        const exerciseData = await response.json() as ExerciseDetailsResponse;

        // Debug: Log what we actually received
        if ((exerciseData.exercise?.studentParticipations?.length ?? 0) > 0) {
            for (const participation of exerciseData.exercise!.studentParticipations!) {
                const submissions = participation.submissions ?? [];
                const totalResults = submissions.reduce((sum, s) => sum + (s.results?.length ?? 0), 0);
                logger.info(`Participation ${participation.id}: ${submissions.length} submissions, ${totalResults} results`, LogCategory.API);
            }
        } else {
            logger.warn('No student participations found in exercise details response', LogCategory.API);
        }

        return exerciseData;
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

    // Get participations for the current user
    async getParticipations(): Promise<ArtemisParticipation[]> {
        const data: unknown = await (await this.makeRequest('/api/core/participations')).json();
        return (data as unknown[]).map(p => parseArtemisParticipation(p));
    }

    // Get results for a participation
    async getResults(participationId: number): Promise<ArtemisResult[]> {
        const data: unknown = await (await this.makeRequest(`/api/core/participations/${participationId}/results`)).json();
        return (data as unknown[]).map(r => parseArtemisResult(r));
    }

    // Get detailed result information including test cases and feedback
    async getResultDetails(participationId: number, resultId: number): Promise<ArtemisResult> {
        const response = await this.makeRequest(`/api/assessment/participations/${participationId}/results/${resultId}/details`);
        return parseArtemisResult(await response.json());
    }

    // Get detailed result feedbacks as FeedbackSummary (preserves testCase field)
    async getResultFeedbacks(participationId: number, resultId: number): Promise<FeedbackSummary[]> {
        const response = await this.makeRequest(`/api/assessment/participations/${participationId}/results/${resultId}/details`);
        const raw = await response.json() as Record<string, unknown>;
        const feedbacks = Array.isArray(raw.feedbacks) ? raw.feedbacks : (Array.isArray(raw) ? raw : []);
        return feedbacks.map((f: Record<string, unknown>) => ({
            id: typeof f.id === 'number' ? f.id : undefined,
            text: typeof f.text === 'string' ? f.text : undefined,
            detailText: typeof f.detailText === 'string' ? f.detailText : undefined,
            reference: typeof f.reference === 'string' ? f.reference : undefined,
            credits: typeof f.credits === 'number' ? f.credits : undefined,
            positive: typeof f.positive === 'boolean' ? f.positive : undefined,
            type: typeof f.type === 'string' ? f.type : undefined,
            visibility: typeof f.visibility === 'string' ? f.visibility : undefined,
            testCase: f.testCase && typeof f.testCase === 'object' ? {
                id: typeof (f.testCase as Record<string, unknown>).id === 'number' ? (f.testCase as Record<string, unknown>).id as number : undefined,
                testName: typeof (f.testCase as Record<string, unknown>).testName === 'string' ? (f.testCase as Record<string, unknown>).testName as string : undefined,
            } : undefined,
        }));
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

    // Check if user is authenticated
    async isAuthenticated(): Promise<boolean> {
        try {
            await this.getCurrentUser();
            return true;
        } catch (error) {
            return false;
        }
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
                'User-Agent': CONFIG.API.USER_AGENT
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

        const data = await response.json() as { access_token?: string };

        // Extract JWT cookie from Set-Cookie header
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

        // Store the credentials
        await this.authManager.storeArtemisCredentials(jwtCookie, this.getServerUrl(), rememberMe);

        return { success: true, token: data.access_token, cookie: jwtCookie };
    }

    // Validate the current authentication by calling the user endpoint
    async validateAuthentication(): Promise<boolean> {
        try {
            const user = await this.getCurrentUser();
            return !!user;
        } catch (error) {
            logger.error('Authentication validation failed', LogCategory.API, error);
            return false;
        }
    }

    // Check if the stored server URL matches the current configuration
    async isServerUrlChanged(): Promise<boolean> {
        const storedServerUrl = await this.authManager.getArtemisServerUrl();
        const currentServerUrl = this.getServerUrl();
        return storedServerUrl !== currentServerUrl;
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

    // Get Iris settings for an exercise (resolved via course settings)
    async getIrisExerciseChatSettings(exerciseId: number): Promise<IrisSettingsResponse> {
        const exerciseDetails = await this.getExerciseDetails(exerciseId);
        const courseId = exerciseDetails?.exercise?.course?.id;
        if (!courseId) {
            throw new Error('Failed to resolve course for Iris exercise settings');
        }
        return this.getIrisCourseChatSettings(courseId);
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

    // Get all chat sessions for a course (metadata only, lightweight)
    async getCourseChatSessions(courseId: number): Promise<IrisChatSession[]> {
        const response = await this.makeRequest(`/api/iris/course-chat/${courseId}/sessions`);
        return response.json() as Promise<IrisChatSession[]>;
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

    // Resend a message
    async resendChatMessage(sessionId: number, messageId: number): Promise<IrisChatMessage> {
        const response = await this.makeRequest(
            `/api/iris/sessions/${sessionId}/messages/${messageId}/resend`,
            { method: 'POST' }
        );
        return response.json() as Promise<IrisChatMessage>;
    }

    // Get exams for a specific course
    async getExamsForCourse(courseId: number): Promise<ExamSummary[]> {
        const response = await this.makeRequest(`/api/exam/courses/${courseId}/exams`);
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

    // Submit the exam
    async submitStudentExam(courseId: number, examId: number, studentExam: StudentExam): Promise<StudentExam> {
        const response = await this.makeRequest(
            `/api/exam/courses/${courseId}/exams/${examId}/student-exams/submit`,
            {
                method: 'POST',
                body: JSON.stringify(studentExam)
            }
        );
        return response.json() as Promise<StudentExam>;
    }
}
