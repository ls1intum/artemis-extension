import * as vscode from 'vscode';
import { getExamErrorMessage } from '../../services/exam/examErrorHandler';
import type { CommandContext, CommandMap } from './types';
import { logger } from '../../services/loggingService';
import { getPayload, ExtensionMsg, WebviewCmd } from '../../../shared/messageContracts';
import type {
    WebviewToExtensionMessage,
    WebCmd,
    ExerciseDetail,
    CourseDetailData,
} from '../../../shared/messageContracts';
import { toCourseDetailData } from '../../../shared/messageContracts';
import { fetchAndEnrichExerciseDetails, fetchArchivedCourseDetail } from '../exerciseDataLoader';
import type {
    CourseDashboardCourse,
    CourseDashboardEntry,
    ExamSummary,
    ExerciseDetailsResponse,
} from '../../types';


export class NavigationCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.ShowAllCourses]: this.handleShowAllCourses,
            [WebviewCmd.ViewCourseDetails]: this.handleViewCourseDetails,
            [WebviewCmd.BackToDashboard]: this.handleBackToDashboard,
            [WebviewCmd.OpenExerciseDetails]: this.handleOpenExerciseDetails,
            [WebviewCmd.OpenExamExerciseDetails]: this.handleOpenExamExerciseDetails,
            [WebviewCmd.BackToCourseDetails]: this.handleBackToCourseDetails,
            [WebviewCmd.BackToExam]: this.handleBackToExam,
            [WebviewCmd.ShowAiConfig]: this.handleShowAiConfig,
            [WebviewCmd.ShowServiceStatus]: this.handleShowServiceStatus,
            [WebviewCmd.ShowStruggleDetection]: this.handleShowStruggleDetection,
            [WebviewCmd.ShowRecommendedExtensions]: this.handleShowRecommendedExtensions,
            [WebviewCmd.ShowGitCredentials]: this.handleShowGitCredentials,
            [WebviewCmd.LoadArchivedCourses]: this.handleLoadArchivedCourses,
            [WebviewCmd.ReloadCourses]: this.handleReloadCourses,
            [WebviewCmd.ReloadDashboard]: this.handleReloadDashboard,
            [WebviewCmd.ReloadCourseDetail]: this.handleReloadCourseDetail,
            [WebviewCmd.ReloadExerciseDetail]: this.handleReloadExerciseDetail,
            [WebviewCmd.ViewArchivedCourse]: this.handleViewArchivedCourse,
            [WebviewCmd.OpenExercise]: this.handleOpenExercise,
            [WebviewCmd.ToggleFullscreen]: this.handleToggleFullscreen,
            [WebviewCmd.ToggleCourseFullscreen]: this.handleToggleCourseFullscreen,
            [WebviewCmd.ToggleCourseListFullscreen]: this.handleToggleCourseListFullscreen,
            [WebviewCmd.OpenExam]: this.handleOpenExam,
            [WebviewCmd.RefreshExam]: this.handleRefreshExam,
            [WebviewCmd.ReloadExamConduction]: this.handleReloadExamConduction,
            [WebviewCmd.OpenExamInBrowser]: this.handleOpenExamInBrowser,
        };
    }

    private handleOpenExamInBrowser = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { courseId, examId } = getPayload<WebCmd<'openExamInBrowser'>>(message);
            const serverUrl = this.context.appStateManager.userInfo?.serverUrl;
            if (serverUrl) {
                const url = `${serverUrl}/courses/${courseId}/exams/${examId}`;
                await vscode.env.openExternal(vscode.Uri.parse(url));
            } else {
                vscode.window.showErrorMessage('Could not determine Artemis server URL.');
            }
        } catch (error: unknown) {
            logger.viewError('Error opening exam in browser:', error);
            vscode.window.showErrorMessage('Failed to open exam in browser.');
        }
    };

    private handleOpenExam = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { courseId, examId } = getPayload<WebCmd<'openExam'>>(message);
            logger.view(`Handling openExam for course ${courseId}, exam ${examId}`);
            const studentExam = await this.context.artemisApi.getOwnStudentExam(courseId, examId);
            logger.view(`Fetched student exam:`, studentExam);

            if (studentExam.started) {
                logger.view(`Exam already started, proceeding to conduction`);
                // If already started, go directly to conduction (to be implemented)
                // For now, we can reuse the start exam logic which will fetch conduction details
                const studentExamId = studentExam.id ?? 0;
                await this._startExamWithPayload({ courseId, examId, studentExamId });
            } else {
                logger.view(`Exam not started, showing start view`);
                // Show start exam view
                this.context.appStateManager.showExamStart({ studentExam, courseId, examId });
                this.context.actionHandler.render();
            }
        } catch (error: unknown) {
            logger.viewError('Error opening exam:', error);
            const userMessage = getExamErrorMessage(error);
            vscode.window.showErrorMessage(userMessage);
        }
    };


    private async _startExamWithPayload(payload: { courseId: number; examId: number; studentExamId: number }): Promise<void> {
        try {
            const { courseId, examId, studentExamId } = payload;
            logger.view(`Starting exam ${examId} for student exam ${studentExamId}`);
            const conductionDetails = await this.context.artemisApi.startStudentExam(courseId, examId, studentExamId);

            logger.view('Exam started, conduction details:', conductionDetails);

            // Show conduction view
            this.context.appStateManager.showExamConduction({ studentExam: conductionDetails, courseId, examId });
            this.context.actionHandler.render();

        } catch (error: unknown) {
            logger.viewError('Error starting exam:', error);
            vscode.window.showErrorMessage('Failed to start exam.');
        }
    }

    private handleShowAllCourses = async (_message: WebviewToExtensionMessage): Promise<void> => {
        await this.context.actionHandler.showCourseList();
    };

    private handleViewCourseDetails = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { courseData } = getPayload<WebCmd<'viewCourseDetails'>>(message);
            await this.processCourseDetails(courseData);
        } catch (error: unknown) {
            logger.viewError('View course details error:', error);
            vscode.window.showErrorMessage('Error viewing course details');
        }
    };

    private async processCourseDetails(courseData: CourseDashboardEntry | CourseDashboardCourse): Promise<void> {
        try {
            const course: CourseDashboardCourse | undefined = 'course' in courseData
                ? (courseData.course as CourseDashboardCourse | undefined)
                : courseData;

            // TODO: Exams temporarily disabled
            // if (course?.id) {
            //     try {
            //         const exams = await this.context.artemisApi.getExamsForCourse(course.id);
            //         course.exams = exams;
            //     } catch (error: unknown) {
            //         logger.apiError('Error fetching exams:', error);
            //     }
            // }

            // Convert to CourseDetailData format expected by state manager
            const courseDetailData = toCourseDetailData(
                ('course' in courseData ? courseData.course! : courseData) as CourseDashboardCourse
            );

            this.context.appStateManager.showCourseDetail(courseDetailData);

            const registry = this.context.exerciseRegistry;
            // Pass the entry format for registration (expects CourseDashboardEntry)
            const entryFormat: CourseDashboardEntry = 'course' in courseData ? courseData : { course: courseData };
            registry.registerFromCourseData(entryFormat);

            const chatProvider = this.context.providerRegistry.getChatWebviewProvider();
            if (course) {
                const courseTitle = course.title || 'Untitled Course';
                const courseId = course.id || 0;
                const shortName = course.shortName;

                if (chatProvider && typeof chatProvider.updateDetectedCourse === 'function') {
                    chatProvider.updateDetectedCourse(courseTitle, courseId, shortName);
                    logger.view('📚 [Course Detection] Notified chat about course:', courseTitle);
                }

                if (course.exercises && Array.isArray(course.exercises) && chatProvider && typeof chatProvider.updateDetectedExercise === 'function') {
                    course.exercises.forEach((exercise) => {
                        // Type guard: exercise is from CourseDashboardCourse which uses optional fields
                        if (exercise && typeof exercise === 'object' && 'studentParticipations' in exercise &&
                            Array.isArray(exercise.studentParticipations) && exercise.studentParticipations.length > 0) {
                            const exerciseTitle = exercise.title ?? 'Untitled Exercise';
                            const exerciseId = exercise.id ?? 0;
                            const releaseDate = exercise.releaseDate ?? exercise.startDate;
                            const dueDate = exercise.dueDate;
                            const shortName = exercise.shortName;

                            chatProvider.updateDetectedExercise(exerciseTitle, exerciseId, releaseDate, dueDate, shortName, courseId);
                            logger.view(`📚 [Course Exercises] Updated exercise from course: ${exerciseTitle} (ID: ${exerciseId})`);
                        }
                    });
                }
            }

            this.context.actionHandler.render();
        } catch (error: unknown) {
            logger.viewError('View course details error:', error);
            vscode.window.showErrorMessage('Error viewing course details');
        }
    }

    private handleBackToDashboard = async (_message: WebviewToExtensionMessage): Promise<void> => {
        const userInfo = this.context.appStateManager.userInfo;
        if (userInfo) {
            await this.context.actionHandler.showDashboard(userInfo);
        }
    };

    private handleOpenExerciseDetails = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { exerciseId } = getPayload<WebCmd<'openExerciseDetails'>>(message);
            await this.context.actionHandler.openExerciseDetails(exerciseId);
        } catch (error: unknown) {
            logger.viewError('Open exercise details error:', error);
            vscode.window.showErrorMessage('Error opening exercise details');
        }
    };

    private handleOpenExamExerciseDetails = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { exercise, exerciseIndex, courseId, examId } = getPayload<WebCmd<'openExamExerciseDetails'>>(message);
            await this.context.actionHandler.openExamExerciseDetails(exercise, exerciseIndex, courseId, examId);
        } catch (error: unknown) {
            logger.viewError('Open exam exercise details error:', error);
            vscode.window.showErrorMessage('Error opening exam exercise details');
        }
    };

    private handleBackToCourseDetails = async (_message: WebviewToExtensionMessage): Promise<void> => {
        this.context.appStateManager.backToCourseDetails();
        this.context.actionHandler.render();
    };

    private handleBackToExam = async (_message: WebviewToExtensionMessage): Promise<void> => {
        this.context.appStateManager.backToExam();
        this.context.actionHandler.render();
    };

    private handleShowAiConfig = async (_message: WebviewToExtensionMessage): Promise<void> => {
        this.context.actionHandler.showAiConfig();
    };

    private handleShowServiceStatus = async (_message: WebviewToExtensionMessage): Promise<void> => {
        this.context.actionHandler.showServiceStatus();
    };

    private handleShowStruggleDetection = async (_message: WebviewToExtensionMessage): Promise<void> => {
        this.context.actionHandler.showStruggleDetection();
    };

    private handleShowRecommendedExtensions = async (_message: WebviewToExtensionMessage): Promise<void> => {
        this.context.actionHandler.showRecommendedExtensions();
    };

    private handleShowGitCredentials = async (_message: WebviewToExtensionMessage): Promise<void> => {
        this.context.actionHandler.showGitCredentials();
    };

    private handleLoadArchivedCourses = async (_message: WebviewToExtensionMessage): Promise<void> => {
        try {
            vscode.window.showInformationMessage('Loading archived courses...');

            const courses = await this.context.artemisApi.getArchivedCourses();
            const archivedCourses = courses.map(course => ({
                id: course.id!,
                title: course.title || '',
                semester: course.semester,
                color: course.color
            }));
            this.context.appStateManager.setArchivedCourses(archivedCourses);
            this.context.sendMessage({
                type: ExtensionMsg.ArchivedCoursesLoaded,
                archivedCourses
            });

            const archivedCount = archivedCourses.length;
            if (archivedCount > 0) {
                vscode.window.showInformationMessage(`Loaded ${archivedCount} archived course${archivedCount === 1 ? '' : 's'}`);
            } else {
                vscode.window.showInformationMessage('No archived courses found');
            }
        } catch (error: unknown) {
            logger.viewError('Load archived courses error:', error);
            vscode.window.showErrorMessage('Error loading archived courses');
        }
    };

    private handleReloadCourses = async (_message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const coursesData = await this.context.artemisApi.getCoursesForDashboard();
            this.context.appStateManager.showCourseList(coursesData);
            this.context.actionHandler.sendInitData();
        } catch (error: unknown) {
            logger.viewError('Reload courses error:', error);
            vscode.window.showErrorMessage('Error reloading courses');
            this.context.actionHandler.sendInitData();
        }
    };

    private handleReloadDashboard = async (_message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const userInfo = this.context.appStateManager.userInfo;
            if (userInfo) {
                await this.context.actionHandler.showDashboard(userInfo);
            }
        } catch (error: unknown) {
            logger.viewError('Reload dashboard error:', error);
            vscode.window.showErrorMessage('Error reloading dashboard');
            this.context.actionHandler.sendInitData();
        }
    };

    private handleReloadCourseDetail = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'reloadCourseDetail'>>(message);
            const courseId = payload.courseId || this.context.appStateManager.currentCourseData?.course?.id;
            if (courseId) {
                // Fetch fresh course data from the single-course dashboard endpoint
                const dashboardDTO = await this.context.artemisApi.getCourseForDashboard(courseId);

                // Build CourseDetailData structure expected by showCourseDetail
                const courseData = toCourseDetailData(dashboardDTO.course as CourseDashboardCourse);

                // Fetch exams separately (not included in dashboard endpoint)
                try {
                    const exams = await this.context.artemisApi.getExamsForCourse(courseId);
                    if (courseData.course) {
                        courseData.course.exams = exams as typeof courseData.course.exams;
                    }
                } catch (error: unknown) {
                    logger.apiError('Error fetching exams during reload:', error);
                    // Continue without exams if fetch fails
                }

                this.context.appStateManager.showCourseDetail(courseData);
                // Send updated data to React without re-rendering
                this.context.actionHandler.sendInitData();
            }
        } catch (error: unknown) {
            logger.viewError('Reload course detail error:', error);
            vscode.window.showErrorMessage('Error reloading course details');
            this.context.actionHandler.sendInitData();
        }
    };

    private handleReloadExerciseDetail = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'reloadExerciseDetail'>>(message);
            const currentData = this.context.appStateManager.currentExerciseData;

            // Extract exercise ID from various possible structures
            let exerciseId: number | undefined = payload.exerciseId;
            if (!exerciseId && currentData) {
                // Check if it's ExerciseDetailsResponse format
                if ('exercise' in currentData && currentData.exercise?.id) {
                    exerciseId = currentData.exercise.id;
                }
                // Check if it's direct format (ExamExerciseData)
                else if ('id' in currentData && typeof currentData.id === 'number') {
                    exerciseId = currentData.id;
                }
            }

            if (exerciseId) {
                const data = await fetchAndEnrichExerciseDetails(this.context.artemisApi, exerciseId);
                this.context.appStateManager.showExerciseDetail(data);
                this.context.actionHandler.sendInitData();
                this.context.actionHandler.backgroundRenderProblemStatement();
            }
        } catch (error: unknown) {
            logger.viewError('Reload exercise detail error:', error);
            vscode.window.showErrorMessage('Error reloading exercise details');
            this.context.actionHandler.sendInitData();
        }
    };

    private handleViewArchivedCourse = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { courseId } = getPayload<WebCmd<'viewArchivedCourse'>>(message);
        try {
            vscode.window.showInformationMessage('Loading archived course details...');

            const courseData = await fetchArchivedCourseDetail(this.context.artemisApi, courseId);
            this.context.appStateManager.showCourseDetail(courseData);
            this.context.actionHandler.render();
        } catch (error: unknown) {
            logger.viewError('View archived course error:', error);
            vscode.window.showErrorMessage('Error viewing archived course details');
        }
    };

    private handleOpenExercise = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { exerciseId, courseId } = getPayload<WebCmd<'openExercise'>>(message);

        try {
            const coursesData = this.context.appStateManager.coursesData;
            let parentCourseDetailData: CourseDetailData | null = null;

            if (coursesData?.courses) {
                // Short-circuit: if courseId is provided, look up the course directly
                if (courseId) {
                    const courseEntry = coursesData.courses.find(c => c.course?.id === courseId);
                    if (courseEntry?.course) {
                        parentCourseDetailData = toCourseDetailData(courseEntry.course);
                        logger.view(`[Navigation] Found parent course for exercise ${exerciseId} via courseId: ${courseEntry.course.title}`);
                    }
                }

                // Fallback: scan all courses for the exercise
                if (!parentCourseDetailData) {
                    for (const courseEntry of coursesData.courses) {
                        const exercises = courseEntry?.course?.exercises || [];
                        const foundExercise = exercises.find((ex) => ex?.id === exerciseId);

                        if (foundExercise && courseEntry.course) {
                            parentCourseDetailData = toCourseDetailData(courseEntry.course);
                            logger.view(`[Navigation] Found parent course for exercise ${exerciseId}: ${courseEntry.course.title}`);
                            break;
                        }
                    }
                }
            }

            if (parentCourseDetailData) {
                this.context.appStateManager.showCourseDetail(parentCourseDetailData);
            } else {
                logger.viewWarn(`⚠️  Could not find parent course for exercise ${exerciseId}`);
            }

            await this.context.actionHandler.openExerciseDetails(exerciseId);
        } catch (error: unknown) {
            logger.viewError('Open exercise error:', error);
            vscode.window.showErrorMessage('Failed to open exercise details.');
        }
    };

    private handleToggleFullscreen = async (_message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const exerciseData = this.context.appStateManager.currentExerciseData;
            if (!exerciseData) {
                vscode.window.showErrorMessage('No exercise data available to open in fullscreen');
                return;
            }

            await this.context.actionHandler.openExerciseFullscreen(exerciseData as ExerciseDetailsResponse);
        } catch (error: unknown) {
            logger.viewError('Error opening exercise in fullscreen:', error);
            vscode.window.showErrorMessage('Failed to open exercise in fullscreen mode');
        }
    };

    private handleToggleCourseListFullscreen = async (_message: WebviewToExtensionMessage): Promise<void> => {
        try {
            await this.context.actionHandler.openCourseListFullscreen();
        } catch (error: unknown) {
            logger.viewError('Error opening course list in fullscreen:', error);
            vscode.window.showErrorMessage('Failed to open course list in fullscreen mode');
        }
    };

    private handleToggleCourseFullscreen = async (_message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const courseData = this.context.appStateManager.currentCourseData;
            if (!courseData) {
                vscode.window.showErrorMessage('No course data available to open in fullscreen');
                return;
            }

            await this.context.actionHandler.openCourseFullscreen(courseData);
        } catch (error: unknown) {
            logger.viewError('Error opening course in fullscreen:', error);
            vscode.window.showErrorMessage('Failed to open course in fullscreen mode');
        }
    };

    private handleRefreshExam = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { courseId, examId, studentExamId } = getPayload<WebCmd<'refreshExam'>>(message);
            logger.view(`Refreshing exam status for course ${courseId}, exam ${examId}`);

            const studentExam = await this.context.artemisApi.getOwnStudentExam(courseId, examId);

            if (studentExam.started) {
                logger.view(`Exam started in browser, proceeding to conduction`);
                // Proceed to conduction by fetching details
                const effectiveStudentExamId = studentExamId || studentExam.id || 0;
                await this._startExamWithPayload({ courseId, examId, studentExamId: effectiveStudentExamId });
            } else {
                vscode.window.showInformationMessage('Exam has not been started yet. Please start it in the browser.');
            }
        } catch (error: unknown) {
            logger.viewError('Error refreshing exam:', error);
            vscode.window.showErrorMessage('Failed to refresh exam status.');
        }
    };

    private handleReloadExamConduction = async (_message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const examData = this.context.appStateManager.currentExamData;
            if (!examData) {
                logger.viewError('No exam data available for reload');
                return;
            }

            const { courseId, examId } = examData;

            if (typeof courseId !== 'number' || typeof examId !== 'number') {
                logger.viewError('Invalid exam context - missing courseId or examId');
                return;
            }

            logger.view(`Reloading exam conduction for course ${courseId}, exam ${examId}`);

            const studentExam = await this.context.artemisApi.getOwnStudentExam(courseId, examId);

            if (studentExam.started && studentExam.id) {
                const conductionDetails = await this.context.artemisApi.startStudentExam(courseId, examId, studentExam.id);
                this.context.appStateManager.showExamConduction({ studentExam: conductionDetails, courseId, examId });
                this.context.actionHandler.sendInitData();
            } else {
                vscode.window.showWarningMessage('Exam has not been started yet.');
            }
        } catch (error: unknown) {
            logger.viewError('Error reloading exam conduction:', error);
            vscode.window.showErrorMessage('Failed to reload exam conduction.');
        }
    };
}
