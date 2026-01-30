import * as vscode from 'vscode';
import { VSCODE_CONFIG } from '../../utils';
import { IconDefinitions } from '../../utils/iconDefinitions';
import { readCssFiles } from '../utils';
import { ButtonComponent } from '../components/button/buttonComponent';
import { ReloadButton } from '../components/button/iconButtons';
import { ListItemComponent } from '../components/listItem/listItemComponent';
import { DropdownComponent } from '../components/dropdown/dropdownComponent';
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
    releaseDate?: string;
    startDate?: string;
}

export class DashboardView {
    private readonly _extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this._extensionContext = extensionContext;
    }

    public generateHtml(
        userInfo: UserInfo,
        coursesData: { courses?: CourseData[] } | undefined,
        webview?: vscode.Webview
    ): string {
        const styles = readCssFiles(
            'dashboard/dashboard.css',
            'components/button/button.css',
            'components/button/iconButtons/iconButtons.css',
            'components/listItem/list-item.css',
            'components/dropdown/dropdown.css',
            'components/container/container.css'
        );

        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const showIrisExplanation = config.get<boolean>(VSCODE_CONFIG.SHOW_IRIS_EXPLANATION_KEY, true);

        return this._buildDashboardHtml({
            userInfo,
            coursesData,
            webview,
            showIrisExplanation,
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
        userInfo: UserInfo;
        coursesData: { courses?: CourseData[] } | undefined;
        webview: vscode.Webview | undefined;
        showIrisExplanation: boolean;
        styles: string;
    }): string {
        const { userInfo, coursesData, webview, showIrisExplanation, styles } = options;
        const icons = this._loadIcons();

        const irisLogoSrc = this._getWebviewImageUri(webview, 'media/iris-logo-big-left.png');
        const artemisLogoSrc = this._getWebviewImageUri(webview, 'media/artemis-blue.png');

        const { recentCoursesHtml, coursesDataJson, sortedCoursesJson } = this._buildRecentCoursesData(coursesData?.courses);

        const recentCoursesContainer = ContainerComponent.generate({
            className: 'recent-courses',
            listMode: true,
            header: {
                title: 'Recent Courses',
                actionsHtml: `
                    <div class="recent-courses-controls">
                        ${DropdownComponent.generate({
                    id: 'recentCoursesSort',
                    size: 'small',
                    onChange: 'handleRecentCoursesSort(this.value)',
                    options: [
                        { value: 'latest-exercise', label: 'Latest Exercise', selected: true },
                        { value: 'newest-course', label: 'Newest Course' },
                        { value: 'most-exercises', label: 'Most Exercises' },
                        { value: 'title-asc', label: 'Title (A-Z)' },
                        { value: 'title-desc', label: 'Title (Z-A)' }
                    ]
                })}
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
                <div class="recent-courses-list" id="recentCoursesList">
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

        const irisContainer = ContainerComponent.generate({
            className: 'iris-info-cell',
            header: {
                title: 'Chat with Iris',
                subtitle: 'Your AI programming assistant is ready!',
                icon: irisLogoSrc ? `<img src="${irisLogoSrc}" alt="Iris Logo" />` : 'I',
                divider: true
            },
            bodyHtml: `
                <div class="iris-usage-explanation">
                    <h4>Using Iris in VS Code:</h4>
                    <ol>
                        <li><strong>Open Iris Chat:</strong> Click the Iris icon in the Activity Bar (left sidebar) or use the chat buttons in exercise and course views</li>
                        <li><strong>Select your context:</strong> Choose an exercise or course to get context-aware assistance tailored to your current work</li>
                        <li><strong>Start chatting:</strong> Ask questions about your code, exercises, or course material - Iris will help guide you with hints and explanations</li>
                        <li><strong>Multiple conversations:</strong> Create separate chat sessions for different topics and switch between them anytime</li>
                    </ol>
                    <p class="iris-note">
                        <strong>Note:</strong> Iris can make mistakes. Always verify important information. Iris only has access to your submitted code.
                    </p>
                    <p class="iris-note">
                        <strong>Tip:</strong> You can hide this explanation by disabling "Show Iris Explanation" in the Artemis extension settings.
                    </p>
                </div>
            `
        });

        const quickActionsBody = `
            <div id="workspaceExerciseBtn" class="workspace-exercise-container" style="display: none;">
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
                                <div class="workspace-exercise-title">Current Workspace Exercise</div>
                                <div class="workspace-exercise-name" id="workspaceExerciseName">Loading...</div>
                            </div>
                            <div class="workspace-exercise-arrow">→</div>
                        </div>
                    `
        )}
            </div>
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
        
        ${showIrisExplanation ? irisContainer : ''}
        
        ${recentCoursesContainer}
        
        ${quickActionsContainer}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

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
        let workspaceExerciseTitle = null;
        
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

        window.viewCourseDetails = function(courseIndex) {
            const coursesData = ${coursesDataJson};
            if (coursesData && coursesData[courseIndex]) {
                vscode.postMessage({ 
                    command: 'viewCourseDetails',
                    courseData: coursesData[courseIndex]
                });
            }
        };

        window.viewRecentCourseDetails = function(courseIndex) {
            const sortedCourses = ${sortedCoursesJson};
            if (sortedCourses && sortedCourses[courseIndex]) {
                vscode.postMessage({
                    command: 'viewCourseDetails',
                    courseData: sortedCourses[courseIndex]
                });
            }
        };

        // Enable keyboard navigation for list items
        ${ListItemComponent.generateScript()}
        ${ContainerComponent.generateScript()}

        // Sort recent courses functionality
        window.handleRecentCoursesSort = function(sortOption) {
            const coursesData = ${coursesDataJson};
            if (!coursesData) return;

            // Store preference in localStorage
            try {
                localStorage.setItem('recentCoursesSortPreference', sortOption);
            } catch (e) {
                vscode.postMessage({ command: 'webviewLog', level: 'warn', text: '[Dashboard] Could not save sort preference: ' + e });
            }

            // Helper function to get latest release date
            const getLatestReleaseDate = (courseData) => {
                const course = courseData.course;
                if (!course.exercises || course.exercises.length === 0) {
                    return 0;
                }

                const latestDate = course.exercises.reduce((latest, exercise) => {
                    const releaseDate = exercise.releaseDate || exercise.startDate;
                    if (releaseDate) {
                        const timestamp = new Date(releaseDate).getTime();
                        return timestamp > latest ? timestamp : latest;
                    }
                    return latest;
                }, 0);

                return latestDate;
            };

            // Helper function to get course start date
            const getCourseStartDate = (courseData) => {
                const course = courseData.course;
                const startDate = course.startDate || course.creationDate;
                return startDate ? new Date(startDate).getTime() : 0;
            };

            // Helper function to get exercise count
            const getExerciseCount = (courseData) => {
                const course = courseData.course;
                return course.exercises ? course.exercises.length : 0;
            };

            // Sort courses based on selected option
            let sorted = [...coursesData];
            switch (sortOption) {
                case 'latest-exercise':
                    sorted.sort((a, b) => getLatestReleaseDate(b) - getLatestReleaseDate(a));
                    break;
                case 'newest-course':
                    sorted.sort((a, b) => getCourseStartDate(b) - getCourseStartDate(a));
                    break;
                case 'most-exercises':
                    sorted.sort((a, b) => getExerciseCount(b) - getExerciseCount(a));
                    break;
                case 'title-asc':
                    sorted.sort((a, b) => a.course.title.localeCompare(b.course.title));
                    break;
                case 'title-desc':
                    sorted.sort((a, b) => b.course.title.localeCompare(a.course.title));
                    break;
            }

            // Take top 3 and render
            const recentCourses = sorted.slice(0, 3);
            const listContainer = document.getElementById('recentCoursesList');
            if (listContainer) {
                listContainer.innerHTML = recentCourses.map((courseData, index) => {
                    const course = courseData.course;
                    const exerciseCount = course.exercises ? course.exercises.length : 0;
                    const originalIndex = coursesData.indexOf(courseData);
                    
                    // Create a temporary container to generate the list item
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = \`
                        <div class="list-item list-item--clickable list-item--hover recent-course-item" 
                             onclick="viewCourseDetails(\${originalIndex})"
                             role="button"
                             tabindex="0"
                             data-course-index="\${originalIndex}"
                             data-course-id="\${course.id || ''}">
                            <div class="course-title">\${course.title}</div>
                            <div class="course-info">\${exerciseCount} exercises</div>
                        </div>
                    \`;
                    return tempDiv.innerHTML.trim();
                }).join('');
            }
        };
        
        // Listen for workspace exercise detection results
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'workspaceExerciseDetected') {
                const workspaceBtn = document.getElementById('workspaceExerciseBtn');
                const workspaceNameEl = document.getElementById('workspaceExerciseName');
                
                if (message.exerciseId && message.exerciseTitle) {
                    workspaceExerciseId = message.exerciseId;
                    workspaceExerciseTitle = message.exerciseTitle;
                    
                    if (workspaceNameEl) {
                        workspaceNameEl.textContent = message.exerciseTitle;
                    }
                    if (workspaceBtn) {
                        workspaceBtn.style.display = 'block';
                    }
                } else {
                    if (workspaceBtn) {
                        workspaceBtn.style.display = 'none';
                    }
                }
            }
        });

        // Initialize sort dropdown with saved preference
        document.addEventListener('DOMContentLoaded', function() {
            try {
                const savedSort = localStorage.getItem('recentCoursesSortPreference');
                const sortDropdown = document.getElementById('recentCoursesSort');
                if (savedSort && sortDropdown) {
                    sortDropdown.value = savedSort;
                    handleRecentCoursesSort(savedSort);
                }
            } catch (e) {
                vscode.postMessage({ command: 'webviewLog', level: 'warn', text: '[Dashboard] Could not load sort preference: ' + e });
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

    private _getLatestReleaseDate(courseData: CourseData): number {
        const course = courseData.course;
        if (!course.exercises || course.exercises.length === 0) {
            return 0;
        }

        return course.exercises.reduce((latest: number, exercise: Exercise) => {
            const releaseDate = exercise.releaseDate || exercise.startDate;
            if (releaseDate) {
                const timestamp = new Date(releaseDate).getTime();
                return timestamp > latest ? timestamp : latest;
            }
            return latest;
        }, 0);
    }

    private _sortCoursesByLatestExercise(courses: CourseData[]): CourseData[] {
        return [...courses].sort((a, b) => {
            const aLatest = this._getLatestReleaseDate(a);
            const bLatest = this._getLatestReleaseDate(b);
            return bLatest - aLatest;
        });
    }

    private _buildRecentCoursesData(courses: CourseData[] | undefined): {
        recentCoursesHtml: string;
        coursesDataJson: string;
        sortedCoursesJson: string;
    } {
        if (!courses) {
            return {
                recentCoursesHtml: '<div class="no-courses">Loading courses...</div>',
                coursesDataJson: 'null',
                sortedCoursesJson: 'null'
            };
        }

        const sortedCourses = this._sortCoursesByLatestExercise(courses);
        const recentCourses = sortedCourses.slice(0, 3);

        const recentCoursesHtml = recentCourses.map((courseData, index) => {
            const course = courseData.course;
            const exerciseCount = course.exercises?.length ?? 0;

            return ListItemComponent.generate(
                {
                    className: 'recent-course-item',
                    clickable: true,
                    command: `viewRecentCourseDetails(${index})`,
                    dataAttributes: {
                        'course-index': index.toString(),
                        'course-id': course.id?.toString() || ''
                    }
                },
                `
                    <div class="course-title">${course.title}</div>
                    <div class="course-info">${exerciseCount} exercises</div>
                `
            );
        }).join('');

        return {
            recentCoursesHtml,
            coursesDataJson: JSON.stringify(courses),
            sortedCoursesJson: JSON.stringify(sortedCourses)
        };
    }
}
