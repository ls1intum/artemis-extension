import { ArtemisApiService } from '../../api';
import { getRecommendedExtensionsByCategory, type RecommendedExtensionCategory } from '../../utils/recommendedExtensions';

export type AppState = 'login' | 'dashboard' | 'course-list' | 'course-detail' | 'exercise-detail' | 'ai-config' | 'service-status' | 'recommended-extensions' | 'git-credentials';

export interface UserInfo {
    username: string;
    serverUrl: string;
    user?: any;
}

export interface AiExtension {
    id: string;
    name: string;
    publisher: string;
    version: string;
    description: string;
    isInstalled: boolean;
    provider: string;
    providerColor: string;
}

/**
 * Manages the application state for the Artemis webview
 */
export class AppStateManager {
    private _currentState: AppState = 'login';
    private _userInfo?: UserInfo;
    private _coursesData?: any;
    private _archivedCoursesData?: any[];
    private _currentCourseData?: any;
    private _currentExerciseData?: any;
    private _aiExtensions?: AiExtension[];
    private _recommendedExtensions?: RecommendedExtensionCategory[];

    constructor(private readonly _artemisApi: ArtemisApiService) {}

    // State getters
    get currentState(): AppState {
        return this._currentState;
    }

    get userInfo(): UserInfo | undefined {
        return this._userInfo;
    }

    get coursesData(): any {
        return this._coursesData;
    }

    get archivedCoursesData(): any[] | undefined {
        return this._archivedCoursesData;
    }

    get currentCourseData(): any {
        return this._currentCourseData;
    }

    get currentExerciseData(): any {
        return this._currentExerciseData;
    }

    get aiExtensions(): AiExtension[] | undefined {
        return this._aiExtensions;
    }

    get recommendedExtensions(): RecommendedExtensionCategory[] | undefined {
        return this._recommendedExtensions;
    }

    // State transitions
    public async showDashboard(userInfo: UserInfo): Promise<void> {
        this._userInfo = userInfo;
        this._currentState = 'dashboard';
        
        // Always fetch fresh courses data for the dashboard
        try {
            this._coursesData = await this._artemisApi.getCoursesForDashboard();
            
            // The registry is populated lazily when needed (e.g., when viewing course details, for Iris chat)
            // For workspace detection, we search coursesData directly (see _handleDetectWorkspaceExercise)
        } catch (error) {
            console.error('Error loading courses for dashboard:', error);
            // Continue anyway, dashboard will show "Loading courses..."
        }
    }

    public showLogin(): void {
        this._currentState = 'login';
        this._userInfo = undefined;
        this._coursesData = undefined;
        this._archivedCoursesData = undefined;
        this._currentCourseData = undefined;
        this._currentExerciseData = undefined;
        this._recommendedExtensions = undefined;
    }

    public async showCourseList(): Promise<void> {
        try {
            // Always fetch fresh courses data
            this._coursesData = await this._artemisApi.getCoursesForDashboard();
            
            this._currentState = 'course-list';
        } catch (error) {
            console.error('Error loading courses:', error);
            throw error;
        }
    }

    public showCourseDetail(courseData: any): void {
        this._currentCourseData = courseData;
        this._currentState = 'course-detail';
    }

    public async showArchivedCourseDetail(courseId: number): Promise<void> {
        try {
            // Fetch course details
            const courseDetails = await this._artemisApi.getCourseDetails(courseId);
            
            // Create courseData structure for archived courses
            // We don't include exercises since archived courses typically don't have active exercises
            const archivedCourseData = {
                course: {
                    ...courseDetails,
                    exercises: [], // Empty exercises array for archived courses
                    isArchived: true // Mark this as archived for potential UI differences
                }
            };
            
            this._currentCourseData = archivedCourseData;
            this._currentState = 'course-detail';
        } catch (error) {
            console.error('Error loading archived course details:', error);
            throw error;
        }
    }

    public async showExerciseDetail(exerciseId: number, forceRefresh: boolean = true): Promise<void> {
        try {
            // ALWAYS fetch fresh data by default to ensure we have the latest results
            // This prevents stale data when WebSocket fails or disconnects
            // Only skip if explicitly requested AND same exercise
            const shouldFetch = forceRefresh || 
                               !this._currentExerciseData || 
                               this._currentExerciseData?.exercise?.id !== exerciseId;
            
            if (shouldFetch) {
                console.log(`🔄 Fetching fresh exercise data for exercise ${exerciseId}`);
                const exerciseDetails = await this._artemisApi.getExerciseDetails(exerciseId);
                this._currentExerciseData = exerciseDetails;
            } else {
                console.log(`📦 Using cached exercise data for exercise ${exerciseId}`);
            }
            
            this._currentState = 'exercise-detail';
        } catch (error) {
            console.error('Error loading exercise details:', error);
            throw error;
        }
    }

    public backToCourseDetails(): void {
        this._currentState = 'course-detail';
    }

    /**
     * Refresh the current exercise detail view with fresh data
     */
    public async refreshCurrentExercise(): Promise<void> {
        if (this._currentState === 'exercise-detail' && this._currentExerciseData) {
            const exerciseId = this._currentExerciseData?.exercise?.id || this._currentExerciseData?.id;
            if (exerciseId) {
                console.log(`🔄 Refreshing exercise ${exerciseId}`);
                await this.showExerciseDetail(exerciseId, true); // Force refresh
            }
        }
    }

    // Data management
    public clearCoursesData(): void {
        this._coursesData = undefined;
    }

    public setCoursesData(data: any): void {
        this._coursesData = data;
    }

    public async loadArchivedCourses(): Promise<void> {
        try {
            this._archivedCoursesData = await this._artemisApi.getArchivedCourses();
        } catch (error) {
            console.error('Error loading archived courses:', error);
            throw error;
        }
    }

    public showAiConfig(aiExtensions: AiExtension[]): void {
        this._aiExtensions = aiExtensions;
        this._currentState = 'ai-config';
    }

    public showServiceStatus(): void {
        this._currentState = 'service-status';
    }

    public showRecommendedExtensions(recommendedExtensions?: RecommendedExtensionCategory[]): void {
        if (recommendedExtensions) {
            this._recommendedExtensions = recommendedExtensions.map(category => ({
                ...category,
                extensions: category.extensions.map(extension => ({ ...extension }))
            }));
        } else {
            this._recommendedExtensions = getRecommendedExtensionsByCategory();
        }
        this._currentState = 'recommended-extensions';
    }

    public showGitCredentials(): void {
        this._currentState = 'git-credentials';
    }

    public isLoggedIn(): boolean {
        return this._userInfo !== undefined;
    }

    public requiresAuth(): boolean {
        return this._currentState !== 'login' && !this.isLoggedIn();
    }

    // State validation
    public canShowDashboard(): boolean {
        return this.isLoggedIn();
    }

    public canShowCourseList(): boolean {
        return this.isLoggedIn();
    }

    public canShowCourseDetail(): boolean {
        return this.isLoggedIn() && this._currentCourseData !== undefined;
    }

    public canShowExerciseDetail(): boolean {
        return this.isLoggedIn() && this._currentExerciseData !== undefined;
    }
}
