import * as vscode from 'vscode';
import { ThemeManager } from '../../themes';
import { IconDefinitions } from '../../utils/iconDefinitions';
import { StyleManager } from '../styles';

export class IrisChatView {
    private _themeManager: ThemeManager;
    private _extensionContext: vscode.ExtensionContext;
    private _styleManager: StyleManager;

    constructor(extensionContext: vscode.ExtensionContext, styleManager: StyleManager) {
        this._themeManager = new ThemeManager();
        this._extensionContext = extensionContext;
        this._styleManager = styleManager;
    }

    public generateHtml(webview?: vscode.Webview, showDiagnostics: boolean = false): string {
        const themeCSS = this._themeManager.getThemeCSS();
        const currentTheme = this._themeManager.getCurrentTheme();
        const styles = this._styleManager.getStyles(currentTheme, [
            'views/iris-chat.css'
        ]);
        
        // Get SVG icons
        const exerciseIcon = IconDefinitions.getIcon('exercise');
        const courseIcon = IconDefinitions.getIcon('course');
        const refreshIcon = IconDefinitions.getIcon('refresh');
        const trashIcon = IconDefinitions.getIcon('trash');
        const stethoscopeIcon = IconDefinitions.getIcon('stethoscope');
        const starIcon = IconDefinitions.getIcon('star');
        const cursorIcon = IconDefinitions.getIcon('cursor');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chat with Iris</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>

</head>
<body class="theme-${currentTheme}">
    <div class="coming-soon-overlay">
        <div class="coming-soon-content">
            <div class="coming-soon-icon">🚀</div>
            <h1 class="coming-soon-title">Iris Chat - Coming Soon!</h1>
            <p class="coming-soon-message">
                This feature is currently under development and will be available in a future update.
            </p>
            <p class="coming-soon-submessage">
                Iris will provide AI-powered assistance for your programming exercises and courses.
            </p>
        </div>
    </div>
    
    <div class="chat-container" style="display: none;">
        <div class="chat-header">
            <h1 class="chat-title">Chat with Iris</h1>
            <button class="burger-menu" onclick="toggleSideMenu()" title="Menu">
                <div class="burger-icon">
                    <div class="burger-line"></div>
                    <div class="burger-line"></div>
                    <div class="burger-line"></div>
                </div>
            </button>
        </div>
        
        <!-- Context Detection Bean -->
        <div class="exercise-detection-bean-container" id="exerciseBeanContainer">
            <div class="exercise-detection-bean" id="exerciseBean" onclick="toggleSideMenu()">
                <span class="bean-icon" id="exerciseBeanIcon"></span>
                <span class="bean-text" id="exerciseBeanText">NO CONTEXT</span>
            </div>
        </div>
        
        <div class="chat-messages" id="chatMessages">
            <div class="welcome-message">
                <p class="welcome-text">
                    Welcome to Iris Chat!<br>
                    <strong>Note: Iris is currently disabled and will be enabled later.</strong><br>
                    Please select a chat context from the menu (☰) to get started.
                </p>
            </div>
        </div>
        
        <div class="chat-input-container">
            <div class="chat-input-wrapper">
                <textarea 
                    class="chat-input" 
                    id="chatInput" 
                    placeholder="Chat input is currently disabled"
                    rows="1"
                    disabled
                    readonly
                ></textarea>
                <button class="send-button" id="sendButton" disabled>
                    Send
                </button>
            </div>
        </div>
    </div>

    <!-- Help Popup -->
    <div class="help-overlay" id="helpOverlay" onclick="closeHelpPopup()"></div>
    <div class="help-popup" id="helpPopup">
        <div class="help-popup-header">
            <h2 class="help-popup-title">Chat Context Guide</h2>
            <button class="close-help-btn" onclick="closeHelpPopup()" title="Close Help">×</button>
        </div>
        <div class="help-popup-content">
            <p class="help-intro">
                Choose the right chat context to get the most relevant help from Iris. Each context is designed for specific types of questions and learning scenarios.
            </p>
            
            <div class="help-sections">
                <div class="help-section">
                    <div class="help-section-header">
                        <span class="help-icon">📚</span>
                        <h3>Course Chat</h3>
                    </div>
                    <div class="help-section-content">
                        <p><strong>Best for:</strong> General course questions, understanding course structure, and getting clarification on course topics.</p>
                        <p><strong>Use when you want to:</strong></p>
                        <ul>
                            <li>Understand course objectives and requirements</li>
                            <li>Get an overview of course topics</li>
                            <li>Learn how different concepts connect</li>
                            <li>Ask about course policies or structure</li>
                        </ul>
                        <div class="help-example">
                            <strong>Example:</strong> "What are the main topics in this computer science course?"
                        </div>
                    </div>
                </div>

                <div class="help-section">
                    <div class="help-section-header">
                        <span class="help-icon">💻</span>
                        <h3>Exercise Chat</h3>
                    </div>
                    <div class="help-section-content">
                        <p><strong>Best for:</strong> Programming exercises, coding problems, and hands-on assignments.</p>
                        <p><strong>Use when you want to:</strong></p>
                        <ul>
                            <li>Debug your code or fix errors</li>
                            <li>Understand programming concepts</li>
                            <li>Get hints for solving coding problems</li>
                            <li>Learn best practices and syntax</li>
                        </ul>
                        <div class="help-example">
                            <strong>Example:</strong> "I'm getting a NullPointerException in my Java code. Can you help me understand why?"
                        </div>
                        <div class="help-note">
                            <strong>Note:</strong> Iris provides guidance and hints rather than complete solutions to encourage learning.
                        </div>
                    </div>
                </div>

                <div class="help-section">
                    <div class="help-section-header">
                        <span class="help-icon">👨‍🏫</span>
                        <h3>Tutor Suggestions</h3>
                    </div>
                    <div class="help-section-content">
                        <p><strong>Best for:</strong> Personalized learning guidance, study strategies, and academic advice.</p>
                        <p><strong>Use when you want to:</strong></p>
                        <ul>
                            <li>Get study recommendations</li>
                            <li>Find practice problems</li>
                            <li>Improve learning strategies</li>
                            <li>Overcome specific learning challenges</li>
                        </ul>
                        <div class="help-example">
                            <strong>Example:</strong> "What's the best way to study for my algorithms exam?"
                        </div>
                        <div class="help-note">
                            <strong>Special:</strong> Provides tailored suggestions based on your progress and learning patterns.
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="help-footer">
                <p><strong>💡 Tip:</strong> You can switch between contexts anytime using the dropdown menu in the sidebar. Each context maintains its own conversation history.</p>
            </div>
        </div>
    </div>

    <!-- Side Menu -->
    <div class="menu-overlay" id="menuOverlay" onclick="closeSideMenu()"></div>
    <div class="side-menu" id="sideMenu">
        <div class="side-menu-header">
            <h3 class="side-menu-title">Menu</h3>
            <button class="close-menu-btn" onclick="closeSideMenu()" title="Close Menu">
                ×
            </button>
        </div>
        <div class="side-menu-content">
            <div class="menu-section">
                <h4 class="menu-section-title">Chat Context</h4>
                
                <!-- Selection Mode Button -->
                <button class="selection-mode-button is-auto" onclick="toggleSelectionMode(event)" id="selectionModeButton">
                    <span class="selection-mode-icon" id="selectionModeIcon">${refreshIcon}</span>
                    <div class="selection-mode-content">
                        <div class="selection-mode-title" id="selectionModeText">Auto Selection</div>
                        <div class="selection-mode-description" id="selectionModeDescription">System automatically selects context</div>
                    </div>
                </button>
                
                <!-- Search Input (Only in Manual Mode) -->
                <div class="search-container" id="searchContainer" style="display: none;">
                    <input 
                        type="text" 
                        class="search-input" 
                        id="contextSearchInput" 
                        placeholder="Search exercises and courses..."
                        oninput="filterContextLists()"
                    />
                </div>
                
                <!-- Quick Select Section (Only in Auto Mode) -->
                <div class="quick-select-section" id="quickSelectSection">
                    <div class="quick-select-header">Quick Select</div>
                    
                    <!-- Top Exercise -->
                    <div class="quick-select-item" id="quickExercise" style="display: none;" onclick="quickSelectExercise()">
                        <div class="quick-select-icon">${exerciseIcon}</div>
                        <div class="quick-select-content">
                            <div class="quick-select-label">Top Exercise</div>
                            <div class="quick-select-title" id="quickExerciseTitle">Loading...</div>
                        </div>
                    </div>
                    
                    <!-- Top Course -->
                    <div class="quick-select-item" id="quickCourse" style="display: none;" onclick="quickSelectCourse()">
                        <div class="quick-select-icon">${courseIcon}</div>
                        <div class="quick-select-content">
                            <div class="quick-select-label">Top Course</div>
                            <div class="quick-select-title" id="quickCourseTitle">Loading...</div>
                        </div>
                    </div>
                    
                    <div class="quick-select-empty" id="quickSelectEmpty">
                        Open a course or exercise from Artemis to see quick options
                    </div>
                </div>
                
                <!-- All Exercises List (Only in Manual Mode) -->
                <div class="context-list-section" id="exercisesListSection" style="display: none;">
                    <div class="context-list-header">${exerciseIcon} All Exercises</div>
                    <div class="context-list-container" id="exercisesList">
                        <!-- Populated dynamically -->
                    </div>
                </div>
                
                <!-- All Courses List (Only in Manual Mode) -->
                <div class="context-list-section" id="coursesListSection" style="display: none;">
                    <div class="context-list-header">${courseIcon} All Courses</div>
                    <div class="context-list-container" id="coursesList">
                        <!-- Populated dynamically -->
                    </div>
                </div>
            </div>
            
            <div class="menu-section">
                <h4 class="menu-section-title">Chat Options</h4>
                <div class="menu-item" onclick="newConversation()" id="newConversationBtn" style="opacity: 0.5; pointer-events: none;">
                    ${refreshIcon}
                    <div>
                        <div>New Conversation</div>
                        <div class="menu-item-description">Start fresh in the same context</div>
                    </div>
                </div>
                <div class="menu-item" onclick="clearHistory()">
                    ${trashIcon}
                    <div>
                        <div>Clear History</div>
                        <div class="menu-item-description">Reset everything and choose new context</div>
                    </div>
                </div>
                ${showDiagnostics ? `
                <div class="menu-item" onclick="openDiagnostics()">
                    ${stethoscopeIcon}
                    <div>
                        <div>Diagnostics</div>
                        <div class="menu-item-description">Log current context and state to console</div>
                    </div>
                </div>
                ` : ''}
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // SVG Icon Definitions
        const ICONS = {
            refresh: \`${refreshIcon}\`,
            cursor: \`${cursorIcon}\`,
            star: \`${starIcon}\`,
            programming: \`<svg viewBox="0 0 576 512" fill="none">
                <path fill="currentColor" d="M64 64C28.7 64 0 92.7 0 128L0 384c0 35.3 28.7 64 64 64l448 0c35.3 0 64-28.7 64-64l0-256c0-35.3-28.7-64-64-64L64 64zm16 64l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zM64 240c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zM176 128l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zM160 240c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zm16 80l224 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-224 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zm80-176c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zm16 80l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zm80-80c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zm16 80l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zm80-80c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zm16 80l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16z"/>
            </svg>\`
        };
        
        // Side menu functionality
        function toggleSideMenu() {
            const sideMenu = document.getElementById('sideMenu');
            const menuOverlay = document.getElementById('menuOverlay');
            const burgerMenu = document.querySelector('.burger-menu');
            
            const isOpen = sideMenu.classList.contains('open');
            
            if (isOpen) {
                closeSideMenu();
            } else {
                openSideMenu();
            }
        }
        
        function openSideMenu() {
            const sideMenu = document.getElementById('sideMenu');
            const menuOverlay = document.getElementById('menuOverlay');
            const burgerMenu = document.querySelector('.burger-menu');
            
            sideMenu.classList.add('open');
            menuOverlay.classList.add('open');
            burgerMenu.classList.add('active');
            
            // Auto-select top exercise if in auto mode and nothing is selected yet
            if (selectionMode === 'auto' && !selectedContext) {
                autoSelectContext();
            }
            
            // Update visual selection after a short delay to ensure DOM is ready
            setTimeout(updateSelectedVisuals, 50);
        }
        
        function closeSideMenu() {
            const sideMenu = document.getElementById('sideMenu');
            const menuOverlay = document.getElementById('menuOverlay');
            const burgerMenu = document.querySelector('.burger-menu');
            
            sideMenu.classList.remove('open');
            menuOverlay.classList.remove('open');
            burgerMenu.classList.remove('active');
        }

        // Exercise popup toggle functionality
        
        // Icon definitions for course vs exercise (matching iconDefinitions.ts)
        const CONTEXT_ICONS = {
            'course': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 19V6.2C4 5.0799 4 4.51984 4.21799 4.09202C4.40973 3.71569 4.71569 3.40973 5.09202 3.21799C5.51984 3 6.0799 3 7.2 3H16.8C17.9201 3 18.4802 3 18.908 3.21799C19.2843 3.40973 19.5903 3.71569 19.782 4.09202C20 4.51984 20 5.0799 20 6.2V17H6C4.89543 17 4 17.8954 4 19ZM4 19C4 20.1046 4.89543 21 6 21H20M9 7H15M9 11H15M19 17V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            'exercise': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 6L21 6.00072M11 12L21 12.0007M11 18L21 18.0007M3 11.9444L4.53846 13.5L8 10M3 5.94444L4.53846 7.5L8 4M4.5 18H4.51M5 18C5 18.2761 4.77614 18.5 4.5 18.5C4.22386 18.5 4 18.2761 4 18C4 17.7239 4.22386 17.5 4.5 17.5C4.77614 17.5 5 17.7239 5 18Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        };
        
        function getContextIcon(contextType) {
            return CONTEXT_ICONS[contextType] || CONTEXT_ICONS['exercise'];
        }
        
        // Global state - must be declared before any functions that use them
        let selectedContext = null;
        let selectedItemId = null;
        let selectedItemName = null;
        let selectedItemShortName = null; // Store the shortName for bean display
        let selectionMode = 'auto'; // 'auto' or 'manual'
        let detectedExercises = [];
        let detectedCourses = [];
        
        // Restore state from previous session
        const previousState = vscode.getState();
        if (previousState) {
            if (previousState.selectionMode) {
                selectionMode = previousState.selectionMode;
            }
            if (previousState.selectedContext) {
                selectedContext = previousState.selectedContext;
                selectedItemId = previousState.selectedItemId;
                selectedItemName = previousState.selectedItemName;
                selectedItemShortName = previousState.selectedItemShortName;
            }
        }
        
        // Save state helper function
        function saveState() {
            vscode.setState({
                selectionMode: selectionMode,
                selectedContext: selectedContext,
                selectedItemId: selectedItemId,
                selectedItemName: selectedItemName,
                selectedItemShortName: selectedItemShortName
            });
        }
        
        // Update detected exercises from extension  
        function updateDetectedExercises(exercises) {
            detectedExercises = exercises || [];
            // Update bean text based on current selected context
            updateBeanText();
            // Update quick select and lists
            updateQuickSelectAndLists();
            
            // If in auto mode and no context selected, auto-select
            if (selectionMode === 'auto' && !selectedContext) {
                autoSelectContext();
            }
        }

        // Update detected courses from extension
        function updateDetectedCourses(courses) {
            detectedCourses = courses || [];
            // Update bean text based on current selected context
            updateBeanText();
            // Update quick select and lists
            updateQuickSelectAndLists();
            
            // If in auto mode and no context selected, auto-select
            if (selectionMode === 'auto' && !selectedContext) {
                autoSelectContext();
            }
        }

        // Calculate exercise priority (same as in chatWebviewProvider.ts)
        function calculateExercisePriority(exercise) {
            let priority = 0;
            const now = Date.now();
            const msPerDay = 24 * 60 * 60 * 1000;

            // Workspace bonus: +1000
            if (exercise.title && exercise.title.includes('(Workspace)')) {
                priority += 1000;
            }

            // Released in last 7 days: +100
            if (exercise.releaseDate) {
                const releaseTime = new Date(exercise.releaseDate).getTime();
                const daysSinceRelease = (now - releaseTime) / msPerDay;
                if (daysSinceRelease >= 0 && daysSinceRelease <= 7) {
                    priority += 100;
                }
            }

            // Due in next 7 days: +170 to +200
            if (exercise.dueDate) {
                const dueTime = new Date(exercise.dueDate).getTime();
                const daysUntilDue = (dueTime - now) / msPerDay;
                if (daysUntilDue >= 0 && daysUntilDue <= 7) {
                    priority += Math.max(200 - Math.floor(daysUntilDue * 30 / 7), 170);
                }
            }

            // Base score: Release date
            if (exercise.releaseDate) {
                const releaseTime = new Date(exercise.releaseDate).getTime();
                priority += Math.floor(releaseTime / msPerDay / 1000);
            }

            return priority;
        }

        // Update quick select and lists
        function updateQuickSelectAndLists() {
            const quickExercise = document.getElementById('quickExercise');
            const quickCourse = document.getElementById('quickCourse');
            const quickEmpty = document.getElementById('quickSelectEmpty');
            const exercisesSection = document.getElementById('exercisesListSection');
            const coursesSection = document.getElementById('coursesListSection');
            const searchContainer = document.getElementById('searchContainer');
            const quickSelectSection = document.getElementById('quickSelectSection');

            // Sort exercises by priority
            const sortedExercises = [...detectedExercises].sort((a, b) => {
                return calculateExercisePriority(b) - calculateExercisePriority(a);
            });

            // Sort courses by most recently viewed
            const sortedCourses = [...detectedCourses];

            // Update quick select for top exercise
            if (sortedExercises.length > 0) {
                const topExercise = sortedExercises[0];
                document.getElementById('quickExerciseTitle').textContent = topExercise.title;
                quickExercise.setAttribute('data-exercise-id', topExercise.id);
                quickExercise.style.display = 'flex';
                quickEmpty.style.display = 'none';
            } else {
                quickExercise.style.display = 'none';
            }

            // Update quick select for top course
            if (sortedCourses.length > 0) {
                const topCourse = sortedCourses[0];
                document.getElementById('quickCourseTitle').textContent = topCourse.title;
                quickCourse.setAttribute('data-course-id', topCourse.id);
                quickCourse.style.display = 'flex';
                quickEmpty.style.display = 'none';
            } else {
                quickCourse.style.display = 'none';
            }

            // Show empty state if no exercises or courses
            if (sortedExercises.length === 0 && sortedCourses.length === 0) {
                quickEmpty.style.display = 'block';
            }

            // Populate all exercises list
            if (sortedExercises.length > 0) {
                const exercisesList = document.getElementById('exercisesList');
                exercisesList.innerHTML = '';
                
                sortedExercises.forEach((exercise, index) => {
                    const item = document.createElement('div');
                    item.className = 'context-list-item';
                    item.setAttribute('data-exercise-id', exercise.id);
                    item.onclick = function() { selectExerciseFromList(exercise.id, exercise.title); };
                    
                    const isWorkspace = exercise.title.includes('(Workspace)');
                    const badge = isWorkspace ? '<span class="workspace-badge">' + ICONS.star + '</span> ' : '';
                    
                    item.innerHTML = \`
                        <div class="context-list-item-title">\${badge}\${exercise.title}</div>
                        <div class="context-list-item-meta">ID: \${exercise.id}</div>
                    \`;
                    
                    exercisesList.appendChild(item);
                });
                
                // Only show if in manual mode
                exercisesSection.style.display = selectionMode === 'manual' ? 'block' : 'none';
            } else {
                exercisesSection.style.display = 'none';
            }

            // Populate all courses list
            if (sortedCourses.length > 0) {
                const coursesList = document.getElementById('coursesList');
                coursesList.innerHTML = '';
                
                sortedCourses.forEach((course, index) => {
                    const item = document.createElement('div');
                    item.className = 'context-list-item';
                    item.setAttribute('data-course-id', course.id);
                    item.onclick = function() { selectCourseFromList(course.id, course.title); };
                    
                    item.innerHTML = \`
                        <div class="context-list-item-title">\${course.title}</div>
                        <div class="context-list-item-meta">ID: \${course.id}</div>
                    \`;
                    
                    coursesList.appendChild(item);
                });
                
                // Only show if in manual mode
                coursesSection.style.display = selectionMode === 'manual' ? 'block' : 'none';
            } else {
                coursesSection.style.display = 'none';
            }
            
            // Update search and quick select visibility based on mode
            if (selectionMode === 'manual') {
                searchContainer.style.display = 'block';
                quickSelectSection.style.display = 'none';
            } else {
                searchContainer.style.display = 'none';
                quickSelectSection.style.display = 'block';
            }
            
            // Update visual selection state after lists are populated
            setTimeout(updateSelectedVisuals, 50);
        }

        // Quick select handlers
        function quickSelectExercise() {
            const quickExercise = document.getElementById('quickExercise');
            const exerciseId = parseInt(quickExercise.getAttribute('data-exercise-id'));
            
            if (exerciseId) {
                // Switch to manual mode if in auto mode
                if (selectionMode === 'auto') {
                    selectionMode = 'manual';
                    updateSelectionModeUI();
                    updateManualListsVisibility();
                }
                
                // Find the full exercise object to get shortName
                const exercise = detectedExercises.find(ex => ex.id === exerciseId);
                if (exercise) {
                    selectChatContext('exercise', exercise.id, exercise.title, exercise.shortName);
                    updateSelectedVisuals();
                }
            }
        }

        function quickSelectCourse() {
            const quickCourse = document.getElementById('quickCourse');
            const courseId = parseInt(quickCourse.getAttribute('data-course-id'));
            
            if (courseId) {
                // Switch to manual mode if in auto mode
                if (selectionMode === 'auto') {
                    selectionMode = 'manual';
                    updateSelectionModeUI();
                    updateManualListsVisibility();
                }
                
                // Find the full course object to get shortName
                const course = detectedCourses.find(c => c.id === courseId);
                if (course) {
                    selectChatContext('course', course.id, course.title, course.shortName);
                    updateSelectedVisuals();
                }
            }
        }

        // List select handlers
        function selectExerciseFromList(exerciseId, exerciseTitle) {
            // Find the full exercise object to get shortName
            const exercise = detectedExercises.find(ex => ex.id === exerciseId);
            if (exercise) {
                selectChatContext('exercise', exercise.id, exercise.title, exercise.shortName);
                updateSelectedVisuals();
            }
        }

        function selectCourseFromList(courseId, courseTitle) {
            // Find the full course object to get shortName
            const course = detectedCourses.find(c => c.id === courseId);
            if (course) {
                selectChatContext('course', course.id, course.title, course.shortName);
                updateSelectedVisuals();
            }
        }
        
        // Filter context lists based on search input
        function filterContextLists() {
            const searchInput = document.getElementById('contextSearchInput');
            const searchTerm = searchInput.value.toLowerCase().trim();
            
            // Filter exercises list
            const exerciseItems = document.querySelectorAll('#exercisesList .context-list-item');
            let visibleExercises = 0;
            exerciseItems.forEach(item => {
                const titleElement = item.querySelector('.context-list-item-title');
                const title = titleElement ? titleElement.textContent.toLowerCase() : '';
                
                if (title.includes(searchTerm)) {
                    item.style.display = '';
                    visibleExercises++;
                } else {
                    item.style.display = 'none';
                }
            });
            
            // Filter courses list
            const courseItems = document.querySelectorAll('#coursesList .context-list-item');
            let visibleCourses = 0;
            courseItems.forEach(item => {
                const titleElement = item.querySelector('.context-list-item-title');
                const title = titleElement ? titleElement.textContent.toLowerCase() : '';
                
                if (title.includes(searchTerm)) {
                    item.style.display = '';
                    visibleCourses++;
                } else {
                    item.style.display = 'none';
                }
            });
            
            // Optionally hide sections if no results
            const exercisesSection = document.getElementById('exercisesListSection');
            const coursesSection = document.getElementById('coursesListSection');
            
            if (exercisesSection && visibleExercises === 0 && searchTerm !== '') {
                exercisesSection.style.opacity = '0.5';
            } else if (exercisesSection) {
                exercisesSection.style.opacity = '1';
            }
            
            if (coursesSection && visibleCourses === 0 && searchTerm !== '') {
                coursesSection.style.opacity = '0.5';
            } else if (coursesSection) {
                coursesSection.style.opacity = '1';
            }
        }
        
        // Update visual selection state
        function updateSelectedVisuals() {
            // Remove all selected classes
            document.querySelectorAll('.quick-select-item.selected').forEach(item => {
                item.classList.remove('selected');
            });
            document.querySelectorAll('.context-list-item.selected').forEach(item => {
                item.classList.remove('selected');
            });
            
            if (!selectedContext || !selectedItemId) {
                return;
            }
            
            // Add selected class to matching items
            if (selectedContext === 'exercise') {
                // Quick select
                const quickExercise = document.getElementById('quickExercise');
                if (quickExercise && quickExercise.getAttribute('data-exercise-id') == selectedItemId) {
                    quickExercise.classList.add('selected');
                }
                
                // List items
                const exerciseItem = document.querySelector(\`[data-exercise-id="\${selectedItemId}"]\`);
                if (exerciseItem && exerciseItem.classList.contains('context-list-item')) {
                    exerciseItem.classList.add('selected');
                }
            } else if (selectedContext === 'course') {
                // Quick select
                const quickCourse = document.getElementById('quickCourse');
                if (quickCourse && quickCourse.getAttribute('data-course-id') == selectedItemId) {
                    quickCourse.classList.add('selected');
                }
                
                // List items
                const courseItem = document.querySelector(\`[data-course-id="\${selectedItemId}"]\`);
                if (courseItem && courseItem.classList.contains('context-list-item')) {
                    courseItem.classList.add('selected');
                }
            }
        }

        // Update bean text based on selected context
        function updateBeanText() {
            const bean = document.getElementById('exerciseBean');
            const beanText = document.getElementById('exerciseBeanText');
            const beanIcon = document.getElementById('exerciseBeanIcon');
            
            if (bean && beanText && beanIcon) {
                if (!selectedContext || !selectedItemName) {
                    bean.classList.add('no-exercise');
                    beanText.textContent = 'NO CONTEXT';
                    beanIcon.innerHTML = '';
                } else {
                    bean.classList.remove('no-exercise');
                    
                    // Use the shortName if available, otherwise fallback to extraction from title
                    let shortName = selectedItemShortName;
                    
                    if (!shortName) {
                        // Fallback: Extract from title
                        // Try to extract number prefix (e.g., "11 - Title" -> "11")
                        const numberMatch = selectedItemName.match(/^(\d+)\s*[-–—]/);
                        if (numberMatch) {
                            shortName = numberMatch[1];
                        } else {
                            // Use first word or abbreviation
                            const firstWord = selectedItemName.split(/[\s-]/)[0];
                            shortName = firstWord;
                        }
                    }
                    
                    beanText.textContent = shortName.toUpperCase();
                    
                    // Set icon based on context type (course vs exercise)
                    beanIcon.innerHTML = getContextIcon(selectedContext);
                }
            }
        }

        // Initialize bean text
        (function() {
            updateBeanText();
            // Initialize selection mode UI to match the current mode
            updateSelectionModeUI();
            // Initialize search/quick select visibility based on initial selection mode
            updateManualListsVisibility();
        })();

        // Chat input is permanently disabled - event handlers commented out
        const chatInput = document.getElementById('chatInput');
        const sendButton = document.getElementById('sendButton');
        
        // Permanently disable input
        chatInput.disabled = true;
        sendButton.disabled = true;
        
        /* Disabled: Auto-resize textarea
        chatInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
            
            // Enable/disable send button based on content and context
            sendButton.disabled = !this.value.trim() || !selectedContext;
        });
        */
        
        /* Disabled: Handle Enter key (Shift+Enter for new line, Enter to send)
        chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!chatInput.disabled && chatInput.value.trim()) {
                    sendMessage();
                }
            }
        });
        */
        
        // Dropdown selection handler
        function selectChatContextFromDropdown() {
            const dropdown = document.getElementById('contextDropdown');
            const selectedValue = dropdown.value;
            
            // Hide all secondary selections first
            document.getElementById('courseSelection').style.display = 'none';
            document.getElementById('exerciseSelection').style.display = 'none';
            
            if (selectedValue === 'course') {
                // Show course selection
                document.getElementById('courseSelection').style.display = 'block';
                populateCourses();
                selectedContext = 'course';
                selectedItemId = null;
                selectedItemName = null;
            } else if (selectedValue === 'exercise') {
                // Show exercise selection
                document.getElementById('exerciseSelection').style.display = 'block';
                populateExercises();
                selectedContext = 'exercise';
                selectedItemId = null;
                selectedItemName = null;
            } else if (selectedValue === 'tutor') {
                // Tutor suggestions don't need specific selection
                selectChatContext('tutor', null, 'General Tutoring');
            } else {
                // Reset everything if no selection
                selectedContext = null;
                selectedItemId = null;
                selectedItemName = null;
            }
        }
        
        // Handle specific item selection (course or exercise)
        function selectSpecificItem() {
            const courseDropdown = document.getElementById('courseDropdown');
            const exerciseDropdown = document.getElementById('exerciseDropdown');
            
            if (selectedContext === 'course' && courseDropdown.value) {
                const selectedOption = courseDropdown.options[courseDropdown.selectedIndex];
                selectedItemId = courseDropdown.value;
                selectedItemName = selectedOption.text;
                selectChatContext('course', selectedItemId, selectedItemName);
            } else if (selectedContext === 'exercise' && exerciseDropdown.value) {
                const selectedOption = exerciseDropdown.options[exerciseDropdown.selectedIndex];
                selectedItemId = exerciseDropdown.value;
                selectedItemName = selectedOption.text;
                selectChatContext('exercise', selectedItemId, selectedItemName);
            }
        }
        
        // Populate courses dropdown
        function populateCourses() {
            const dropdown = document.getElementById('courseDropdown');
            dropdown.innerHTML = '<option value="">-- Choose a course --</option>';
            
            // Use detected courses if available
            if (detectedCourses && detectedCourses.length > 0) {
                detectedCourses.forEach(course => {
                    const option = document.createElement('option');
                    option.value = course.id;
                    option.textContent = course.title;
                    dropdown.appendChild(option);
                });
            } else {
                // Show placeholder if no courses detected
                const option = document.createElement('option');
                option.disabled = true;
                option.textContent = 'No courses detected. Open a course from Artemis view.';
                dropdown.appendChild(option);
            }
        }
        
        // Populate exercises dropdown (mock data for now)
        function populateExercises() {
            const dropdown = document.getElementById('exerciseDropdown');
            dropdown.innerHTML = '<option value="">-- Choose an exercise --</option>';
            
            // Use detected exercises if available
            if (detectedExercises && detectedExercises.length > 0) {
                detectedExercises.forEach(exercise => {
                    const option = document.createElement('option');
                    option.value = exercise.id;
                    option.textContent = exercise.title;
                    dropdown.appendChild(option);
                });
            } else {
                // Show placeholder if no exercises detected
                const option = document.createElement('option');
                option.disabled = true;
                option.textContent = 'No exercises detected. Open a course first.';
                dropdown.appendChild(option);
            }
        }
        
        // Context selection functions
        function selectChatContext(contextType, itemId = null, itemName = null, itemShortName = null, skipModeChange = false) {
            selectedContext = contextType;
            selectedItemId = itemId;
            selectedItemName = itemName;
            selectedItemShortName = itemShortName;
            
            // Set to manual mode unless this is an auto-selection
            if (!skipModeChange) {
                selectionMode = 'manual';
                updateSelectionModeUI();
                // Save state when explicitly switching to manual
                saveState();
            } else {
                // For auto-selection, just save the context without changing mode
                // Only update the context fields in state, preserve the mode
                const currentState = vscode.getState() || {};
                vscode.setState({
                    ...currentState,
                    selectedContext: selectedContext,
                    selectedItemId: selectedItemId,
                    selectedItemName: selectedItemName,
                    selectedItemShortName: selectedItemShortName
                });
            }
            
            // Update bean text
            updateBeanText();
            
            // Update dropdown to match selection (if it exists)
            const dropdown = document.getElementById('contextDropdown');
            if (dropdown) {
                dropdown.value = contextType;
            }
            
            // Show context confirmation message
            const welcomeText = document.querySelector('.welcome-text');
            if (welcomeText) {
                const contextNames = {
                    'course': 'Course Chat',
                    'exercise': 'Exercise Chat',
                    'tutor': 'Tutor Suggestions'
                };
                
                let message = \`Selected: <strong>\${contextNames[contextType]}</strong>\`;
                if (itemName) {
                    message += \` • <strong>\${itemName}</strong>\`;
                }
                message += '<br><strong>Note: Iris is currently disabled and will be enabled later.</strong>';
                
                welcomeText.innerHTML = message;
            }
            
            // Chat input is permanently disabled
            const chatInput = document.getElementById('chatInput');
            const sendButton = document.getElementById('sendButton');
            const newConversationBtn = document.getElementById('newConversationBtn');
            
            // chatInput.disabled = false; // Disabled permanently
            chatInput.placeholder = 'Chat input is currently disabled';
            // chatInput.focus();
            
            // Keep send button disabled
            sendButton.disabled = true;
            
            // Enable new conversation button
            if (newConversationBtn) {
                newConversationBtn.style.opacity = '1';
                newConversationBtn.style.pointerEvents = 'auto';
            }
            
            // Send context selection to extension
            vscode.postMessage({
                command: 'selectChatContext',
                context: contextType,
                itemId: itemId,
                itemName: itemName,
                itemShortName: itemShortName
            });
        }
        
        function newConversation() {
            if (selectedContext) {
                // Reset the conversation but keep the same context
                const chatMessages = document.getElementById('chatMessages');
                chatMessages.innerHTML = \`
                    <div class="welcome-message">
                        <div class="welcome-icon">🤖</div>
                        <p class="welcome-text">New conversation started! How can I help you today?</p>
                    </div>
                \`;
                
                vscode.postMessage({
                    command: 'newConversation',
                    context: selectedContext
                });
            }
        }
        
        function clearHistory() {
            if (confirm('Are you sure you want to clear all chat history? This cannot be undone.')) {
                selectedContext = null;
                selectedItemId = null;
                selectedItemName = null;
                const chatInput = document.getElementById('chatInput');
                const sendButton = document.getElementById('sendButton');
                const dropdown = document.getElementById('contextDropdown');
                const courseDropdown = document.getElementById('courseDropdown');
                const exerciseDropdown = document.getElementById('exerciseDropdown');
                const newConversationBtn = document.getElementById('newConversationBtn');
                
                // Reset to initial state
                const chatMessages = document.getElementById('chatMessages');
                chatMessages.innerHTML = \`
                    <div class="welcome-message">
                        <p class="welcome-text">
                            Welcome to Iris Chat!<br>
                            <strong>Note: Iris is currently disabled and will be enabled later.</strong><br>
                            Please select a chat context from the menu (☰) to get started.
                        </p>
                    </div>
                \`;
                
                // Disable chat input
                chatInput.disabled = true;
                chatInput.placeholder = 'Select a chat context first...';
                chatInput.value = '';
                sendButton.disabled = true;
                
                // Reset all dropdowns
                dropdown.value = '';
                courseDropdown.value = '';
                exerciseDropdown.value = '';
                
                // Hide secondary selections
                document.getElementById('courseSelection').style.display = 'none';
                document.getElementById('exerciseSelection').style.display = 'none';
                
                // Disable new conversation button
                if (newConversationBtn) {
                    newConversationBtn.style.opacity = '0.5';
                    newConversationBtn.style.pointerEvents = 'none';
                }
                
                vscode.postMessage({
                    command: 'clearHistory'
                });
            }
        }

        function openDiagnostics() {
            // Gather selection mode state information
            const searchContainer = document.getElementById('searchContainer');
            const quickSelectSection = document.getElementById('quickSelectSection');
            const exercisesSection = document.getElementById('exercisesListSection');
            const coursesSection = document.getElementById('coursesListSection');
            const modeButton = document.getElementById('selectionModeButton');
            const modeText = document.getElementById('selectionModeText');
            const currentState = vscode.getState();
            
            // Send message to extension to log diagnostics with selection mode info
            vscode.postMessage({
                command: 'openDiagnostics',
                selectionModeInfo: {
                    currentMode: selectionMode,
                    savedStateMode: currentState ? currentState.selectionMode : 'none',
                    uiButtonText: modeText ? modeText.textContent : 'unknown',
                    uiButtonClass: modeButton ? modeButton.className : 'unknown',
                    searchContainerDisplay: searchContainer ? searchContainer.style.display : 'unknown',
                    quickSelectDisplay: quickSelectSection ? quickSelectSection.style.display : 'unknown',
                    exercisesSectionDisplay: exercisesSection ? exercisesSection.style.display : 'unknown',
                    coursesSectionDisplay: coursesSection ? coursesSection.style.display : 'unknown'
                }
            });
        }

        function toggleSelectionMode(event) {
            // Stop event propagation to prevent closing the menu
            if (event) {
                event.stopPropagation();
            }
            
            // Toggle between auto and manual
            selectionMode = selectionMode === 'auto' ? 'manual' : 'auto';
            
            // Clear search input when switching modes
            const searchInput = document.getElementById('contextSearchInput');
            if (searchInput) {
                searchInput.value = '';
                // Reset filter by calling the filter function
                filterContextLists();
            }
            
            // Update UI
            updateSelectionModeUI();
            
            // Show/hide manual lists
            updateManualListsVisibility();
            
            // If switching to auto, trigger auto-selection
            if (selectionMode === 'auto') {
                autoSelectContext();
            }
            
            // Save state to persist across webview reloads
            saveState();
        }

        function updateSelectionModeUI() {
            const icon = document.getElementById('selectionModeIcon');
            const text = document.getElementById('selectionModeText');
            const description = document.getElementById('selectionModeDescription');
            const button = document.getElementById('selectionModeButton');
            
            if (selectionMode === 'auto') {
                icon.innerHTML = ICONS.refresh;
                text.textContent = 'Auto Selection';
                description.textContent = 'System automatically selects context';
                if (button) {
                    button.classList.add('is-auto');
                    button.classList.remove('is-manual');
                }
            } else {
                icon.innerHTML = ICONS.cursor;
                text.textContent = 'Manual Selection';
                description.textContent = 'You choose the context manually';
                if (button) {
                    button.classList.add('is-manual');
                    button.classList.remove('is-auto');
                }
            }
        }

        function updateManualListsVisibility() {
            const exercisesSection = document.getElementById('exercisesListSection');
            const coursesSection = document.getElementById('coursesListSection');
            const searchContainer = document.getElementById('searchContainer');
            const quickSelectSection = document.getElementById('quickSelectSection');
            
            if (selectionMode === 'manual') {
                // Show search input in manual mode
                searchContainer.style.display = 'block';
                // Hide quick select in manual mode
                quickSelectSection.style.display = 'none';
                
                // Show lists if they have content
                if (detectedExercises && detectedExercises.length > 0) {
                    exercisesSection.style.display = 'block';
                }
                if (detectedCourses && detectedCourses.length > 0) {
                    coursesSection.style.display = 'block';
                }
            } else {
                // Hide search input in auto mode
                searchContainer.style.display = 'none';
                // Show quick select in auto mode
                quickSelectSection.style.display = 'block';
                
                // Hide lists in auto mode
                exercisesSection.style.display = 'none';
                coursesSection.style.display = 'none';
            }
        }

        function autoSelectContext() {
            // Auto-select top exercise or course based on priority
            if (detectedExercises && detectedExercises.length > 0) {
                // Sort exercises by priority to get the top one
                const sortedExercises = [...detectedExercises].sort((a, b) => {
                    return calculateExercisePriority(b) - calculateExercisePriority(a);
                });
                
                if (sortedExercises.length > 0) {
                    const topExercise = sortedExercises[0];
                    selectChatContext('exercise', topExercise.id, topExercise.title, topExercise.shortName, true); // true = skip setting to manual
                    updateSelectedVisuals();
                }
            } else if (detectedCourses && detectedCourses.length > 0) {
                // If no exercises but we have courses, select top course
                const topCourse = detectedCourses[0];
                selectChatContext('course', topCourse.id, topCourse.title, topCourse.shortName, true); // true = skip setting to manual
                updateSelectedVisuals();
            }
        }
        
        function sendMessage() {
            const messageText = chatInput.value.trim();
            if (!messageText || !selectedContext) return;
            
            // Add user message to chat
            addMessage(messageText, 'user');
            
            // Clear input
            chatInput.value = '';
            chatInput.style.height = 'auto';
            
            // Show typing indicator
            showTypingIndicator();
            
            // Send to extension
            vscode.postMessage({
                command: 'sendMessage',
                message: messageText,
                context: selectedContext
            });
        }
        
        function addMessage(text, sender) {
            const chatMessages = document.getElementById('chatMessages');
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${sender}\`;
            messageDiv.textContent = text;
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        function showTypingIndicator() {
            const chatMessages = document.getElementById('chatMessages');
            const typingDiv = document.createElement('div');
            typingDiv.className = 'message iris typing';
            typingDiv.id = 'typingIndicator';
            typingDiv.textContent = 'Iris is thinking...';
            chatMessages.appendChild(typingDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        function hideTypingIndicator() {
            const typingIndicator = document.getElementById('typingIndicator');
            if (typingIndicator) {
                typingIndicator.remove();
            }
        }
        
        // Send button functionality
        document.getElementById('sendButton').addEventListener('click', function() {
            sendMessage();
        });
        
        // Help popup functions
        function showHelpPopup() {
            const helpOverlay = document.getElementById('helpOverlay');
            const helpPopup = document.getElementById('helpPopup');
            
            helpOverlay.classList.add('open');
            helpPopup.classList.add('open');
            
            // Close side menu if it's open
            closeSideMenu();
            
            // Prevent body scroll
            document.body.style.overflow = 'hidden';
        }
        
        function closeHelpPopup() {
            const helpOverlay = document.getElementById('helpOverlay');
            const helpPopup = document.getElementById('helpPopup');
            
            helpOverlay.classList.remove('open');
            helpPopup.classList.remove('open');
            
            // Re-enable body scroll
            document.body.style.overflow = '';
        }
        
                // Close help popup when pressing Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                const helpPopup = document.getElementById('helpPopup');
                if (helpPopup.classList.contains('open')) {
                    closeHelpPopup();
                } else {
                    closeSideMenu();
                }
            }
        });
        
        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'irisResponse':
                    hideTypingIndicator();
                    addMessage(message.response, 'iris');
                    break;
                case 'irisError':
                    hideTypingIndicator();
                    addMessage('Sorry, I encountered an error. Please try again later.', 'iris');
                    break;
                case 'coursesData':
                    updateCoursesDropdown(message.courses);
                    break;
                case 'exercisesData':
                    updateExercisesDropdown(message.exercises);
                    break;
                case 'updateDetectedExercises':
                    updateDetectedExercises(message.exercises);
                    break;
                case 'updateDetectedCourses':
                    updateDetectedCourses(message.courses);
                    break;
                case 'autoSelectContext':
                    // Auto-select context from extension
                    handleAutoSelectContext(message.context);
                    break;
            }
        });
        
        // Handle auto-selected context from extension
        function handleAutoSelectContext(context) {
            if (context && context.type && context.id && context.title) {
                // Use skipModeChange=true to preserve the current selection mode
                selectChatContext(context.type, context.id, context.title, context.shortName, true);
                console.log('[Auto-Select] Context set: ' + context.type + ' - ' + context.title);
            }
        }
        
        // Update courses dropdown with real data
        function updateCoursesDropdown(courses) {
            const dropdown = document.getElementById('courseDropdown');
            dropdown.innerHTML = '<option value="">-- Choose a course --</option>';
            
            if (courses && courses.length > 0) {
                courses.forEach(course => {
                    const option = document.createElement('option');
                    option.value = course.id;
                    option.textContent = course.title || course.name;
                    dropdown.appendChild(option);
                });
            }
        }
        
        // Update exercises dropdown with real data
        function updateExercisesDropdown(exercises) {
            const dropdown = document.getElementById('exerciseDropdown');
            dropdown.innerHTML = '<option value="">-- Choose an exercise --</option>';
            
            if (exercises && exercises.length > 0) {
                exercises.forEach(exercise => {
                    const option = document.createElement('option');
                    option.value = exercise.id;
                    option.textContent = exercise.title || exercise.name;
                    dropdown.appendChild(option);
                });
            }
        }
    </script>
</body>
</html>`;
    }
}
