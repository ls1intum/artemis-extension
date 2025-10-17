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
    async getExerciseDetails(exerciseId: number): Promise<any> {
        const response = await this.makeRequest(`/api/exercise/exercises/${exerciseId}/details`);
        return response.json();
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
}

// Example usage in your extension:
/*
const apiService = new ArtemisApiService(authManager);

// Check if authenticated
const isLoggedIn = await apiService.isAuthenticated();

// Get user info
const user = await apiService.getCurrentUser();

// Get courses
const courses = await apiService.getCourses();

// Get exercises for a course
const exercises = await apiService.getExercises(courseId);
*/
