import * as vscode from 'vscode';
import { AppStateManager } from './appStateManager';
import { AiCheckerView } from '../templates/aiCheckerView';
import { CourseDetailView } from '../templates/courseDetailView';
import { CourseListView } from '../templates/courseListView';
import { StyleManager } from '../styles';
import { DashboardView } from '../templates/dashboardView';
import { ExerciseDetailView } from '../templates/exerciseDetailView';
import { LoginView } from '../templates/loginView';
import { ServiceStatusView } from '../templates/serviceStatusView';
import { RecommendedExtensionsView } from '../templates/recommendedExtensionsView';

/**
 * Maps application state to the appropriate webview HTML.
 */
export class ViewRouter {
    private readonly _loginView: LoginView;
    private readonly _styleManager: StyleManager;
    private readonly _dashboardView: DashboardView;
    private readonly _courseListView: CourseListView;
    private readonly _courseDetailView: CourseDetailView;
    private readonly _exerciseDetailView: ExerciseDetailView;
    private readonly _aiCheckerView: AiCheckerView;
    private readonly _serviceStatusView: ServiceStatusView;
    private readonly _recommendedExtensionsView: RecommendedExtensionsView;

    constructor(
        private readonly _appStateManager: AppStateManager,
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _webview?: vscode.Webview
    ) {
        // Initialize view templates with extension context
        this._styleManager = new StyleManager(this._extensionContext.extensionUri);

        this._loginView = new LoginView(this._styleManager);
        this._dashboardView = new DashboardView(this._extensionContext, this._styleManager);
        this._courseListView = new CourseListView(this._styleManager);
        this._courseDetailView = new CourseDetailView(this._extensionContext, this._styleManager);
        this._exerciseDetailView = new ExerciseDetailView(this._extensionContext, this._styleManager);
        this._aiCheckerView = new AiCheckerView(this._extensionContext, this._styleManager);
        this._serviceStatusView = new ServiceStatusView(this._extensionContext, this._styleManager);
        this._recommendedExtensionsView = new RecommendedExtensionsView(this._styleManager);
    }

    public getHtml(): string {
        const webview = this._webview;
        if (!webview) {
            throw new Error('Webview is not initialized');
        }

        const state = this._appStateManager.currentState;
        
        // Read developer tools setting
        const config = vscode.workspace.getConfiguration('artemis');
        const hideDeveloperTools = config.get<boolean>('hideDeveloperTools', false);

        switch (state) {
            case 'dashboard': {
                const userInfo = this._appStateManager.userInfo;
                if (userInfo) {
                    return this._dashboardView.generateHtml(userInfo, this._appStateManager.coursesData, webview);
                }
                break;
            }
            case 'course-list':
                return this._courseListView.generateHtml(
                    this._appStateManager.coursesData, 
                    this._appStateManager.archivedCoursesData
                );
            case 'course-detail':
                return this._courseDetailView.generateHtml(this._appStateManager.currentCourseData, hideDeveloperTools, webview);
            case 'exercise-detail':
                return this._exerciseDetailView.generateHtml(this._appStateManager.currentExerciseData, hideDeveloperTools);
            case 'ai-config':
                return this._aiCheckerView.generateHtml(this._appStateManager.aiExtensions || []);
            case 'service-status': {
                const serverUrl = this._appStateManager.userInfo?.serverUrl;
                return this._serviceStatusView.generateHtml(serverUrl, webview);
            }
            case 'recommended-extensions': {
                const categories = this._appStateManager.recommendedExtensions || [];
                return this._recommendedExtensionsView.generateHtml(categories);
            }
            case 'login':
            default:
                break;
        }

        return this._loginView.generateHtml();
    }
}
