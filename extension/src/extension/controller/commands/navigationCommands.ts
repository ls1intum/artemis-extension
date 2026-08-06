import * as vscode from 'vscode';

import type { CourseDetailData, WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, getPayload, WebviewCmd } from '@shared/messageContracts';
import { toCourseDetailData } from '@shared/messageContracts';

import { fetchAndEnrichExerciseDetails, fetchArchivedCourseDetail } from '@extension/controller/exerciseDataLoader';
import { logger } from '@extension/services/loggingService';

import type { CommandContext, CommandMap } from './types';

export class NavigationCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.ShowAllCourses]: this.handleShowAllCourses,
            [WebviewCmd.ViewCourseDetails]: this.handleViewCourseDetails,
            [WebviewCmd.BackToDashboard]: this.handleBackToDashboard,
            [WebviewCmd.OpenExerciseDetails]: this.handleOpenExerciseDetails,
            [WebviewCmd.BackToCourseDetails]: this.handleBackToCourseDetails,
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
        };
    }

    private handleShowAllCourses = async (_message: WebviewToExtensionMessage): Promise<void> => {
        await this.context.actionHandler.showCourseList();
    };

    private handleViewCourseDetails = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { courseId } = getPayload<WebCmd<'viewCourseDetails'>>(message);
            // BEFORE the fetch below, per `CommandContext.sessionEpoch`. A
            // logout, a 401 or a server change can land while that request is
            // open, and reading the epoch afterwards would stamp this server's
            // course with the NEW session's generation, which is exactly the
            // write the guard exists to reject.
            const epoch = this.context.sessionEpoch();
            const cached = this.context.appStateManager.coursesData
                ?.courses
                ?.find(e => e.course?.id === courseId);

            let courseDTO = cached?.course;
            if (!courseDTO) {
                const fetched = await this.context.artemisApi.getCourseForDashboard(courseId);
                courseDTO = fetched.course;
            }

            const detail = toCourseDetailData(courseDTO);
            if (!detail) {
                logger.viewError(`Course ${courseId} resolved without a valid id; cannot show`);
                vscode.window.showErrorMessage('Course data is incomplete');
                return;
            }

            await this.processCourseDetails(detail, epoch);
        } catch (error: unknown) {
            logger.viewError('View course details error:', error);
            vscode.window.showErrorMessage('Error viewing course details');
        }
    };

    /** `epoch` is captured by the caller, before the fetch it may have issued. */
    private async processCourseDetails(detail: CourseDetailData, epoch: number): Promise<void> {
        const course = detail.course;
        const courseId = course.id;

        this.context.appStateManager.showCourseDetail(detail);
        // Gated on the caller's epoch, like the catalog write below: the scope
        // this recency entry is filed under is resolved at write time, so a
        // session change during the fetch would put this course into the new
        // account's persisted history.
        this.context.courseAccessStorage?.onCourseAccessed(courseId, epoch);

        // Writes the catalog's supplemental layer rather than the registry
        // directly: the registry is rebuilt from the catalog projection now
        // (Task 5), so a direct registry write would be data the next catalog
        // event silently discards.
        this.context.courseCatalog?.upsertSupplemental({
            kind: 'course',
            entry: { course: { id: courseId, title: course.title, shortName: course.shortName, exercises: course.exercises } },
        }, epoch);

        this.context.actionHandler.render();
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

    private handleBackToCourseDetails = async (_message: WebviewToExtensionMessage): Promise<void> => {
        this.context.appStateManager.backToCourseDetails();
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
            if (this.context.courseCatalog) {
                await this.context.courseCatalog.fetch({ force: true });
            }
            this.context.appStateManager.showCourseList();
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
                // Fetch fresh course data from the single-course dashboard endpoint.
                const dashboardDTO = await this.context.artemisApi.getCourseForDashboard(courseId);
                const courseData = toCourseDetailData(dashboardDTO.course);
                if (!courseData) {
                    logger.viewError(`Reload course detail: course ${courseId} resolved without a valid id`);
                    vscode.window.showErrorMessage('Course data is incomplete');
                    this.context.actionHandler.sendInitData();
                    return;
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

            const exerciseId: number | undefined = payload.exerciseId ?? currentData?.exercise?.id;

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
        // Before the fetch, per `CommandContext.sessionEpoch`. The course id
        // was chosen by THIS session; recording it after an identity change
        // would file it under the next account's recency key.
        const epoch = this.context.sessionEpoch();
        try {
            vscode.window.showInformationMessage('Loading archived course details...');

            const courseData = await fetchArchivedCourseDetail(this.context.artemisApi, courseId);
            this.context.appStateManager.showCourseDetail(courseData);
            this.context.courseAccessStorage?.onCourseAccessed(courseId, epoch);
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
                        const mapped = toCourseDetailData(courseEntry.course);
                        if (mapped) {
                            parentCourseDetailData = mapped;
                            logger.view(`[Navigation] Found parent course for exercise ${exerciseId} via courseId: ${courseEntry.course.title}`);
                        }
                    }
                }

                // Fallback: scan all courses for the exercise
                if (!parentCourseDetailData) {
                    for (const courseEntry of coursesData.courses) {
                        const exercises = courseEntry?.course?.exercises || [];
                        const foundExercise = exercises.find((ex) => ex?.id === exerciseId);

                        if (foundExercise && courseEntry.course) {
                            const mapped = toCourseDetailData(courseEntry.course);
                            if (mapped) {
                                parentCourseDetailData = mapped;
                                logger.view(`[Navigation] Found parent course for exercise ${exerciseId}: ${courseEntry.course.title}`);
                                break;
                            }
                        }
                    }
                }
            }

            if (!parentCourseDetailData) {
                logger.viewError(`Could not find parent course for exercise ${exerciseId}`);
                vscode.window.showErrorMessage('Could not locate the course for this exercise.');
                return;
            }
            this.context.appStateManager.showCourseDetail(parentCourseDetailData);
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

            await this.context.actionHandler.openExerciseFullscreen(exerciseData);
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
}
