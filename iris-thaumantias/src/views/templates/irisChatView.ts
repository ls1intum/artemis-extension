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

        const trashIcon = IconDefinitions.getIcon('trash');
        const stethoscopeIcon = IconDefinitions.getIcon('stethoscope');
        const questionMarkIcon = IconDefinitions.getIcon('question-mark');

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
    <div class="chat-container">
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

        <div class="context-bean-container" id="contextBeanContainer">
            <div class="context-bean" id="contextBean">
                <div class="context-bean-header" onclick="toggleContextDropdown()">
                    <div class="context-info">
                        <span class="context-lock-icon" id="contextLockIcon" style="display: none;">🔒</span>
                        <span class="context-icon" id="contextIcon">📚</span>
                        <div class="context-text-container">
                            <span class="context-text" id="contextText">No context selected</span>
                            <span class="context-subtext" id="contextSubtext" style="display: none;"></span>
                        </div>
                    </div>
                    <span class="context-dropdown-arrow" id="contextDropdownArrow">▼</span>
                </div>

                <div class="context-dropdown-menu" id="contextDropdownMenu" style="display: none;">
                    <div class="context-search-container">
                        <input
                            type="text"
                            class="context-search-input"
                            id="contextSearchInput"
                            placeholder="Search exercises or courses..."
                            autocomplete="off"
                        />
                    </div>

                    <div class="search-results-section" id="searchResultsSection" style="display: none;">
                        <div class="search-results" id="searchResults"></div>
                    </div>

                    <div class="session-section" id="sessionSection" style="display: none;">
                        <div class="dropdown-section-header">Sessions</div>
                        <div class="session-list" id="sessionList"></div>
                        <div class="dropdown-divider"></div>
                        <div class="dropdown-section">
                            <button class="dropdown-action-btn" onclick="createNewSession()">
                                ➕ New Conversation
                            </button>
                            <button class="dropdown-action-btn" onclick="requestContextSwitch()">
                                🔄 Switch to Different Context
                            </button>
                        </div>
                    </div>

                    <div class="context-picker-section" id="contextPickerSection" style="display: none;">
                        <div class="context-picker-group">
                            <div class="dropdown-section-header">Recent Exercises</div>
                            <div class="context-list" id="recentExercisesList"></div>
                        </div>
                        <div class="context-picker-group">
                            <div class="dropdown-section-header">Recent Courses</div>
                            <div class="context-list" id="recentCoursesList"></div>
                        </div>
                        <div class="dropdown-divider"></div>
                        <div class="context-empty-info">
                            Start typing to search all available exercises and courses.
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="chat-messages" id="chatMessages">
            <div class="welcome-message">
                <p class="welcome-text">
                    Welcome to Iris Chat!<br>
                    <strong>Note: Chat responses are currently disabled.</strong><br>
                    Select or search for a context to begin organising your conversations.
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
                        <span class="help-icon">💻</span>
                        <h3>Exercises</h3>
                    </div>
                    <div class="help-section-content">
                        <p><strong>Best for:</strong> Hands-on programming work, debugging, and implementation hints.</p>
                        <p><strong>Use when you want to:</strong></p>
                        <ul>
                            <li>Understand or refine your solution approach</li>
                            <li>Debug code or clarify error messages</li>
                            <li>Get targeted hints about the next step</li>
                        </ul>
                    </div>
                </div>
                <div class="help-section">
                    <div class="help-section-header">
                        <span class="help-icon">📚</span>
                        <h3>Courses</h3>
                    </div>
                    <div class="help-section-content">
                        <p><strong>Best for:</strong> Conceptual understanding, broader course context, or lecture materials.</p>
                        <p><strong>Use when you want to:</strong></p>
                        <ul>
                            <li>Clarify theoretical concepts</li>
                            <li>Understand how exercises fit into the course</li>
                            <li>Plan your learning path across topics</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="menu-overlay" id="menuOverlay" onclick="closeSideMenu()"></div>
    <div class="side-menu" id="sideMenu">
        <div class="side-menu-header">
            <h3 class="side-menu-title">Menu</h3>
            <button class="close-menu-btn" onclick="closeSideMenu()" title="Close Menu">×</button>
        </div>
        <div class="side-menu-content">
            <div class="menu-section">
                <h4 class="menu-section-title">Chat Options</h4>
                <div class="menu-item" onclick="clearHistory()">
                    ${trashIcon}
                    <div class="menu-item-content">
                        <div class="menu-item-title">Clear History</div>
                        <div class="menu-item-description">Reset chat and remove all saved conversations</div>
                    </div>
                </div>
            </div>

            <div class="menu-section">
                <h4 class="menu-section-title">Help</h4>
                <div class="menu-item" onclick="openHelpPopup()">
                    ${questionMarkIcon}
                    <div class="menu-item-content">
                        <div class="menu-item-title">Chat Context Guide</div>
                        <div class="menu-item-description">Learn how contexts impact responses</div>
                    </div>
                </div>
                ${showDiagnostics ? `
                <div class="menu-item" onclick="openDiagnostics()">
                    ${stethoscopeIcon}
                    <div class="menu-item-content">
                        <div class="menu-item-title">Diagnostics</div>
                        <div class="menu-item-description">View detailed context and session state</div>
                    </div>
                </div>
                ` : ''}
            </div>

            <div class="menu-section">
                <h4 class="menu-section-title">About</h4>
                <div class="menu-info">
                    <strong>Iris Chat</strong><br>
                    AI-powered guidance tailored to your Artemis coursework and exercises.
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        window.toggleSideMenu = function() {
            const sideMenu = document.getElementById('sideMenu');
            const menuOverlay = document.getElementById('menuOverlay');
            const burger = document.querySelector('.burger-menu');
            const isOpen = sideMenu.classList.contains('open');

            if (isOpen) {
                sideMenu.classList.remove('open');
                menuOverlay.classList.remove('open');
                burger?.classList.remove('active');
            } else {
                sideMenu.classList.add('open');
                menuOverlay.classList.add('open');
                burger?.classList.add('active');
            }
        };

        window.closeSideMenu = function() {
            document.getElementById('sideMenu').classList.remove('open');
            document.getElementById('menuOverlay').classList.remove('open');
            document.querySelector('.burger-menu')?.classList.remove('active');
        };

        window.openHelpPopup = function() {
            document.getElementById('helpOverlay').classList.add('open');
            document.getElementById('helpPopup').classList.add('open');
            closeSideMenu();
        };

        window.closeHelpPopup = function() {
            document.getElementById('helpOverlay').classList.remove('open');
            document.getElementById('helpPopup').classList.remove('open');
        };

        let irisState = {
            context: null,
            activeSessionId: null,
            sessions: [],
            recentExercises: [],
            recentCourses: [],
            allExercises: [],
            allCourses: []
        };

        let searchQuery = '';
        let forceContextPicker = false;

        const previousState = vscode.getState();
        if (previousState && previousState.irisState) {
            irisState = previousState.irisState;
            searchQuery = previousState.searchQuery || '';
            forceContextPicker = !!previousState.forceContextPicker;
        }

        function saveState() {
            vscode.setState({
                irisState,
                searchQuery,
                forceContextPicker
            });
        }

        window.toggleContextDropdown = function() {
            const dropdown = document.getElementById('contextDropdownMenu');
            const arrow = document.getElementById('contextDropdownArrow');
            const isOpen = dropdown.style.display === 'block';

            dropdown.style.display = isOpen ? 'none' : 'block';
            arrow.textContent = isOpen ? '▼' : '▲';

            if (!isOpen) {
                const input = document.getElementById('contextSearchInput');
                if (input) {
                    input.value = searchQuery;
                    setTimeout(() => input.focus(), 0);
                }
                updateDropdownContent();
            } else {
                resetSearch(false);
                forceContextPicker = false;
            }
        };

        window.closeDropdown = function() {
            const dropdown = document.getElementById('contextDropdownMenu');
            const arrow = document.getElementById('contextDropdownArrow');
            dropdown.style.display = 'none';
            arrow.textContent = '▼';
            resetSearch(false);
            forceContextPicker = false;
        };

        window.selectContext = function(type, id, title, shortName) {
            vscode.postMessage({
                command: 'selectChatContext',
                context: type,
                itemId: id,
                itemName: title,
                itemShortName: shortName
            });
            closeDropdown();
        };

        window.selectSession = function(sessionId) {
            vscode.postMessage({ command: 'switchSession', sessionId });
            closeDropdown();
        };

        window.createNewSession = function() {
            vscode.postMessage({ command: 'createNewSession' });
            closeDropdown();
        };

        window.requestContextSwitch = function() {
            vscode.postMessage({ command: 'switchContext' });
        };

        window.clearHistory = function() {
            if (confirm('Clear all chat history?')) {
                vscode.postMessage({ command: 'clearHistory' });
                closeSideMenu();
            }
        };

        window.openDiagnostics = function() {
            vscode.postMessage({ command: 'openDiagnostics' });
            closeSideMenu();
        };

        function updateContextBean() {
            const lockIcon = document.getElementById('contextLockIcon');
            const contextIcon = document.getElementById('contextIcon');
            const contextText = document.getElementById('contextText');
            const contextSubtext = document.getElementById('contextSubtext');

            if (!irisState.context) {
                lockIcon.style.display = 'none';
                contextIcon.textContent = '📚';
                contextText.textContent = 'No context selected';
                contextSubtext.textContent = 'Click to choose or search';
                contextSubtext.style.display = 'block';
                return;
            }

            lockIcon.style.display = irisState.context.locked ? 'inline' : 'none';
            contextIcon.textContent = irisState.context.type === 'course' ? '📚' : '💻';

            let title = irisState.context.title;
            if (title.includes('(Workspace)')) {
                title = title.replace(' (Workspace)', '');
            }
            contextText.textContent = title;

            const activeSession = irisState.sessions.find(session => session.id === irisState.activeSessionId);
            if (activeSession) {
                contextSubtext.textContent = \`\${activeSession.messageCount} messages\`;
                contextSubtext.style.display = 'block';
            } else {
                contextSubtext.style.display = 'none';
            }
        }

        function updateDropdownContent() {
            const sessionSection = document.getElementById('sessionSection');
            const contextPickerSection = document.getElementById('contextPickerSection');
            const searchSection = document.getElementById('searchResultsSection');

            if (searchQuery && searchQuery.length > 0) {
                sessionSection.style.display = 'none';
                contextPickerSection.style.display = 'none';
                searchSection.style.display = 'block';
                renderSearchResults();
                return;
            }

            searchSection.style.display = 'none';

            if (irisState.context && !forceContextPicker) {
                sessionSection.style.display = 'block';
                contextPickerSection.style.display = 'none';
                renderSessionList();
            } else {
                sessionSection.style.display = 'none';
                contextPickerSection.style.display = 'block';
                renderRecentLists();
            }
        }

        function renderSessionList() {
            const list = document.getElementById('sessionList');
            list.innerHTML = '';

            if (!irisState.sessions || irisState.sessions.length === 0) {
                list.innerHTML = '<div class="session-empty">No sessions yet</div>';
                return;
            }

            irisState.sessions.forEach(session => {
                const isActive = session.id === irisState.activeSessionId;
                const element = document.createElement('div');
                element.className = 'session-item' + (isActive ? ' active' : '');
                element.onclick = () => window.selectSession(session.id);
                element.innerHTML = \`
                    <div class="session-item-content">
                        <div class="session-item-header">
                            \${isActive ? '<span class="session-active-indicator">✓</span>' : ''}
                            <span class="session-item-title">\${session.preview || 'Conversation'}</span>
                        </div>
                        <div class="session-item-meta">
                            <span>\${session.messageCount} messages</span>
                            ·
                            <span>\${new Date(session.lastActivity).toLocaleString()}</span>
                        </div>
                    </div>
                \`;
                list.appendChild(element);
            });
        }

        function renderRecentLists() {
            const exercisesList = document.getElementById('recentExercisesList');
            const coursesList = document.getElementById('recentCoursesList');

            exercisesList.innerHTML = '';
            coursesList.innerHTML = '';

            if (irisState.recentExercises.length === 0) {
                exercisesList.innerHTML = '<div class="context-empty">No exercises yet</div>';
            } else {
                irisState.recentExercises.forEach(exercise => {
                    const element = document.createElement('div');
                    element.className = 'context-item';
                    element.onclick = () => window.selectContext('exercise', exercise.id, exercise.title, exercise.shortName);
                    const isWorkspace = exercise.isWorkspace || /\\(Workspace\\)/i.test(exercise.title);
                    element.innerHTML = \`
                        <div class="context-item-icon">💻</div>
                        <div class="context-item-content">
                            <div class="context-item-title">\${isWorkspace ? '🔒 ' : ''}\${exercise.title}</div>
                            \${exercise.shortName ? \`<div class="context-item-subtitle">\${exercise.shortName}</div>\` : ''}
                        </div>
                    \`;
                    exercisesList.appendChild(element);
                });
            }

            if (irisState.recentCourses.length === 0) {
                coursesList.innerHTML = '<div class="context-empty">No courses yet</div>';
            } else {
                irisState.recentCourses.forEach(course => {
                    const element = document.createElement('div');
                    element.className = 'context-item';
                    element.onclick = () => window.selectContext('course', course.id, course.title, course.shortName);
                    element.innerHTML = \`
                        <div class="context-item-icon">📚</div>
                        <div class="context-item-content">
                            <div class="context-item-title">\${course.title}</div>
                            \${course.shortName ? \`<div class="context-item-subtitle">\${course.shortName}</div>\` : ''}
                        </div>
                    \`;
                    coursesList.appendChild(element);
                });
            }
        }

        function renderSearchResults() {
            const container = document.getElementById('searchResults');
            container.innerHTML = '';

            const query = searchQuery.trim().toLowerCase();
            if (!query) {
                return;
            }

            const matchingExercises = (irisState.allExercises || []).filter(item =>
                item.title.toLowerCase().includes(query) ||
                (item.shortName && item.shortName.toLowerCase().includes(query)) ||
                (item.repositoryUri && item.repositoryUri.toLowerCase().includes(query))
            );

            const matchingCourses = (irisState.allCourses || []).filter(item =>
                item.title.toLowerCase().includes(query) ||
                (item.shortName && item.shortName.toLowerCase().includes(query))
            );

            if (matchingExercises.length === 0 && matchingCourses.length === 0) {
                container.innerHTML = '<div class="search-empty">No matching items found</div>';
                return;
            }

            if (matchingExercises.length > 0) {
                const section = document.createElement('div');
                section.className = 'search-section';
                section.innerHTML = '<div class="search-section-header">Exercises</div>';
                matchingExercises.forEach(item => {
                    const element = document.createElement('div');
                    element.className = 'search-result-item';
                    element.onclick = () => window.selectContext('exercise', item.id, item.title, item.shortName);
                    const isWorkspace = item.isWorkspace || /\\(Workspace\\)/i.test(item.title);
                    element.innerHTML = \`
                        <div class="search-result-icon">💻</div>
                        <div class="search-result-content">
                            <div class="search-result-title">\${isWorkspace ? '🔒 ' : ''}\${item.title}</div>
                            \${item.shortName ? \`<div class="search-result-subtitle">\${item.shortName}</div>\` : ''}
                        </div>
                    \`;
                    section.appendChild(element);
                });
                container.appendChild(section);
            }

            if (matchingCourses.length > 0) {
                const section = document.createElement('div');
                section.className = 'search-section';
                section.innerHTML = '<div class="search-section-header">Courses</div>';
                matchingCourses.forEach(item => {
                    const element = document.createElement('div');
                    element.className = 'search-result-item';
                    element.onclick = () => window.selectContext('course', item.id, item.title, item.shortName);
                    element.innerHTML = \`
                        <div class="search-result-icon">📚</div>
                        <div class="search-result-content">
                            <div class="search-result-title">\${item.title}</div>
                            \${item.shortName ? \`<div class="search-result-subtitle">\${item.shortName}</div>\` : ''}
                        </div>
                    \`;
                    section.appendChild(element);
                });
                container.appendChild(section);
            }
        }

        function resetSearch(shouldUpdate = true) {
            searchQuery = '';
            const input = document.getElementById('contextSearchInput');
            if (input) {
                input.value = '';
            }
            if (shouldUpdate) {
                updateDropdownContent();
            }
            saveState();
        }

        const searchInput = document.getElementById('contextSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', event => {
                searchQuery = event.target.value;
                updateDropdownContent();
                saveState();
            });
            searchInput.addEventListener('keydown', event => {
                if (event.key === 'Escape') {
                    resetSearch();
                    event.stopPropagation();
                }
            });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateIrisState':
                    if (message.state) {
                        irisState = message.state;
                        updateContextBean();
                        updateDropdownContent();
                        saveState();
                    }
                    break;
                case 'showContextPicker':
                    if (message.state) {
                        irisState = message.state;
                        forceContextPicker = true;
                        searchQuery = '';
                        const dropdown = document.getElementById('contextDropdownMenu');
                        const arrow = document.getElementById('contextDropdownArrow');
                        dropdown.style.display = 'block';
                        arrow.textContent = '▲';
                        updateContextBean();
                        updateDropdownContent();
                        const input = document.getElementById('contextSearchInput');
                        if (input) {
                            input.value = '';
                            setTimeout(() => input.focus(), 0);
                        }
                        saveState();
                    }
                    break;
                case 'clearChatMessages':
                    const chatMessages = document.getElementById('chatMessages');
                    chatMessages.innerHTML = \`
                        <div class="welcome-message">
                            <p class="welcome-text">New conversation created! 🎉</p>
                        </div>
                    \`;
                    break;
            }
        });

        document.addEventListener('click', event => {
            const bean = document.getElementById('contextBean');
            const dropdown = document.getElementById('contextDropdownMenu');
            if (dropdown.style.display === 'block' && bean && !bean.contains(event.target)) {
                window.closeDropdown();
            }
        });

        updateContextBean();
        updateDropdownContent();
    </script>
</body>
</html>`;
    }
}
