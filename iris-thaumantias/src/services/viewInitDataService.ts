import * as vscode from 'vscode';
import { AppStateManager } from '../views/app/appStateManager';
import type { TelemetryManager } from './telemetry/telemetryManager';
import type { WebViewMessageHandler } from '../views/app/webViewMessageHandler';
import { ExtensionMsg, WebviewCmd } from '../shared/messageContracts';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage, CourseDetailData as CourseDetailPayload } from '../shared/messageContracts';
import type { CourseDashboardEntry, ExerciseDetail, ExerciseDetailsResponse } from '../types/apiResponses';
import { detectWorkspaceExercise, getWorkspaceStatus, type ExerciseSource, type WorkspaceStatus } from './workspaceDetectionService';
import { logger, LogCategory } from './loggingService';
import { VSCODE_CONFIG, CONFIG } from '../utils';

export class ViewInitDataService {
    constructor(
        private readonly _getAppStateManager: () => AppStateManager,
        private readonly _getTelemetryManager: () => TelemetryManager | undefined,
        private readonly _getMessageHandler: () => WebViewMessageHandler,
        private readonly _postMessage: (msg: ExtensionToWebviewMessage) => void,
    ) {}

    public sendInitData(): void {
        switch (this._getAppStateManager().currentState) {
            case 'dashboard':              return this.sendDashboardInit();
            case 'course-list':            return this.sendCourseListInit();
            case 'course-detail':          return this.sendCourseDetailInit();
            case 'exercise-detail':        return this.sendExerciseDetailInit();
            case 'exam-conduction':        return this.sendExamConductionInit();
            case 'exam-start':             return this.sendExamStartInit();
            case 'exam-exercise-detail':   return this.sendExamExerciseDetailInit();
            case 'ai-config':              return this.sendAiConfigInit();
            case 'struggle-detection':     return this.sendStruggleDetectionInit();
            case 'service-status':         return this.sendServiceStatusInit();
            case 'recommended-extensions': return this.sendRecommendedExtensionsInit();
            case 'git-credentials':        return this.sendGitCredentialsInit();
            case 'login':                  return this.sendLoginInit();
        }
    }

    public sendDashboardInit(): void {
        const coursesData = this._getAppStateManager().coursesData;
        const courses = coursesData?.courses || [];

        const recentCourseNodes = courses.map((courseItem: CourseDashboardEntry) => {
            const course = courseItem.course || courseItem;
            const exercises = course.exercises || [];

            const recentExercises = exercises
                .filter((ex: ExerciseDetail) => ex.releaseDate || ex.startDate || ex.dueDate)
                .sort((a: ExerciseDetail, b: ExerciseDetail) => {
                    const aDate = a.releaseDate || a.startDate || a.dueDate || '';
                    const bDate = b.releaseDate || b.startDate || b.dueDate || '';
                    return bDate.localeCompare(aDate);
                });

            return {
                courseData: {
                    course: {
                        id: (course.id ?? 0) as number,
                        title: (course.title ?? 'Untitled Course') as string,
                        exercises: course.exercises,
                        startDate: course.startDate as string | undefined,
                        creationDate: course.startDate as string | undefined,
                    }
                },
                exercises: recentExercises,
            };
        });

        // Collect all exercises across courses to detect the workspace exercise
        const allExercises = courses.flatMap((courseItem: CourseDashboardEntry) => {
            const course = courseItem.course || courseItem;
            return course.exercises || [];
        });

        detectWorkspaceExercise(allExercises as ExerciseSource[]).then((detectedExercise) => {
            this._postMessage({
                type: ExtensionMsg.DashboardInit,
                courses: recentCourseNodes,
                workspaceExercise: detectedExercise ? { id: detectedExercise.id, title: detectedExercise.title } : undefined,
            });
        }).catch((error) => {
            logger.error('Failed to detect workspace exercise for dashboard', LogCategory.VIEW, error);
            this._postMessage({
                type: ExtensionMsg.DashboardInit,
                courses: recentCourseNodes,
                workspaceExercise: undefined,
            });
        });
    }

    public sendCourseListInit(): void {
        const appState = this._getAppStateManager();
        const coursesData = appState.coursesData;
        const courses = coursesData?.courses || [];
        const archivedCourses = appState.archivedCoursesData || undefined;

        const mappedCourses = courses.map((entry: CourseDashboardEntry) => ({
            course: {
                id: entry.course?.id || 0,
                title: entry.course?.title || 'Untitled Course',
                description: entry.course?.description,
                semester: entry.course?.semester,
                color: entry.course?.color,
                exercises: entry.course?.exercises,
                numberOfStudents: entry.course?.numberOfStudents,
                instructorGroupName: entry.course?.instructorGroupName,
            }
        }));

        this._postMessage({
            type: ExtensionMsg.CourseListInit,
            courses: mappedCourses, archivedCourses,
        });
    }

    public sendCourseDetailInit(): void {
        const courseData = this._getAppStateManager().currentCourseData;
        if (!courseData) {
            logger.error('Course detail state missing course data', LogCategory.VIEW);
            return;
        }

        const exercises = courseData.course?.exercises || [];

        detectWorkspaceExercise(exercises as ExerciseSource[]).then((detectedExercise: { id?: number } | null) => {
            this._postMessage({
                type: ExtensionMsg.CourseDetailInit,
                courseData: courseData as CourseDetailPayload,
                workspaceExerciseId: detectedExercise?.id ?? null,
                hideDeveloperTools: !this._isDeveloperMode(),
            });
        }).catch((error) => {
            logger.error('Failed to detect workspace exercise for course detail', LogCategory.VIEW, error);
            this._postMessage({
                type: ExtensionMsg.CourseDetailInit,
                courseData: courseData as CourseDetailPayload,
                workspaceExerciseId: null,
                hideDeveloperTools: !this._isDeveloperMode(),
            });
        });
    }

    public sendExerciseDetailInit(): void {
        const exerciseData = this._getAppStateManager().currentExerciseData;
        if (!exerciseData) {
            logger.error('Exercise detail state missing exercise data', LogCategory.VIEW);
            return;
        }

        const participations = exerciseData.exercise?.studentParticipations ?? [];
        const repoUris = participations
            .map(p => p.repositoryUri)
            .filter((uri): uri is string => !!uri);

        if (repoUris.length > 0) {
            this._detectWorkspaceForExercise(repoUris).then((repoStatus) => {
                this._postMessage({
                    type: ExtensionMsg.ExerciseDetailInit,
                    exerciseData: exerciseData as ExerciseDetailsResponse,
                    hideDeveloperTools: !this._isDeveloperMode(),
                    repoStatus,
                });
            }).catch((error) => {
                logger.error('Failed to detect workspace status for exercise detail', LogCategory.VIEW, error);
                this._postMessage({
                    type: ExtensionMsg.ExerciseDetailInit,
                    exerciseData: exerciseData as ExerciseDetailsResponse,
                    hideDeveloperTools: !this._isDeveloperMode(),
                });
            });
        } else {
            this._postMessage({
                type: ExtensionMsg.ExerciseDetailInit,
                exerciseData: exerciseData as ExerciseDetailsResponse,
                hideDeveloperTools: !this._isDeveloperMode(),
            });
        }
    }

    public sendExamConductionInit(): void {
        const examData = this._getAppStateManager().currentExamData;
        if (!examData) {
            logger.error('Exam conduction state missing exam data', LogCategory.VIEW);
            return;
        }

        const studentExam = examData.studentExam;
        const exam = studentExam.exam;

        let startTime: number;
        let endTime: number;
        if (exam?.testExam && studentExam.startedDate) {
            startTime = new Date(studentExam.startedDate).getTime();
        } else if (exam?.startDate) {
            startTime = new Date(exam.startDate).getTime();
        } else {
            startTime = Date.now();
        }
        endTime = startTime + ((studentExam.workingTime || 0) * 1000);
        const totalDuration = (studentExam.workingTime || 0) * 1000;

        const exercises = studentExam.exercises || [];
        detectWorkspaceExercise(exercises as ExerciseSource[]).then((detectedExercise: { id?: number } | null) => {
            this._postMessage({
                type: ExtensionMsg.ExamConductionInit,
                studentExam,
                courseId: examData.courseId,
                examId: examData.examId,
                endTime,
                startTime,
                totalDuration,
                workspaceExerciseId: detectedExercise?.id ?? null,
            });
        }).catch((error) => {
            logger.error('Failed to detect workspace exercise for exam conduction', LogCategory.VIEW, error);
            this._postMessage({
                type: ExtensionMsg.ExamConductionInit,
                studentExam,
                courseId: examData.courseId,
                examId: examData.examId,
                endTime,
                startTime,
                totalDuration,
                workspaceExerciseId: null,
            });
        });
    }

    public sendExamStartInit(): void {
        const examData = this._getAppStateManager().currentExamData;
        if (!examData) {
            logger.error('Exam start state missing exam data', LogCategory.VIEW);
            return;
        }

        this._postMessage({
            type: ExtensionMsg.ExamStartInit,
            studentExam: examData.studentExam,
            courseId: examData.courseId,
            examId: examData.examId,
        });
    }

    public sendExamExerciseDetailInit(): void {
        const appState = this._getAppStateManager();
        const exerciseData = appState.currentExerciseData;
        const examData = appState.currentExamData;

        if (!examData) {
            logger.error('Exam exercise detail state missing exam data', LogCategory.VIEW);
            return;
        }
        if (!exerciseData) {
            logger.error('Exam exercise detail state missing exercise data', LogCategory.VIEW);
            return;
        }

        const studentExam = examData.studentExam;
        const exam = studentExam.exam;

        let startTime: number;
        if (exam?.testExam && studentExam.startedDate) {
            startTime = new Date(studentExam.startedDate).getTime();
        } else if (exam?.startDate) {
            startTime = new Date(exam.startDate).getTime();
        } else {
            startTime = Date.now();
        }
        const endTime = startTime + ((studentExam.workingTime || 0) * 1000);
        const totalDuration = (studentExam.workingTime || 0) * 1000;

        this._postMessage({
            type: ExtensionMsg.ExamExerciseDetailInit,
            exerciseData: exerciseData as ExerciseDetailsResponse,
            examContext: {
                courseId: examData.courseId,
                examId: examData.examId,
                studentExam,
                endTime,
                startTime,
                totalDuration,
            },
            hideDeveloperTools: !this._isDeveloperMode(),
        });
    }

    public sendAiConfigInit(): void {
        const aiExtensions = this._getAppStateManager().aiExtensions || [];
        this._postMessage({ type: ExtensionMsg.AiConfigInit, aiExtensions });
    }

    public sendStruggleDetectionInit(): void {
        const telemetry = this._getTelemetryManager();
        const ctx = telemetry?.getStruggleContext();
        this._postMessage({
            type: ExtensionMsg.StruggleDetectionInit,
            isStruggling: ctx?.isStruggling ?? false,
            eq: ctx?.eq ?? 0,
            eqConfidence: ctx?.eqConfidence ?? 'insufficient',
            triggerType: ctx?.triggerType,
            recommendedAction: ctx?.recommendedAction ?? 'none',
            isEnabled: telemetry?.isEnabled() ?? false,
        });
    }

    public sendServiceStatusInit(): void {
        const serverUrl = this._getAppStateManager().userInfo?.serverUrl;
        this._postMessage({ type: ExtensionMsg.ServiceStatusInit, serverUrl });
    }

    public sendRecommendedExtensionsInit(): void {
        const categories = this._getAppStateManager().recommendedExtensions || [];
        const mappedCategories = categories.map(category => ({
            ...category,
            extensions: category.extensions.map(ext => ({
                ...ext,
                isInstalled: ext.isInstalled ?? false
            }))
        }));
        this._postMessage({ type: ExtensionMsg.RecommendedExtensionsInit, categories: mappedCategories });
    }

    public sendGitCredentialsInit(): void {
        // Safe cast: RequestGitIdentity has undefined payload, so the literal
        // is structurally correct as a WebviewToExtensionMessage command variant.
        this._getMessageHandler().handleMessage({
            type: 'command',
            command: WebviewCmd.RequestGitIdentity,
        } as WebviewToExtensionMessage);
    }

    public sendLoginInit(): void {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const serverUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
        this._postMessage({ type: ExtensionMsg.SetServerUrl, serverUrl });
    }

    /**
     * Check workspace status against all participation repo URIs for an exercise.
     * Returns the first connected match, or the last result if none match.
     */
    private async _detectWorkspaceForExercise(repoUris: string[]): Promise<WorkspaceStatus> {
        for (const uri of repoUris) {
            const status = await getWorkspaceStatus(uri);
            if (status.isConnected) {
                return status;
            }
        }
        // No match found — return disconnected status
        return { isConnected: false, hasChanges: false, isPracticeRepo: false };
    }

    private _isDeveloperMode(): boolean {
        const config = vscode.workspace.getConfiguration('artemis');
        return config.get<boolean>('developerMode', false);
    }
}
