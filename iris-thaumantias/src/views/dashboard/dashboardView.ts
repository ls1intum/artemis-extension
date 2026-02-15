import * as vscode from 'vscode';
import { IconDefinitions } from '../../utils/iconDefinitions';
import { readCssFiles } from '../utils';
import { ButtonComponent } from '../components/button/buttonComponent';
import { ReloadButton } from '../components/button/iconButtons';
import { ListItemComponent } from '../components/listItem/listItemComponent';
import { ContainerComponent } from '../components/container/containerComponent';

interface DashboardIcons {
    course: string;
    artemisLogo: string;
    gear: string;
    star4: string;
    stethoscope: string;
    logout: string;
    puzzle: string;
    exercise: string;
    git: string;
    bug: string;
    target: string;
}

interface UserInfo {
    username: string;
    serverUrl: string;
    user?: unknown;
}

interface CourseData {
    course: {
        id?: number;
        title: string;
        exercises?: Exercise[];
        startDate?: string;
        creationDate?: string;
    };
}

interface Exercise {
    id?: number;
    title?: string;
    type?: string;
    releaseDate?: string;
    startDate?: string;
    dueDate?: string;
}

interface RecentCourseNode {
    courseData: CourseData;
    exercises: Exercise[];
}

export class DashboardView {
    private static readonly RECENT_COURSE_LIMIT = 3;
    private static readonly RECENT_EXERCISE_LIMIT = 4;

    private readonly _extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this._extensionContext = extensionContext;
    }

    public generateHtml(
        _userInfo: UserInfo,
        coursesData: { courses?: CourseData[] } | undefined,
        webview?: vscode.Webview
    ): string {
        const styles = readCssFiles(
            'dashboard/dashboard.css',
            'components/button/button.css',
            'components/button/iconButtons/iconButtons.css',
            'components/listItem/list-item.css',
            'components/container/container.css'
        );

        return this._buildDashboardHtml({
            coursesData,
            webview,
            styles
        });
    }

    private _loadIcons(): DashboardIcons {
        return {
            course: IconDefinitions.getIcon('course'),
            artemisLogo: IconDefinitions.getIcon('artemis-logo'),
            gear: IconDefinitions.getIcon('gear'),
            star4: IconDefinitions.getIcon('star-4-edges'),
            stethoscope: IconDefinitions.getIcon('stethoscope'),
            logout: IconDefinitions.getIcon('logout'),
            puzzle: IconDefinitions.getIcon('puzzle'),
            exercise: IconDefinitions.getIcon('exercise'),
            git: IconDefinitions.getIcon('git'),
            bug: IconDefinitions.getIcon('bug'),
            target: IconDefinitions.getIcon('target')
        };
    }

    private _buildDashboardHtml(options: {
        coursesData: { courses?: CourseData[] } | undefined;
        webview: vscode.Webview | undefined;
        styles: string;
    }): string {
        const { coursesData, webview, styles } = options;
        const icons = this._loadIcons();

        const artemisLogoSrc = this._getWebviewImageUri(webview, 'media/artemis-blue.png');

        const { recentCoursesHtml, recentCoursesJson } = this._buildRecentCoursesTreeData(coursesData?.courses);

        const recentCoursesContainer = ContainerComponent.generate({
            className: 'recent-courses',
            listMode: true,
            header: {
                title: 'Recent Courses',
                actionsHtml: `
                    <div class="recent-courses-controls">
                        ${ButtonComponent.generate({
                    label: 'Show All',
                    variant: 'link',
                    command: 'showAllCourses()',
                    className: 'show-all-link',
                    height: '1rem'
                })}
                        ${ReloadButton.generate({
                    id: 'reloadDashboardBtn',
                    command: 'reloadDashboard()',
                    title: 'Reload Courses'
                })}
                    </div>
                `,
                divider: true
            },
            bodyHtml: `
                <div class="recent-courses-tree" id="recentCoursesTree">
                    ${recentCoursesHtml}
                </div>
            `
        });

        const welcomeContainer = ContainerComponent.generate({
            className: 'dashboard-header',
            bodyHtml: `
                <h1 class="dashboard-title">
                    ${artemisLogoSrc ? `<a href="#" onclick="openArtemisWebsite(); return false;" class="artemis-logo-link"><img src="${artemisLogoSrc}" alt="Artemis Logo" class="artemis-header-logo" /></a>` : ''}
                    <span>Welcome to <a href="#" onclick="openArtemisWebsite(); return false;" class="artemis-title-link">Artemis</a></span>
                </h1>
                <p class="dashboard-subtitle">Your programming learning companion</p>
            `
        });

        // Workspace Exercise Container - separate from Tools & Settings
        const workspaceExerciseContainer = ContainerComponent.generate({
            className: 'workspace-exercise-section hidden',
            id: 'workspaceExerciseContainer',
            padding: 'tight',
            header: {
                title: 'Current Workspace Exercise',
                divider: false
            },
            bodyHtml: `
                ${ListItemComponent.generate(
                {
                    className: 'workspace-exercise-item',
                    clickable: true,
                    command: 'goToWorkspaceExercise()',
                    id: 'workspaceExerciseItemBtn'
                },
                `
                        <div class="workspace-exercise-content">
                            <div class="workspace-exercise-icon">${icons.exercise}</div>
                            <div class="workspace-exercise-text">
                                <div class="workspace-exercise-name" id="workspaceExerciseName">Loading...</div>
                            </div>
                            <div class="workspace-exercise-arrow">→</div>
                        </div>
                    `
            )}
            `
        });

        const quickActionsBody = `
            <div class="action-buttons">
                ${ButtonComponent.generate({
            label: 'Browse Courses',
            icon: icons.course,
            variant: 'primary',
            id: 'browseCoursesBtn',
            command: 'document.getElementById("browseCoursesBtn").click()',
            fullWidth: true
        })}
                ${ButtonComponent.generate({
            label: 'Open Settings',
            icon: icons.gear,
            variant: 'primary',
            id: 'openSettingsBtn',
            command: 'document.getElementById("openSettingsBtn").click()',
            fullWidth: true
        })}
                ${ButtonComponent.generate({
            label: 'AI Checker',
            icon: icons.star4,
            variant: 'secondary',
            id: 'checkAiConfigBtn',
            command: 'document.getElementById("checkAiConfigBtn").click()',
            fullWidth: true
        })}
                ${ButtonComponent.generate({
            label: 'Recommended Extensions',
            icon: icons.puzzle,
            variant: 'secondary',
            id: 'recommendedExtensionsBtn',
            command: 'document.getElementById("recommendedExtensionsBtn").click()',
            fullWidth: true
        })}
                ${ButtonComponent.generate({
            label: 'Open Artemis in browser',
            icon: icons.artemisLogo,
            variant: 'secondary',
            id: 'openWebsiteBtn',
            command: 'document.getElementById("openWebsiteBtn").click()',
            fullWidth: true
        })}
                ${ButtonComponent.generate({
            label: 'Logout from Artemis',
            icon: icons.logout,
            variant: 'secondary',
            className: 'btn-danger',
            id: 'logoutBtn',
            command: 'document.getElementById("logoutBtn").click()',
            fullWidth: true
        })}
            </div>
            <div class="toggle-more-container">
                ${ButtonComponent.generate({
            label: 'Show more',
            variant: 'link',
            id: 'toggleMoreActionsBtn',
            command: 'toggleMoreActions()',
            className: 'toggle-more-btn',
            height: '1.5rem'
        })}
            </div>
            <div class="hidden-actions" id="hiddenActionsContainer" style="display: none;">
                <div class="action-buttons">
                    ${ButtonComponent.generate({
            label: 'Struggle Detection',
            icon: icons.target,
            variant: 'secondary',
            id: 'struggleDetectionBtn',
            command: 'document.getElementById("struggleDetectionBtn").click()',
            fullWidth: true
        })}
                    ${ButtonComponent.generate({
            label: 'Service Status',
            icon: icons.stethoscope,
            variant: 'secondary',
            id: 'serviceStatusBtn',
            command: 'document.getElementById("serviceStatusBtn").click()',
            fullWidth: true
        })}
                    ${ButtonComponent.generate({
            label: 'Git Credentials',
            icon: icons.git,
            variant: 'secondary',
            id: 'gitCredentialsBtn',
            command: 'document.getElementById("gitCredentialsBtn").click()',
            fullWidth: true
        })}
                    ${ButtonComponent.generate({
            label: 'Bug Report',
            icon: icons.bug,
            variant: 'secondary',
            id: 'bugReportBtn',
            command: 'document.getElementById("bugReportBtn").click()',
            fullWidth: true
        })}
                </div>
            </div>
        `;

        const quickActionsContainer = ContainerComponent.generate({
            className: 'quick-actions',
            header: {
                title: 'Tools & Settings',
                divider: true
            },
            bodyHtml: quickActionsBody
        });

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Artemis Dashboard</title>
    <style>
        ${styles}
    </style>
</head>
<body>
    <div class="dashboard">
        ${welcomeContainer}

        ${workspaceExerciseContainer}

        ${recentCoursesContainer}

        ${quickActionsContainer}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const recentCoursesData = ${recentCoursesJson};

        // Open Artemis website
        window.openArtemisWebsite = function() {
            vscode.postMessage({ command: 'openWebsite' });
        };

        // Reload dashboard
        window.reloadDashboard = function() {
            vscode.postMessage({ command: 'reloadDashboard' });
        };

        // Dashboard action buttons
        const browseCoursesBtn = document.getElementById('browseCoursesBtn');
        const checkAiConfigBtn = document.getElementById('checkAiConfigBtn');
        const recommendedExtensionsBtn = document.getElementById('recommendedExtensionsBtn');
        const openWebsiteBtn = document.getElementById('openWebsiteBtn');
        const struggleDetectionBtn = document.getElementById('struggleDetectionBtn');
        const serviceStatusBtn = document.getElementById('serviceStatusBtn');
        const gitCredentialsBtn = document.getElementById('gitCredentialsBtn');
        const bugReportBtn = document.getElementById('bugReportBtn');
        const openSettingsBtn = document.getElementById('openSettingsBtn');
        const logoutBtn = document.getElementById('logoutBtn');

        // Workspace exercise detection
        let workspaceExerciseId = null;

        window.goToWorkspaceExercise = function() {
            if (workspaceExerciseId) {
                vscode.postMessage({
                    command: 'openExercise',
                    exerciseId: workspaceExerciseId,
                    courseId: null // Will be looked up from the exercise
                });
            }
        };

        // Request workspace exercise detection
        vscode.postMessage({ command: 'detectWorkspaceExercise' });

        // Event listeners
        if (browseCoursesBtn) {
            browseCoursesBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'showAllCourses' });
            });
        }

        if (checkAiConfigBtn) {
            checkAiConfigBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'showAiConfig' });
            });
        }

        if (recommendedExtensionsBtn) {
            recommendedExtensionsBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'showRecommendedExtensions' });
            });
        }

        if (openWebsiteBtn) {
            openWebsiteBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'openWebsite' });
            });
        }

        if (struggleDetectionBtn) {
            struggleDetectionBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'showStruggleDetection' });
            });
        }

        if (serviceStatusBtn) {
            serviceStatusBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'showServiceStatus' });
            });
        }

        if (gitCredentialsBtn) {
            gitCredentialsBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'showGitCredentials' });
            });
        }

        if (bugReportBtn) {
            bugReportBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'openBugReport' });
            });
        }

        if (openSettingsBtn) {
            openSettingsBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'openSettings' });
            });
        }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'logout' });
            });
        }

        // Toggle more actions functionality
        window.toggleMoreActions = function() {
            const hiddenContainer = document.getElementById('hiddenActionsContainer');
            const toggleBtn = document.getElementById('toggleMoreActionsBtn');

            if (hiddenContainer && toggleBtn) {
                const isHidden = hiddenContainer.style.display === 'none';
                hiddenContainer.style.display = isHidden ? 'block' : 'none';
                toggleBtn.textContent = isHidden ? 'Show less' : 'Show more';
            }
        };

        // Recent courses functionality
        window.showAllCourses = function() {
            vscode.postMessage({ command: 'showAllCourses' });
        };

        window.openRecentCourse = function(courseIndex) {
            const recentCourseNode = recentCoursesData && recentCoursesData[courseIndex];
            if (!recentCourseNode || !recentCourseNode.courseData) {
                return;
            }

            vscode.postMessage({
                command: 'viewCourseDetails',
                courseData: recentCourseNode.courseData
            });
        };

        window.openRecentExercise = function(courseIndex, exerciseIndex) {
            const recentCourseNode = recentCoursesData && recentCoursesData[courseIndex];
            if (!recentCourseNode || !recentCourseNode.exercises) {
                return;
            }

            const exercise = recentCourseNode.exercises[exerciseIndex];
            if (!exercise || !exercise.id) {
                return;
            }

            vscode.postMessage({
                command: 'openExercise',
                exerciseId: exercise.id
            });
        };

        window.toggleRecentCourseChildren = function(courseIndex, event) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }

            const courseNode = document.querySelector('.recent-tree-course-node[data-tree-course-index="' + courseIndex + '"]');
            if (!courseNode) {
                return;
            }

            const isExpanded = courseNode.classList.toggle('is-expanded');
            const toggleButton = courseNode.querySelector('.recent-tree-toggle');
            if (toggleButton) {
                toggleButton.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            }
        };

        // Enable keyboard navigation for list items
        ${ListItemComponent.generateScript()}
        ${ContainerComponent.generateScript()}

        // Listen for workspace exercise detection results
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'workspaceExerciseDetected') {
                const workspaceContainer = document.getElementById('workspaceExerciseContainer');
                const workspaceNameEl = document.getElementById('workspaceExerciseName');

                if (message.exerciseId && message.exerciseTitle) {
                    workspaceExerciseId = message.exerciseId;

                    if (workspaceNameEl) {
                        workspaceNameEl.textContent = message.exerciseTitle;
                    }
                    if (workspaceContainer) {
                        workspaceContainer.classList.remove('hidden');
                    }
                } else {
                    if (workspaceContainer) {
                        workspaceContainer.classList.add('hidden');
                    }
                }
            }
        });
    </script>
</body>
</html>`;
    }

    private _getWebviewImageUri(webview: vscode.Webview | undefined, relativePath: string): string {
        if (!webview) {
            return '';
        }
        const uri = vscode.Uri.file(this._extensionContext.asAbsolutePath(relativePath));
        return webview.asWebviewUri(uri).toString();
    }

    private _getExerciseTimestamp(exercise: Exercise): number {
        const date = exercise.releaseDate || exercise.startDate || exercise.dueDate;
        if (!date) {
            return 0;
        }

        const timestamp = new Date(date).getTime();
        return Number.isNaN(timestamp) ? 0 : timestamp;
    }

    private _getLatestExerciseTimestamp(courseData: CourseData): number {
        const exercises = courseData.course.exercises || [];
        if (exercises.length === 0) {
            return 0;
        }

        return exercises.reduce((latest: number, exercise: Exercise) => {
            const timestamp = this._getExerciseTimestamp(exercise);
            return timestamp > latest ? timestamp : latest;
        }, 0);
    }

    private _sortExercisesByLatest(exercises: Exercise[]): Exercise[] {
        return [...exercises].sort((a, b) => {
            const dateDiff = this._getExerciseTimestamp(b) - this._getExerciseTimestamp(a);
            if (dateDiff !== 0) {
                return dateDiff;
            }

            return (b.id || 0) - (a.id || 0);
        });
    }

    private _sortCoursesByLatestExercise(courses: CourseData[]): CourseData[] {
        return [...courses].sort((a, b) => {
            const dateDiff = this._getLatestExerciseTimestamp(b) - this._getLatestExerciseTimestamp(a);
            if (dateDiff !== 0) {
                return dateDiff;
            }

            const aTitle = a.course.title || '';
            const bTitle = b.course.title || '';
            return aTitle.localeCompare(bTitle);
        });
    }

    private _buildRecentCourseNodes(courses: CourseData[]): RecentCourseNode[] {
        return this._sortCoursesByLatestExercise(courses)
            .slice(0, DashboardView.RECENT_COURSE_LIMIT)
            .map((courseData) => ({
                courseData,
                exercises: this._sortExercisesByLatest(courseData.course.exercises || []).slice(0, DashboardView.RECENT_EXERCISE_LIMIT)
            }));
    }

    private _buildRecentCoursesTreeData(courses: CourseData[] | undefined): {
        recentCoursesHtml: string;
        recentCoursesJson: string;
    } {
        if (!courses) {
            return {
                recentCoursesHtml: '<div class="no-courses">Loading courses...</div>',
                recentCoursesJson: 'null'
            };
        }

        const chevronRightIcon = IconDefinitions.getIcon('chevron-right');
        const recentCourseNodes = this._buildRecentCourseNodes(courses);

        if (recentCourseNodes.length === 0) {
            return {
                recentCoursesHtml: '<div class="no-courses">No recent courses available</div>',
                recentCoursesJson: '[]'
            };
        }

        const recentCoursesHtml = recentCourseNodes.map((node, courseIndex) => {
            const { courseData, exercises } = node;
            const course = courseData.course;
            const isExpanded = courseIndex === 0;
            const exerciseCount = course.exercises?.length || 0;

            const courseItemHtml = ListItemComponent.generate(
                {
                    className: 'recent-tree-course-item',
                    clickable: true,
                    command: `openRecentCourse(${courseIndex})`,
                    dataAttributes: {
                        'course-index': courseIndex.toString(),
                        'course-id': course.id?.toString() || ''
                    }
                },
                `
                    <div class="course-title">${this._escapeHtml(course.title)}</div>
                    <div class="course-info">${exerciseCount} ${exerciseCount === 1 ? 'exercise' : 'exercises'}</div>
                `
            );

            const exercisesHtml = exercises.length > 0
                ? exercises.map((exercise, exerciseIndex) => {
                    const exerciseIcon = IconDefinitions.getIcon(exercise.type || 'exercise');
                    const exerciseTitle = this._escapeHtml(exercise.title || 'Untitled exercise');

                    return ListItemComponent.generate(
                        {
                            className: 'recent-tree-exercise-item',
                            clickable: true,
                            command: `openRecentExercise(${courseIndex}, ${exerciseIndex})`,
                            dataAttributes: {
                                'exercise-id': exercise.id?.toString() || ''
                            }
                        },
                        `
                            <div class="recent-tree-exercise-content">
                                <span class="recent-tree-exercise-icon">${exerciseIcon}</span>
                                <span class="recent-tree-exercise-title">${exerciseTitle}</span>
                            </div>
                        `
                    );
                }).join('')
                : '<div class="recent-tree-empty">No exercises available</div>';

            return `
                <div class="recent-tree-course-node ${isExpanded ? 'is-expanded' : ''}" data-tree-course-index="${courseIndex}">
                    <div class="recent-tree-course-row">
                        <button
                            type="button"
                            class="recent-tree-toggle"
                            aria-label="Toggle exercises"
                            aria-expanded="${isExpanded ? 'true' : 'false'}"
                            aria-controls="recentTreeChildren-${courseIndex}"
                            onclick="toggleRecentCourseChildren(${courseIndex}, event)"
                        >
                            ${chevronRightIcon}
                        </button>
                        ${courseItemHtml}
                    </div>
                    <div class="recent-tree-children" id="recentTreeChildren-${courseIndex}">
                        ${exercisesHtml}
                    </div>
                </div>
            `;
        }).join('');

        return {
            recentCoursesHtml,
            recentCoursesJson: JSON.stringify(recentCourseNodes)
        };
    }

    private _escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
