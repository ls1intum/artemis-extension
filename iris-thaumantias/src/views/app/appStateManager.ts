import { ArtemisApiService } from '../../api';
import { getRecommendedExtensionsByCategory, type RecommendedExtensionCategory } from '../../utils/recommendedExtensions';

export type AppState = 'login' | 'dashboard' | 'course-list' | 'course-detail' | 'exercise-detail' | 'ai-config' | 'service-status' | 'recommended-extensions';

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
        
        // Fetch courses data for the dashboard if not already cached
        try {
            if (!this._coursesData) {
                this._coursesData = await this._artemisApi.getCoursesForDashboard();
            }
            
            // Note: We don't pre-populate the ExerciseRegistry here anymore
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
            // Fetch courses data if not already cached
            if (!this._coursesData) {
                this._coursesData = await this._artemisApi.getCoursesForDashboard();
            }
            
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

    public async showExerciseDetail(exerciseId: number): Promise<void> {
        try {
            const exerciseDetails = await this._artemisApi.getExerciseDetails(exerciseId);
            this._currentExerciseData = exerciseDetails;
            this._currentState = 'exercise-detail';
        } catch (error) {
            console.error('Error loading exercise details:', error);
            throw error;
        }
    }

    public backToCourseDetails(): void {
        this._currentState = 'course-detail';
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
