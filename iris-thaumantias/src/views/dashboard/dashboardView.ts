import * as vscode from 'vscode';
import { VSCODE_CONFIG } from '../../utils';
import { IconDefinitions } from '../../utils/iconDefinitions';
import { readCssFiles } from '../utils';
import { ButtonComponent } from '../components/button/buttonComponent';
import { ListItemComponent } from '../components/listItem/listItemComponent';

export class DashboardView {
    private _extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this._extensionContext = extensionContext;
    }

    public generateHtml(userInfo: { username: string; serverUrl: string; user?: any }, coursesData: any | undefined, webview?: vscode.Webview): string {
        const styles = readCssFiles(
            'dashboard/dashboard.css', 
            'components/button/button.css',
            'components/listItem/list-item.css'
        );
        
        // Check if Iris explanation should be shown
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const showIrisExplanation = config.get<boolean>(VSCODE_CONFIG.SHOW_IRIS_EXPLANATION_KEY, true);
        
        return this._getDashboardHtml(userInfo, coursesData, webview, showIrisExplanation, styles);
    }

    private _getDashboardHtml(userInfo: { username: string; serverUrl: string; user?: any }, coursesData: any | undefined, webview: vscode.Webview | undefined, showIrisExplanation: boolean, styles: string): string {
        const username = userInfo?.username || 'Unknown';
        const serverUrl = userInfo?.serverUrl || 'Unknown';
        
        // Get icon SVGs
        const courseIcon = IconDefinitions.getIcon('course');
        const webIcon = IconDefinitions.getIcon('artemis-logo');
        const gearIcon = IconDefinitions.getIcon('gear');
        const star4Icon = IconDefinitions.getIcon('star-4-edges');
        const stethoscopeIcon = IconDefinitions.getIcon('stethoscope');
        const logoutIcon = IconDefinitions.getIcon('logout');
        const puzzleIcon = IconDefinitions.getIcon('puzzle');
        const exerciseIcon = IconDefinitions.getIcon('exercise');
        const gitIcon = IconDefinitions.getIcon('git');
        
        // Get the path to the iris logo image
        let irisLogoSrc = '';
        if (webview) {
            const irisLogoUri = vscode.Uri.file(
                this._extensionContext.asAbsolutePath('media/iris-logo-big-left.png')
            );
            irisLogoSrc = webview.asWebviewUri(irisLogoUri).toString();
        } else {
            // Fallback to showing the "I" text if webview is not provided
            irisLogoSrc = '';
        }
        
        // Generate recent courses HTML
        let recentCoursesHtml = '';
        let coursesDataJson = 'null';
        let sortedCoursesJson = 'null';
        if (coursesData?.courses) {
            coursesDataJson = JSON.stringify(coursesData.courses);
            
            // Sort courses by latest released exercise
            const sortedCourses = [...coursesData.courses].sort((a: any, b: any) => {
                const getLatestReleaseDate = (courseData: any): number => {
                    const course = courseData.course;
                    if (!course.exercises || course.exercises.length === 0) {
                        return 0; // Courses without exercises go to the end
                    }
                    
                    // Find the latest release date among all exercises
                    const latestDate = course.exercises.reduce((latest: number, exercise: any) => {
                        const releaseDate = exercise.releaseDate || exercise.startDate;
                        if (releaseDate) {
                            const timestamp = new Date(releaseDate).getTime();
                            return timestamp > latest ? timestamp : latest;
                        }
                        return latest;
                    }, 0);
                    
                    return latestDate;
                };
                
                const aLatest = getLatestReleaseDate(a);
                const bLatest = getLatestReleaseDate(b);
                return bLatest - aLatest; // Descending order (most recent first)
            });
            
            sortedCoursesJson = JSON.stringify(sortedCourses);
            const recentCourses = sortedCourses.slice(0, 3);
            recentCoursesHtml = recentCourses.map((courseData: any, index: number) => {
                const course = courseData.course;
                const exerciseCount = course.exercises ? course.exercises.length : 0;
                
                // Use ListItemComponent for consistent styling
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
        } else {
            recentCoursesHtml = '<div class="no-courses">Loading courses...</div>';
        }
        
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
        <div class="dashboard-header">
            <h1 class="dashboard-title">
                Welcome to Artemis
            </h1>
            <p class="dashboard-subtitle">Your programming learning companion</p>
        </div>
        
        ${showIrisExplanation ? `
        <div class="iris-info-cell">
            <div class="iris-header">
                <div class="iris-icon">
                    ${irisLogoSrc ? `<img src="${irisLogoSrc}" alt="Iris Logo" />` : 'I'}
                </div>
                <div class="iris-info">
                    <h3 class="iris-title">Chat with Iris</h3>
                    <p class="iris-subtitle">Your AI programming assistant is ready!</p>
                </div>
            </div>
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
        </div>
        ` : ''}
        
        <div class="recent-courses">
            <h3>
                Recent Courses
                <div class="recent-courses-controls">
                    <select class="sort-dropdown" id="recentCoursesSort" onchange="handleRecentCoursesSort(this.value)">
                        <option value="latest-exercise">Latest Exercise</option>
                        <option value="newest-course">Newest Course</option>
                        <option value="most-exercises">Most Exercises</option>
                        <option value="title-asc">Title (A-Z)</option>
                        <option value="title-desc">Title (Z-A)</option>
                    </select>
                    ${ButtonComponent.generate({
                        label: 'Show All',
                        variant: 'link',
                        command: 'showAllCourses()',
                        className: 'show-all-link',
                        height: '1rem'
                    })}
                </div>
            </h3>
            <div class="recent-courses-list" id="recentCoursesList">
                ${recentCoursesHtml}
            </div>
        </div>
        
        <div class="quick-actions">
            <h3>Quick Actions</h3>
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
                            <div class="workspace-exercise-icon">${exerciseIcon}</div>
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
                    icon: courseIcon,
                    variant: 'primary',
                    id: 'browseCoursesBtn',
                    command: 'document.getElementById("browseCoursesBtn").click()',
                    fullWidth: true
                })}
                ${ButtonComponent.generate({
                    label: 'AI Checker',
                    icon: star4Icon,
                    variant: 'primary',
                    id: 'checkAiConfigBtn',
                    command: 'document.getElementById("checkAiConfigBtn").click()',
                    fullWidth: true
                })}
                ${ButtonComponent.generate({
                    label: 'Service Status',
                    icon: stethoscopeIcon,
                    variant: 'primary',
                    id: 'checkServiceStatusBtn',
                    command: 'document.getElementById("checkServiceStatusBtn").click()',
                    fullWidth: true
                })}
                ${ButtonComponent.generate({
                    label: 'Recommended Extensions',
                    icon: puzzleIcon,
                    variant: 'primary',
                    id: 'recommendedExtensionsBtn',
                    command: 'document.getElementById("recommendedExtensionsBtn").click()',
                    fullWidth: true
                })}
                ${ButtonComponent.generate({
                    label: 'Open Artemis in browser',
                    icon: webIcon,
                    variant: 'primary',
                    id: 'openWebsiteBtn',
                    command: 'document.getElementById("openWebsiteBtn").click()',
                    fullWidth: true
                })}
                ${ButtonComponent.generate({
                    label: 'Git Credentials',
                    icon: gitIcon,
                    variant: 'secondary',
                    id: 'gitCredentialsBtn',
                    command: 'document.getElementById("gitCredentialsBtn").click()',
                    fullWidth: true
                })}
                ${ButtonComponent.generate({
                    label: 'Open Settings',
                    icon: gearIcon,
                    variant: 'secondary',
                    id: 'openSettingsBtn',
                    command: 'document.getElementById("openSettingsBtn").click()',
                    fullWidth: true
                })}
                ${ButtonComponent.generate({
                    label: 'Logout from Artemis',
                    icon: logoutIcon,
                    variant: 'secondary',
                    className: 'btn-danger',
                    id: 'logoutBtn',
                    command: 'document.getElementById("logoutBtn").click()',
                    fullWidth: true
                })}
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // Dashboard action buttons
        const browseCoursesBtn = document.getElementById('browseCoursesBtn');
        const checkAiConfigBtn = document.getElementById('checkAiConfigBtn');
        const checkServiceStatusBtn = document.getElementById('checkServiceStatusBtn');
        const recommendedExtensionsBtn = document.getElementById('recommendedExtensionsBtn');
        const openWebsiteBtn = document.getElementById('openWebsiteBtn');
        const gitCredentialsBtn = document.getElementById('gitCredentialsBtn');
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
        
        if (checkServiceStatusBtn) {
            checkServiceStatusBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'showServiceStatus' });
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

        if (gitCredentialsBtn) {
            gitCredentialsBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'showGitCredentials' });
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

        // Sort recent courses functionality
        window.handleRecentCoursesSort = function(sortOption) {
            const coursesData = ${coursesDataJson};
            if (!coursesData) return;

            // Store preference in localStorage
            try {
                localStorage.setItem('recentCoursesSortPreference', sortOption);
            } catch (e) {
                console.log('Could not save sort preference:', e);
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
                    // Apply the saved sort
                    handleRecentCoursesSort(savedSort);
                }
            } catch (e) {
                console.log('Could not load sort preference:', e);
            }
        });
    </script>
</body>
</html>`;
    }
}
