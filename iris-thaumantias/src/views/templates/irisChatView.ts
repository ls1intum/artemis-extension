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
        const refreshIcon = IconDefinitions.getIcon('refresh');

        // Get the path to the iris logo image
        let irisLogoSrc = '';
        if (webview) {
            const irisLogoUri = vscode.Uri.file(
                this._extensionContext.asAbsolutePath('media/iris-logo-big-left.png')
            );
            irisLogoSrc = webview.asWebviewUri(irisLogoUri).toString();
        }

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
            ${irisLogoSrc ? `<img src="${irisLogoSrc}" alt="Iris Logo" class="chat-header-logo" />` : ''}
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
                            <button class="dropdown-action-btn" id="newSessionBtn" onclick="createNewSession()" disabled>
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
                    Select or search for a context to begin chatting with Iris.
                </p>
            </div>
        </div>

        <div class="chat-input-container">
            <div class="websocket-status-banner" id="websocketStatusBanner" style="display: none;">
                <div class="websocket-status-content">
                    <span class="websocket-status-icon">⚠️</span>
                    <span class="websocket-status-text">WebSocket disconnected</span>
                </div>
                <button class="websocket-reconnect-btn" id="reconnectButton" onclick="reconnectWebSocket()">
                    Reconnect
                </button>
            </div>
            <div class="chat-input-wrapper">
                <textarea
                    class="chat-input"
                    id="chatInput"
                    placeholder="Select a context to start chatting"
                    rows="1"
                    disabled
                    readonly
                ></textarea>
                <button class="send-button" id="sendButton" disabled>
                    Send
                </button>
            </div>
            <div class="iris-disclaimer-banner">
                <span class="disclaimer-text">
                    Iris only has access to your submitted code.
                    Iris can make mistakes. Consider verifying important information. 
                </span>
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
                <div class="menu-item" onclick="resetChatSessions()">
                    ${refreshIcon}
                    <div class="menu-item-content">
                        <div class="menu-item-title">Reset & Sync Sessions</div>
                        <div class="menu-item-description">Clear local data and reload from server</div>
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
                <div class="menu-item" onclick="debugSessions()">
                    ${stethoscopeIcon}
                    <div class="menu-item-content">
                        <div class="menu-item-title">Debug Sessions (Raw)</div>
                        <div class="menu-item-description">View raw Artemis session data</div>
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
            closeMenu();
        };

        window.debugSessions = function() {
            vscode.postMessage({ command: 'debugSessions' });
            closeMenu();
        };

        window.resetChatSessions = function() {
            vscode.postMessage({ command: 'resetChatSessions' });
            closeMenu();
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

            // Sort sessions by lastActivity, newest first
            const sortedSessions = [...irisState.sessions].sort((a, b) => {
                const dateA = new Date(a.lastActivity).getTime();
                const dateB = new Date(b.lastActivity).getTime();
                return dateB - dateA; // Descending order (newest first)
            });

            sortedSessions.forEach(session => {
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

        // Chat message handling
        function handleFeedbackClick(button, message) {
            const feedbackType = button.getAttribute('data-feedback');
            const parentMessage = button.closest('.chat-message');
            const feedbackContainer = parentMessage.querySelector('.message-feedback');
            const allButtons = parentMessage.querySelectorAll('.feedback-button');

            console.log('Feedback clicked:', feedbackType, 'for message:', message);

            // Don't allow clicking the same button again (no undo, only change)
            if (button.classList.contains('selected')) {
                return;
            }

            // Check if we have the required IDs
            const activeSession = irisState.sessions.find(session => session.id === irisState.activeSessionId);
            if (!activeSession || !activeSession.artemisSessionId) {
                console.warn('No active Artemis session found');
                return;
            }

            if (!message.id) {
                console.warn('Message has no ID, cannot submit feedback');
                return;
            }

            // Remove selection from all buttons
            allButtons.forEach(btn => {
                btn.classList.remove('selected');
            });

            // Select the clicked button
            button.classList.add('selected');

            // Add has-feedback class to keep buttons visible
            if (feedbackContainer) {
                feedbackContainer.classList.add('has-feedback');
            }

            // Update the message object's helpful field
            message.helpful = feedbackType === 'positive' ? true : false;

            // Send feedback to extension
            vscode.postMessage({
                command: 'messageFeedback',
                sessionId: activeSession.artemisSessionId,
                messageId: message.id,
                feedback: feedbackType,
                message: message
            });
        }

        function addMessageToChat(message) {
            console.log('Adding message to chat:', message);
            const chatMessages = document.getElementById('chatMessages');

            // Remove welcome message if present
            const welcomeMsg = chatMessages.querySelector('.welcome-message');
            if (welcomeMsg) {
                welcomeMsg.remove();
            }

            const messageDiv = document.createElement('div');
            messageDiv.className = \`chat-message \${message.role}\`;

            const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const feedbackButtons = message.role === 'assistant' ? \`
                <div class="message-feedback">
                    <button class="feedback-button thumbs-up" data-feedback="positive" title="This was helpful">
                        <svg viewBox="0 0 512 512" aria-hidden="true">
                            <path fill="currentColor" d="M80 160c17.7 0 32 14.3 32 32l0 256c0 17.7-14.3 32-32 32l-48 0c-17.7 0-32-14.3-32-32L0 192c0-17.7 14.3-32 32-32l48 0zM270.6 16C297.9 16 320 38.1 320 65.4l0 4.2c0 6.8-1.3 13.6-3.8 19.9L288 160 448 160c26.5 0 48 21.5 48 48 0 19.7-11.9 36.6-28.9 44 17 7.4 28.9 24.3 28.9 44 0 23.4-16.8 42.9-39 47.1 4.4 7.3 7 15.8 7 24.9 0 22.2-15 40.8-35.4 46.3 2.2 5.5 3.4 11.5 3.4 17.7 0 26.5-21.5 48-48 48l-87.9 0c-36.3 0-71.6-12.4-99.9-35.1L184 435.2c-15.2-12.1-24-30.5-24-50l0-186.6c0-14.9 3.5-29.6 10.1-42.9L226.3 43.3C234.7 26.6 251.8 16 270.6 16z"></path>
                        </svg>
                    </button>
                    <button class="feedback-button thumbs-down" data-feedback="negative" title="This could be better">
                        <svg viewBox="0 0 512 512" aria-hidden="true">
                            <path fill="currentColor" d="M384 32c26.5 0 48 21.5 48 48 0 6.3-1.3 12.2-3.4 17.7 20.4 5.5 35.4 24.1 35.4 46.3 0 9.1-2.6 17.6-7 24.9 22.2 4.2 39 23.7 39 47.1 0 19.7-11.9 36.6-28.9 44 17 7.4 28.9 24.3 28.9 44 0 26.5-21.5 48-48 48l-160 0 28.2 70.4c2.5 6.3 3.8 13.1 3.8 19.9l0 4.2c0 27.3-22.1 49.4-49.4 49.4-18.7 0-35.8-10.6-44.2-27.3L170.1 356.3c-6.7-13.3-10.1-28-10.1-42.9l0-186.6c0-19.4 8.9-37.8 24-50l12.2-9.7C224.6 44.4 259.8 32 296.1 32L384 32zM80 96c17.7 0 32 14.3 32 32l0 256c0 17.7-14.3 32-32 32l-48 0c-17.7 0-32-14.3-32-32L0 128c0-17.7 14.3-32 32-32l48 0z"></path>
                        </svg>
                    </button>
                </div>
            \` : '';

            messageDiv.innerHTML = \`
                <div class="message-header">
                    <span class="message-sender">\${message.role === 'user' ? 'You' : 'Iris'}</span>
                    <span class="message-time">\${time}</span>
                </div>
                <div class="message-content">\${formatMessageContent(message.content)}</div>
                \${feedbackButtons}
            \`;

            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;

            // Add event listeners for feedback buttons if this is an assistant message
            if (message.role === 'assistant') {
                const feedbackContainer = messageDiv.querySelector('.message-feedback');
                const feedbackButtons = messageDiv.querySelectorAll('.feedback-button');
                
                // Apply existing feedback state if present
                if (message.helpful === true) {
                    const thumbsUpBtn = messageDiv.querySelector('.thumbs-up');
                    if (thumbsUpBtn) {
                        thumbsUpBtn.classList.add('selected');
                        if (feedbackContainer) {
                            feedbackContainer.classList.add('has-feedback');
                        }
                    }
                } else if (message.helpful === false) {
                    const thumbsDownBtn = messageDiv.querySelector('.thumbs-down');
                    if (thumbsDownBtn) {
                        thumbsDownBtn.classList.add('selected');
                        if (feedbackContainer) {
                            feedbackContainer.classList.add('has-feedback');
                        }
                    }
                }
                
                feedbackButtons.forEach(button => {
                    button.addEventListener('click', function(event) {
                        event.stopPropagation();
                        handleFeedbackClick(this, message);
                    });
                });
            }

            // Show thinking indicator after user message, hide after assistant message
            if (message.role === 'user') {
                showThinkingIndicator();
            } else {
                hideThinkingIndicator();
            }

            // Update new session button state
            updateNewSessionButtonState();
        }

        function loadMessages(messages) {
            console.log('Loading messages:', messages);
            const chatMessages = document.getElementById('chatMessages');
            chatMessages.innerHTML = '';
            
            if (!messages || messages.length === 0) {
                console.log('No messages to load');
                updateNewSessionButtonState();
                return;
            }
            
            messages.forEach(msg => addMessageToChat(msg));
            console.log(\`Loaded \${messages.length} messages\`);
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function formatMessageContent(text) {
            // First, escape HTML to prevent XSS
            let formatted = escapeHtml(text);
            
            // Parse code blocks FIRST with placeholders to protect from line break conversion
            // Match and consume newlines around code blocks so they don't become <br> tags
            const codeBlockPlaceholders = [];
            formatted = formatted.replace(/(\\n\\n)?\\n*\`\`\`(\\w+)?\\n([\\s\\S]*?)\`\`\`\\n*(\\n\\n)?/g, (match, beforeNewlines, language, code, afterNewlines) => {
                const index = codeBlockPlaceholders.length;
                const classAttr = language ? ' class="language-' + escapeHtml(language) + '"' : '';
                const placeholder = '___CODEBLOCK_' + index + '___';
                codeBlockPlaceholders.push('<pre class="code-block"><code' + classAttr + '>' + code.trimEnd() + '</code></pre>');
                return placeholder;
            });
            
            // Parse inline code (single backticks)
            formatted = formatted.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
            
            // Parse bold: **text**
            formatted = formatted.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
            
            // Parse italic: *text* (but not if part of **)
            formatted = formatted.replace(/(?<!\\*)\\*(?!\\*)(.+?)(?<!\\*)\\*(?!\\*)/g, '<em>$1</em>');
            
            // Convert line breaks to <br> (code blocks are protected by placeholders)
            formatted = formatted.replace(/\\n/g, '<br>');
            
            // Restore code blocks from placeholders
            codeBlockPlaceholders.forEach((codeBlock, index) => {
                formatted = formatted.replace('___CODEBLOCK_' + index + '___', codeBlock);
            });
            
            return formatted;
        }

        function showThinkingIndicator() {
            const chatMessages = document.getElementById('chatMessages');

            // Remove any existing thinking indicator
            const existing = chatMessages.querySelector('.thinking-indicator');
            if (existing) {
                existing.remove();
            }

            // Create thinking indicator
            const thinkingDiv = document.createElement('div');
            thinkingDiv.className = 'message assistant-message thinking-indicator';
            thinkingDiv.innerHTML = \`
                <div class="thinking-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            \`;

            chatMessages.appendChild(thinkingDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        function hideThinkingIndicator() {
            const chatMessages = document.getElementById('chatMessages');
            const existing = chatMessages.querySelector('.thinking-indicator');
            if (existing) {
                existing.remove();
            }
        }

        function sendMessage() {
            const input = document.getElementById('chatInput');
            const text = input.value.trim();

            if (!text || !irisState.context) {
                return;
            }

            // Send to extension
            vscode.postMessage({
                command: 'sendMessage',
                text: text
            });

            // Clear input
            input.value = '';
            input.style.height = 'auto';
        }

        // Enable/disable chat input based on context
        function updateChatInputState() {
            const input = document.getElementById('chatInput');
            const button = document.getElementById('sendButton');
            
            if (irisState.context) {
                input.disabled = false;
                input.readOnly = false;
                input.placeholder = 'Ask Iris a question...';
                button.disabled = false;
            } else {
                input.disabled = true;
                input.readOnly = true;
                input.placeholder = 'Select a context to start chatting';
                button.disabled = true;
            }
        }

        // Enable/disable new session button based on message count
        function updateNewSessionButtonState() {
            const newSessionBtn = document.getElementById('newSessionBtn');
            if (!newSessionBtn) {
                return;
            }

            // Get current message count from the chat
            const chatMessages = document.getElementById('chatMessages');
            const messageElements = chatMessages.querySelectorAll('.chat-message');
            const hasMessages = messageElements.length > 0;

            newSessionBtn.disabled = !hasMessages;
            
            if (!hasMessages) {
                newSessionBtn.title = 'Send at least one message before creating a new conversation';
            } else {
                newSessionBtn.title = 'Create a new conversation';
            }
        }

        // Setup chat input handlers
        const chatInput = document.getElementById('chatInput');
        const sendButton = document.getElementById('sendButton');

        if (chatInput) {
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });

            chatInput.addEventListener('input', () => {
                chatInput.style.height = 'auto';
                chatInput.style.height = chatInput.scrollHeight + 'px';
            });
        }

        if (sendButton) {
            sendButton.addEventListener('click', sendMessage);
        }

        window.reconnectWebSocket = function() {
            vscode.postMessage({ command: 'reconnectWebSocket' });
        };

        function updateWebSocketStatus(isConnected) {
            const banner = document.getElementById('websocketStatusBanner');
            if (banner) {
                banner.style.display = isConnected ? 'none' : 'flex';
            }
        }

        window.addEventListener('message', event => {
            const message = event.data;
            console.log('Received message from extension:', message);

            switch (message.command) {
                case 'updateIrisState':
                    if (message.state) {
                        irisState = message.state;
                        updateContextBean();
                        updateDropdownContent();
                        updateChatInputState();
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
                        updateChatInputState();
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
                    updateNewSessionButtonState();
                    break;
                case 'addMessage':
                    if (message.message) {
                        addMessageToChat(message.message);
                    }
                    break;
                case 'loadMessages':
                    if (message.messages) {
                        loadMessages(message.messages);
                    }
                    break;
                case 'updateWebSocketStatus':
                    if (typeof message.isConnected === 'boolean') {
                        updateWebSocketStatus(message.isConnected);
                    }
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
        updateChatInputState();
    </script>
</body>
</html>`;
    }
}
