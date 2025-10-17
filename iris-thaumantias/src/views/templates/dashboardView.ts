import * as vscode from 'vscode';
import { ThemeManager } from '../../themes';
import { VSCODE_CONFIG } from '../../utils';
import { IconDefinitions } from '../../utils/iconDefinitions';
import { StyleManager } from '../styles';

export class DashboardView {
    private _themeManager: ThemeManager;
    private _extensionContext: vscode.ExtensionContext;
    private _styleManager: StyleManager;

    constructor(extensionContext: vscode.ExtensionContext, styleManager: StyleManager) {
        this._themeManager = new ThemeManager();
        this._extensionContext = extensionContext;
        this._styleManager = styleManager;
    }

    public generateHtml(userInfo: { username: string; serverUrl: string; user?: any }, coursesData: any | undefined, webview?: vscode.Webview): string {
        const themeCSS = this._themeManager.getThemeCSS();
        const currentTheme = this._themeManager.getCurrentTheme();
        const styles = this._styleManager.getStyles(currentTheme, [
            'views/dashboard.css'
        ]);
        
        // Check if Iris explanation should be shown
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const showIrisExplanation = config.get<boolean>(VSCODE_CONFIG.SHOW_IRIS_EXPLANATION_KEY, true);
        
        return this._getDashboardHtml(userInfo, coursesData, currentTheme, webview, showIrisExplanation, styles, themeCSS);
    }

    private _getDashboardHtml(userInfo: { username: string; serverUrl: string; user?: any }, coursesData: any | undefined, currentTheme: string, webview: vscode.Webview | undefined, showIrisExplanation: boolean, styles: string, themeCSS: string): string {
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
                return `
                    <div class="recent-course-item" onclick="viewRecentCourseDetails(${index})">
                        <div class="course-title">${course.title}</div>
                        <div class="course-info">${exerciseCount} exercises</div>
                    </div>
                `;
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
        ${themeCSS}
    </style>

    
</head>
<body class="theme-${currentTheme}">
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
                    <p class="iris-subtitle">Your AI programming assistant</p>
                </div>
            </div>
            <div class="iris-usage-explanation">
                <h4>How to use Iris in this extension:</h4>
                <ol>
                    <li><strong>Access Iris anywhere:</strong> Find the Iris chat icon in the Activity Bar (left sidebar) for quick access, or start a chat directly from course and exercise views</li>
                    <li><strong>Smart context detection:</strong> Iris automatically detects your current exercise and course context to provide relevant, personalized assistance</li>
                    <li><strong>Configure your experience:</strong> Enable/disable Iris, select your preferred AI model, and manage privacy settings through the extension settings</li>
                    <li><strong>Control context sharing:</strong> Choose whether to share your code and exercise context with Iris for more accurate help</li>
                    <li><strong>Get instant help:</strong> Ask programming questions, receive debugging support, and get guidance tailored to your specific exercises</li>
                </ol>
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
                    <span class="show-all-link" onclick="showAllCourses()">Show All</span>
                </div>
            </h3>
            <div class="recent-courses-list" id="recentCoursesList">
                ${recentCoursesHtml}
            </div>
        </div>
        
        <div class="quick-actions">
            <h3>Quick Actions</h3>
            <div id="workspaceExerciseBtn" class="workspace-exercise-container" style="display: none;">
                <button class="workspace-exercise-btn" onclick="goToWorkspaceExercise()">
                    <div class="workspace-exercise-content">
                        <div class="workspace-exercise-icon">${exerciseIcon}</div>
                        <div class="workspace-exercise-text">
                            <div class="workspace-exercise-title">Current Workspace Exercise</div>
                            <div class="workspace-exercise-name" id="workspaceExerciseName">Loading...</div>
                        </div>
                        <div class="workspace-exercise-arrow">→</div>
                    </div>
                </button>
            </div>
            <div class="action-buttons">
                <button class="action-btn" id="browseCoursesBtn">
                    <span class="action-btn-icon">${courseIcon}</span>
                    Browse Courses
                </button>
                <button class="action-btn" id="checkAiConfigBtn">
                    <span class="action-btn-icon">${star4Icon}</span>
                    AI Checker
                </button>
                <button class="action-btn" id="checkServiceStatusBtn">
                    <span class="action-btn-icon">${stethoscopeIcon}</span>
                    Service Status
                </button>
                <button class="action-btn" id="recommendedExtensionsBtn">
                    <span class="action-btn-icon">${puzzleIcon}</span>
                    Recommended Extensions
                </button>
                <button class="action-btn" id="openWebsiteBtn">
                    <span class="action-btn-icon">${webIcon}</span>
                    Open Artemis in browser
                </button>
                <button class="action-btn" id="gitCredentialsBtn">
                    <span class="action-btn-icon">${gitIcon}</span>
                    Git Credentials
                </button>
                <button class="action-btn" id="openSettingsBtn">
                    <span class="action-btn-icon">${gearIcon}</span>
                    Open Settings
                </button>
                <button class="action-btn logout-btn" id="logoutBtn">
                    <span class="action-btn-icon">${logoutIcon}</span>
                    Logout from Artemis
                </button>
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
                    return \`
                        <div class="recent-course-item" onclick="viewCourseDetails(\${coursesData.indexOf(courseData)})">
                            <div class="course-title">\${course.title}</div>
                            <div class="course-info">\${exerciseCount} exercises</div>
                        </div>
                    \`;
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
