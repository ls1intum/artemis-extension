import * as vscode from 'vscode';
import { AuthManager } from '../auth';
import { CONFIG, VSCODE_CONFIG } from '../utils';
import { IrisHealthStatus } from '../types';

export class ArtemisApiService {
    private authManager: AuthManager;

    constructor(authManager: AuthManager) {
        this.authManager = authManager;
    }

    private getServerUrl(): string {
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
                ...headers,
                ...options.headers,
            },
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Authentication failed. Please log in again.');
            }
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        return response;
    }

    // Get current user information
    async getCurrentUser(): Promise<any> {
        const response = await this.makeRequest('/api/core/public/account');
        return response.json();
    }

    // Get all courses for the current user
    async getCourses(): Promise<any[]> {
        const response = await this.makeRequest('/api/core/courses');
        return response.json() as Promise<any[]>;
    }

    // Get archived courses (inactive courses from previous semesters)
    async getArchivedCourses(): Promise<any[]> {
        const response = await this.makeRequest('/api/core/courses/for-archive');
        return response.json() as Promise<any[]>;
    }

    // Get courses with comprehensive dashboard data (exercises, participations, scores)
    async getCoursesForDashboard(): Promise<any> {
        const response = await this.makeRequest('/api/core/courses/for-dashboard');
        return response.json();
    }

    // Get exercises for a specific course
    async getExercises(courseId: number): Promise<any[]> {
        const response = await this.makeRequest(`/api/core/courses/${courseId}/exercises`);
        return response.json() as Promise<any[]>;
    }

    // Get detailed course information for a specific course
    async getCourseDetails(courseId: number): Promise<any> {
        const response = await this.makeRequest(`/api/core/courses/${courseId}`);
        return response.json();
    }

    // Get exercise details for a specific exercise
    // According to Artemis frontend code, this endpoint already includes:
    // - studentParticipations with ALL submissions and results
    // No query parameters or additional enrichment needed
    async getExerciseDetails(exerciseId: number): Promise<any> {
        // Request exercise details with all submissions and their latest results
        // withSubmissions=true ensures we get submission data
        // withLatestResult=true ensures each submission includes its most recent result
        const response = await this.makeRequest(
            `/api/exercise/exercises/${exerciseId}/details?withSubmissions=true&withLatestResult=true`
        );
        const exerciseData: any = await response.json();

        // Debug: Log what we actually received
        if (exerciseData.exercise?.studentParticipations?.length > 0) {
            for (const participation of exerciseData.exercise.studentParticipations) {
                const submissionCount = participation.submissions?.length || 0;
                const resultCount = participation.results?.length || 0;
                console.log(`📊 Participation ${participation.id}: ${submissionCount} submissions, ${resultCount} results`);

                if (submissionCount === 0) {
                    console.warn(`⚠️ Participation ${participation.id} has no submissions array or it's empty`);
                    console.log('Participation data:', JSON.stringify(participation, null, 2));
                }
            }
        } else {
            console.warn('⚠️ No student participations found in exercise details response');
        }

        return exerciseData;
    }

    // Get latest pending submission for a participation
    // A pending submission is one that has NO result yet (build in progress)
    // Returns null if no pending submission exists
    async getLatestPendingSubmission(participationId: number): Promise<any> {
        try {
            const response = await this.makeRequest(
                `/api/programming/programming-exercise-participations/${participationId}/latest-pending-submission`
            );
            
            // Check if response has content
            const text = await response.text();
            if (!text || text.trim() === '') {
                console.log(`No pending submission for participation ${participationId}`);
                return null;
            }
            
            // Parse JSON
            const data = JSON.parse(text);
            return data;
        } catch (error) {
            // If no pending submission exists, API may return 404 or empty response
            console.log(`No pending submission for participation ${participationId}:`, error);
            return null;
        }
    }

    // Get participations for the current user
    async getParticipations(): Promise<any[]> {
        const response = await this.makeRequest('/api/core/participations');
        return response.json() as Promise<any[]>;
    }

    // Get results for a participation
    async getResults(participationId: number): Promise<any[]> {
        const response = await this.makeRequest(`/api/core/participations/${participationId}/results`);
        return response.json() as Promise<any[]>;
    }

    // Get detailed result information including test cases and feedback
    async getResultDetails(participationId: number, resultId: number): Promise<any> {
        const response = await this.makeRequest(`/api/assessment/participations/${participationId}/results/${resultId}/details`);
        return response.json();
    }

    // Get build logs for a participation (optionally for a specific result)
    async getBuildLogs(participationId: number, resultId?: number): Promise<any[]> {
        let endpoint = `/api/programming/participations/${participationId}/buildlogs`;
        if (resultId !== undefined) {
            endpoint += `?resultId=${resultId}`;
        }
        const response = await this.makeRequest(endpoint);
        return response.json() as Promise<any[]>;
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
    async startExerciseParticipation(exerciseId: number): Promise<any> {
        const response = await this.makeRequest(
            `/api/exercise/exercises/${exerciseId}/participations`,
            { method: 'POST' }
        );
        return response.json();
    }

    // Authenticate user with username and password
    async authenticate(username: string, password: string, rememberMe: boolean = false): Promise<any> {
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
                    const parsed = JSON.parse(rawError);
                    parsedMessage = parsed?.title || parsed?.message || parsed?.detail || parsed?.error || parsedMessage;
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

        const data = await response.json() as any;

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

        return {
            success: true,
            token: data.access_token,
            cookie: jwtCookie
        };
    }

    // Validate the current authentication by calling the user endpoint
    async validateAuthentication(): Promise<boolean> {
        try {
            const user = await this.getCurrentUser();
            return !!user;
        } catch (error) {
            console.error('Authentication validation failed:', error);
            return false;
        }
    }

    // Check if the stored server URL matches the current configuration
    async isServerUrlChanged(): Promise<boolean> {
        const storedServerUrl = await this.authManager.getArtemisServerUrl();
        const currentServerUrl = this.getServerUrl();
        return storedServerUrl !== currentServerUrl;
    }

    // Check Iris health status
    async checkIrisHealth(): Promise<IrisHealthStatus> {
        const response = await this.makeRequest('/api/iris/status');
        return response.json() as Promise<IrisHealthStatus>;
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
    async getIrisCourseChatSettings(courseId: number): Promise<any> {
        const response = await this.makeRequest(`/api/iris/courses/${courseId}/iris-settings`);
        return response.json();
    }

    // Get Iris settings for an exercise
    async getIrisExerciseChatSettings(exerciseId: number): Promise<any> {
        const response = await this.makeRequest(`/api/iris/exercises/${exerciseId}/iris-settings`);
        return response.json();
    }

    // Get or create current chat session for a course
    async getCurrentCourseChat(courseId: number): Promise<any> {
        const response = await this.makeRequest(
            `/api/iris/course-chat/${courseId}/sessions/current`,
            { method: 'POST' }
        );
        return response.json();
    }

    // Get or create current chat session for an exercise
    async getCurrentExerciseChat(exerciseId: number): Promise<any> {
        const response = await this.makeRequest(
            `/api/iris/programming-exercise-chat/${exerciseId}/sessions/current`,
            { method: 'POST' }
        );
        return response.json();
    }

    // Get all chat sessions for a course (metadata only, lightweight)
    async getCourseChatSessions(courseId: number): Promise<any[]> {
        const response = await this.makeRequest(`/api/iris/course-chat/${courseId}/sessions`);
        return response.json() as Promise<any[]>;
    }

    // Get all chat sessions for an exercise (metadata only, lightweight)
    async getExerciseChatSessions(exerciseId: number): Promise<any[]> {
        const response = await this.makeRequest(`/api/iris/programming-exercise-chat/${exerciseId}/sessions`);
        return response.json() as Promise<any[]>;
    }

    // Get all chat sessions for a course WITH messages (heavy operation)
    // Uses the chat-history endpoint which returns full session data
    async getCourseChatSessionsWithMessages(courseId: number): Promise<any[]> {
        const response = await this.makeRequest(`/api/iris/chat-history/${courseId}/sessions`);
        return response.json() as Promise<any[]>;
    }

    // Get all chat sessions for an exercise WITH messages (heavy operation)
    // This fetches session list first, then fetches messages for each session
    async getExerciseChatSessionsWithMessages(exerciseId: number): Promise<any[]> {
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
                    console.warn(`Failed to fetch messages for session ${session.id}:`, error);
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
    async getChatMessages(sessionId: number): Promise<any[]> {
        const response = await this.makeRequest(`/api/iris/sessions/${sessionId}/messages`);
        return response.json() as Promise<any[]>;
    }

    // Send a message to Iris
    async sendChatMessage(
        sessionId: number, 
        content: string, 
        uncommittedFiles?: Map<string, string>
    ): Promise<any> {
        const messagePayload: any = {
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
        // Older Artemis backends will ignore unknown fields (Jackson default behavior)
        if (uncommittedFiles && uncommittedFiles.size > 0) {
            messagePayload.uncommittedFiles = Object.fromEntries(uncommittedFiles);
            console.log(`Sending ${uncommittedFiles.size} uncommitted files to Iris`);
        }

        try {
            const response = await this.makeRequest(
                `/api/iris/sessions/${sessionId}/messages`,
                {
                    method: 'POST',
                    body: JSON.stringify(messagePayload)
                }
            );
            return response.json();
        } catch (error: any) {
            // If sending with uncommittedFiles fails, retry without them
            // This handles the case where the backend doesn't support the feature yet
            if (uncommittedFiles && uncommittedFiles.size > 0 && error.status === 400) {
                console.warn('Failed to send uncommitted files, retrying without them (backend might not support this feature yet)');
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
                return fallbackResponse.json();
            }
            throw error;
        }
    }

    // Create a new chat session for a course
    async createCourseChatSession(courseId: number): Promise<any> {
        const response = await this.makeRequest(
            `/api/iris/course-chat/${courseId}/sessions`,
            { method: 'POST' }
        );
        return response.json();
    }

    // Create a new chat session for an exercise
    async createExerciseChatSession(exerciseId: number): Promise<any> {
        const response = await this.makeRequest(
            `/api/iris/programming-exercise-chat/${exerciseId}/sessions`,
            { method: 'POST' }
        );
        return response.json();
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
    async resendChatMessage(sessionId: number, messageId: number): Promise<any> {
        const response = await this.makeRequest(
            `/api/iris/sessions/${sessionId}/messages/${messageId}/resend`,
            { method: 'POST' }
        );
        return response.json();
    }
}
