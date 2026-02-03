import * as vscode from "vscode";
import { IconDefinitions } from "../../utils/iconDefinitions";
import { readCssFiles, getMessageFormatterScript, getChatMessageRendererScript } from "../utils";
import { BurgerMenuButton, CollapseButton, CloseButton } from "../components/button/iconButtons";
import { ButtonComponent } from "../components/button/buttonComponent";
import { ListItemComponent } from "../components/listItem/listItemComponent";
import { HelpPopupComponent } from "../components/helpPopup";
import { SideMenuComponent, type SideMenuSection } from "../components/sideMenu";

export class IrisChatView {
    private _extensionContext: vscode.ExtensionContext;

    constructor(
        extensionContext: vscode.ExtensionContext
    ) {
        this._extensionContext = extensionContext;
    }

    public generateHtml(
        webview?: vscode.Webview,
        showDiagnostics: boolean = false
    ): string {
        const styles = readCssFiles("irisChat/iris-chat.css", "components/button/iconButtons/iconButtons.css", "components/button/button.css", "components/listItem/list-item.css");

        const trashIcon = IconDefinitions.getIcon("trash");
        const stethoscopeIcon = IconDefinitions.getIcon("stethoscope");
        const questionMarkIcon = IconDefinitions.getIcon("question-mark");
        const refreshIcon = IconDefinitions.getIcon("refresh");
        const courseIcon = IconDefinitions.getIcon("course");
        const exerciseIcon = IconDefinitions.getIcon("exercise");
        const lockIcon = IconDefinitions.getIcon("shield");
        const workspaceIcon = IconDefinitions.getIcon("workspace");
        const checkIcon = IconDefinitions.getIcon("check");
        const plusIcon = IconDefinitions.getIcon("plus");
        const switchIcon = IconDefinitions.getIcon("plus"); // Same as plus icon
        const fileIcon = IconDefinitions.getIcon("file");
        const closeIcon = IconDefinitions.getIcon("close");
        const chevronIcon = IconDefinitions.getIcon("chevron-down");

        // Get the path to the iris logo image
        let irisLogoSrc = "";
        if (webview) {
            const irisLogoUri = vscode.Uri.file(
                this._extensionContext.asAbsolutePath("media/iris-logo-big-left.png")
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
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            ${irisLogoSrc
                ? `<img src="${irisLogoSrc}" alt="Iris Logo" class="chat-header-logo" />`
                : ""
            }
            <h1 class="chat-title">Chat with Iris</h1>
            ${BurgerMenuButton.generate({
                id: 'burgerMenuBtn',
                command: 'toggleSideMenu()',
                title: 'Menu',
                className: 'chat-header-burger'
            })}
        </div>

        <div class="context-bean-container" id="contextBeanContainer">
            ${ListItemComponent.generate(
                {
                    id: 'contextBean',
                    className: 'context-bean',
                    clickable: true,
                    command: 'toggleContextDropdown()'
                },
                `<div class="context-bean-header">
                    <div class="context-info">
                        <span class="context-lock-icon" id="contextLockIcon" style="display: none;">${lockIcon}</span>
                        <span class="context-icon" id="contextIcon">${courseIcon}</span>
                        <div class="context-text-container">
                            <span class="context-text" id="contextText">No context selected</span>
                            <span class="context-subtext" id="contextSubtext" style="display: none;"></span>
                        </div>
                    </div>
                    ${CollapseButton.generate({
                    id: 'contextDropdownArrow',
                    collapsed: true,
                    direction: 'down',
                    targetId: 'contextDropdownMenu',
                    title: 'Toggle context menu',
                    className: 'context-collapse-btn'
                })}
                </div>`
            )}

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
                            ${ButtonComponent.generate({
                label: 'New Conversation',
                icon: plusIcon,
                variant: 'ghost',
                id: 'newSessionBtn',
                command: 'createNewSession()',
                disabled: true,
                fullWidth: true,
                className: 'dropdown-action-btn',
                height: '2rem'
            })}
                            ${ButtonComponent.generate({
                label: 'Switch to Workspace',
                icon: lockIcon,
                variant: 'ghost',
                id: 'workspaceContextBtn',
                command: 'switchToWorkspaceContext()',
                disabled: true,
                fullWidth: true,
                className: 'dropdown-action-btn',
                height: '2rem'
            })}
                            ${ButtonComponent.generate({
                label: 'Switch to Different Context',
                icon: switchIcon,
                variant: 'ghost',
                command: 'requestContextSwitch()',
                fullWidth: true,
                className: 'dropdown-action-btn',
                height: '2rem'
            })}
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

        <div class="chat-messages" id="chatMessages">
            <div class="welcome-message">
                <p class="welcome-text">
                    Welcome to Iris Chat!<br>
                    Select or search for a context to begin chatting with Iris.
                </p>
            </div>
        </div>

        <div class="chat-input-container">
            <div class="iris-disabled-banner" id="irisDisabledBanner" style="display: none;">
                <div class="iris-disabled-banner-content">
                    <span class="iris-disabled-banner-icon">
                        <svg viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8z"/>
                            <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
                        </svg>
                    </span>
                    <span class="iris-disabled-banner-text" id="irisDisabledMessage">Iris is not available for this context</span>
                </div>
            </div>
            <div class="websocket-status-banner" id="websocketStatusBanner" style="display: none;">
                <div class="websocket-status-content">
                    <span class="websocket-status-icon">⚠️</span>
                    <span class="websocket-status-text">WebSocket disconnected</span>
                </div>
                <button class="websocket-reconnect-btn" id="reconnectButton" onclick="reconnectWebSocket()">
                    Reconnect
                </button>
            </div>
            <div class="referenced-files-banner" id="referencedFilesBanner" style="display: none;">
                <div class="referenced-files-header" onclick="toggleReferencedFiles()">
                    <span class="referenced-files-icon">${fileIcon}</span>
                    <span class="referenced-files-text" id="referencedFilesText">0 files referenced</span>
                    <span class="referenced-files-arrow" id="referencedFilesArrow">${chevronIcon}</span>
                </div>
                <div class="referenced-files-list" id="referencedFilesList" style="display: none;">
                    <!-- File list will be populated dynamically -->
                </div>
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
                ${ButtonComponent.generate({
                label: 'Send',
                variant: 'primary',
                id: 'sendButton',
                disabled: true,
                command: 'sendMessage()',
                className: 'chat-send-button'
            })}
            </div>
            <div class="iris-disclaimer-banner">
                <span class="disclaimer-text">
                    Iris has access to your uncommitted changes (<a href="#" onclick="openUncommittedChangesSettings(); return false;" class="settings-link">configurable</a>).
                    Iris can make mistakes. Consider verifying important information. 
                </span>
            </div>
        </div>
    </div>

    ${HelpPopupComponent.generate()}

    ${(() => {
                const menuSections: SideMenuSection[] = [
                    {
                        title: 'Chat Options',
                        items: [
                            {
                                icon: 'refresh',
                                title: 'Reset & Sync Sessions',
                                description: 'Clear local data and reload from server',
                                command: 'resetChatSessions()'
                            }
                        ]
                    },
                    {
                        title: 'Help',
                        items: [
                            {
                                icon: 'question-mark',
                                title: 'Chat Context Guide',
                                description: 'Learn how contexts impact responses',
                                command: 'openHelpPopup()'
                            },
                            ...(showDiagnostics ? [
                                {
                                    icon: 'stethoscope',
                                    title: 'Diagnostics',
                                    description: 'View detailed context and session state',
                                    command: 'openDiagnostics()'
                                },
                                {
                                    icon: 'stethoscope',
                                    title: 'Debug Sessions (Raw)',
                                    description: 'View raw Artemis session data',
                                    command: 'debugSessions()'
                                }
                            ] : [])
                        ]
                    },
                    {
                        title: 'About',
                        customHtml: `<div class="menu-info">
                    <strong>Iris Chat</strong><br>
                    AI-powered guidance tailored to your Artemis coursework and exercises.
                </div>`
                    }
                ];
                return SideMenuComponent.generate({ sections: menuSections });
            })()}

    <script>
        const vscode = acquireVsCodeApi();
        vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🚀 Iris Chat webview script initializing...' });
        vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] ✅ VS Code API acquired' });

        window.openFile = function(filePath) {
            vscode.postMessage({ command: 'openFile', filePath });
        };

        ${SideMenuComponent.getScript()}

        ${HelpPopupComponent.getScript()}

        window.openUncommittedChangesSettings = function() {
            vscode.postMessage({
                command: 'openSettings',
                setting: 'artemis.iris.sendUncommittedChanges'
            });
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
            if (isOpen) {
                arrow.classList.add('is-collapsed');
                arrow.setAttribute('aria-expanded', 'false');
            } else {
                arrow.classList.remove('is-collapsed');
                arrow.setAttribute('aria-expanded', 'true');
            }

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
            arrow.classList.add('is-collapsed');
            arrow.setAttribute('aria-expanded', 'false');
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

        window.switchToWorkspaceContext = function() {
            vscode.postMessage({ command: 'switchToWorkspaceContext' });
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

            const courseIconSvg = \`${courseIcon}\`;
            const exerciseIconSvg = \`${exerciseIcon}\`;

            if (!irisState.context) {
                lockIcon.style.display = 'none';
                contextIcon.innerHTML = courseIconSvg;
                contextText.textContent = 'No context selected';
                contextSubtext.textContent = 'Click to choose or search';
                contextSubtext.style.display = 'block';
                return;
            }

            lockIcon.style.display = irisState.context.locked ? 'inline' : 'none';
            contextIcon.innerHTML = irisState.context.type === 'course' ? courseIconSvg : exerciseIconSvg;

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

            // Always hide the old search section - we integrate search into the recent lists now
            searchSection.style.display = 'none';

            if (searchQuery && searchQuery.length > 0) {
                // When searching, always show the context picker with filtered results
                sessionSection.style.display = 'none';
                contextPickerSection.style.display = 'block';
                renderRecentLists();
                return;
            }

            if (irisState.context && !forceContextPicker) {
                sessionSection.style.display = 'block';
                contextPickerSection.style.display = 'none';
                renderSessionList();
                updateWorkspaceButtonState();
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
                element.className = 'list-item list-item--clickable list-item--hover session-item' + (isActive ? ' list-item--selected' : '');
                element.setAttribute('role', 'button');
                element.setAttribute('tabindex', '0');
                element.onclick = () => window.selectSession(session.id);
                const checkIconSvg = \`${checkIcon}\`;
                element.innerHTML = \`
                    <div class="session-item-content">
                        <div class="session-item-header">
                            \${isActive ? '<span class="session-active-indicator">' + checkIconSvg + '</span>' : ''}
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
            const exercisesHeader = exercisesList.previousElementSibling;
            const coursesHeader = coursesList.previousElementSibling;

            exercisesList.innerHTML = '';
            coursesList.innerHTML = '';

            const query = searchQuery ? searchQuery.trim().toLowerCase() : '';
            const isSearching = query.length > 0;

            // When searching, filter from ALL exercises/courses, otherwise use recent lists
            // Limit to 3 items each for a compact view
            let exercises = isSearching 
                ? (irisState.allExercises || []).filter(item =>
                    item.title.toLowerCase().includes(query) ||
                    (item.shortName && item.shortName.toLowerCase().includes(query)) ||
                    (item.repositoryUri && item.repositoryUri.toLowerCase().includes(query))
                  ).slice(0, 3)
                : irisState.recentExercises.slice(0, 3);

            let courses = isSearching
                ? (irisState.allCourses || []).filter(item =>
                    item.title.toLowerCase().includes(query) ||
                    (item.shortName && item.shortName.toLowerCase().includes(query))
                  ).slice(0, 3)
                : irisState.recentCourses.slice(0, 3);

            // Update headers based on search state
            if (exercisesHeader) {
                exercisesHeader.textContent = isSearching ? 'Exercises' : 'Recent Exercises';
            }
            if (coursesHeader) {
                coursesHeader.textContent = isSearching ? 'Courses' : 'Recent Courses';
            }

            if (exercises.length === 0) {
                exercisesList.innerHTML = isSearching 
                    ? '<div class="context-empty">No matching exercises</div>'
                    : '<div class="context-empty">No exercises yet</div>';
            } else {
                const exerciseIconSvg = \`${exerciseIcon}\`;
                const lockIconSvg = \`${lockIcon}\`;
                exercises.forEach(exercise => {
                    const element = document.createElement('div');
                    const isWorkspace = exercise.isWorkspace || /\\(Workspace\\)/i.test(exercise.title);
                    element.className = 'list-item list-item--clickable list-item--hover context-item';
                    element.setAttribute('role', 'button');
                    element.setAttribute('tabindex', '0');
                    element.onclick = () => window.selectContext('exercise', exercise.id, exercise.title, exercise.shortName);
                    element.innerHTML = \`
                        <div class="context-item-icon">\${exerciseIconSvg}</div>
                        <div class="context-item-content">
                            <div class="context-item-title">\${isWorkspace ? '<span class="lock-indicator">' + lockIconSvg + '</span> ' : ''}\${exercise.title}</div>
                            \${exercise.shortName ? \`<div class="context-item-subtitle">\${exercise.shortName}</div>\` : ''}
                        </div>
                    \`;
                    exercisesList.appendChild(element);
                });
            }

            if (courses.length === 0) {
                coursesList.innerHTML = isSearching
                    ? '<div class="context-empty">No matching courses</div>'
                    : '<div class="context-empty">No courses yet</div>';
            } else {
                const courseIconSvg = \`${courseIcon}\`;
                courses.forEach(course => {
                    const element = document.createElement('div');
                    element.className = 'list-item list-item--clickable list-item--hover context-item';
                    element.setAttribute('role', 'button');
                    element.setAttribute('tabindex', '0');
                    element.onclick = () => window.selectContext('course', course.id, course.title, course.shortName);
                    element.innerHTML = \`
                        <div class="context-item-icon">\${courseIconSvg}</div>
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
                const exerciseIconSvg = \`${exerciseIcon}\`;
                const lockIconSvg = \`${lockIcon}\`;
                matchingExercises.forEach(item => {
                    const element = document.createElement('div');
                    element.className = 'search-result-item';
                    element.onclick = () => window.selectContext('exercise', item.id, item.title, item.shortName);
                    const isWorkspace = item.isWorkspace || /\\(Workspace\\)/i.test(item.title);
                    element.innerHTML = \`
                        <div class="search-result-icon">\${exerciseIconSvg}</div>
                        <div class="search-result-content">
                            <div class="search-result-title">\${isWorkspace ? '<span class="lock-indicator">' + lockIconSvg + '</span> ' : ''}\${item.title}</div>
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
                const courseIconSvg = \`${courseIcon}\`;
                matchingCourses.forEach(item => {
                    const element = document.createElement('div');
                    element.className = 'search-result-item';
                    element.onclick = () => window.selectContext('course', item.id, item.title, item.shortName);
                    element.innerHTML = \`
                        <div class="search-result-icon">\${courseIconSvg}</div>
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

        ${getChatMessageRendererScript()}

        ${getMessageFormatterScript()}

        function sendMessage() {
            vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 📤 sendMessage called' });
            const input = document.getElementById('chatInput');
            const text = input.value.trim();

            if (!text || !irisState.context) {
                vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] ⚠️ Cannot send: no text or no context, hasText: ' + !!text + ', hasContext: ' + !!irisState.context });
                return;
            }

            vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🚀 Posting sendMessage command to extension, textLength: ' + text.length });
            // Send to extension
            vscode.postMessage({
                command: 'sendMessage',
                text: text
            });
            vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] ✅ Message posted to extension' });

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
                button.classList.remove('btn-disabled');
                button.onclick = sendMessage;
            } else {
                input.disabled = true;
                input.readOnly = true;
                input.placeholder = 'Select a context to start chatting';
                button.disabled = true;
                button.classList.add('btn-disabled');
                button.onclick = null;
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
            if (hasMessages) {
                newSessionBtn.classList.remove('btn-disabled');
                newSessionBtn.title = 'Create a new conversation';
            } else {
                newSessionBtn.classList.add('btn-disabled');
                newSessionBtn.title = 'Send at least one message before creating a new conversation';
            }
        }

        // Enable/disable workspace context button based on availability
        function updateWorkspaceButtonState() {
            const workspaceBtn = document.getElementById('workspaceContextBtn');
            if (!workspaceBtn) {
                return;
            }

            // Check if there's a workspace exercise in recent exercises
            const hasWorkspaceExercise = irisState.recentExercises?.some(exercise => 
                exercise.isWorkspace || /\(Workspace\)/i.test(exercise.title)
            );

            workspaceBtn.disabled = !hasWorkspaceExercise;
            if (hasWorkspaceExercise) {
                workspaceBtn.classList.remove('btn-disabled');
                workspaceBtn.title = 'Switch to workspace exercise context';
            } else {
                workspaceBtn.classList.add('btn-disabled');
                workspaceBtn.title = 'No workspace exercise detected';
            }
        }

        // Setup chat input handlers
        vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🔧 Setting up chat input handlers...' });
        const chatInput = document.getElementById('chatInput');
        const sendButton = document.getElementById('sendButton');
        vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 📋 Elements found: chatInput=' + !!chatInput + ', sendButton=' + !!sendButton });

        if (chatInput) {
            vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] ⌨️ Setting up chat input event listeners' });
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] ⏎ Enter key pressed, sending message' });
                    sendMessage();
                }
            });

            chatInput.addEventListener('input', () => {
                chatInput.style.height = 'auto';
                chatInput.style.height = chatInput.scrollHeight + 'px';
            });
        }

        if (sendButton) {
            vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🎯 Setting up send button click handler' });
            sendButton.addEventListener('click', (event) => {
                vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🖱️ Send button clicked! disabled=' + sendButton.disabled + ', hasText=' + !!document.getElementById('chatInput')?.value + ', hasContext=' + !!irisState.context });
                sendMessage();
            });
        } else {
            vscode.postMessage({ command: 'webviewLog', level: 'warn', message: '[WebsocketLog] ⚠️ Send button not found in DOM!' });
        }

        window.reconnectWebSocket = function() {
            vscode.postMessage({ command: 'reconnectWebSocket' });
        };

        window.toggleReferencedFiles = function() {
            const list = document.getElementById('referencedFilesList');
            const arrow = document.getElementById('referencedFilesArrow');
            if (list && arrow) {
                const isExpanded = list.style.display !== 'none';
                list.style.display = isExpanded ? 'none' : 'block';
                // Rotate the chevron arrow
                arrow.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
            }
        };

        const fileIconSvg = \`${fileIcon}\`;
        const closeIconSvg = \`${closeIcon}\`;

        function updateReferencedFiles(data) {
            vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[Referenced Files] Update called with: ' + JSON.stringify(data) });
            const banner = document.getElementById('referencedFilesBanner');
            const text = document.getElementById('referencedFilesText');
            const list = document.getElementById('referencedFilesList');
            
            const includedFiles = data.includedFiles || [];
            const excludedFiles = data.excludedFiles || [];
            const totalCount = data.totalCount || (includedFiles.length + excludedFiles.length);

            vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[Referenced Files] Counts: includedFiles=' + includedFiles.length + ', excludedFiles=' + excludedFiles.length + ', totalCount=' + totalCount });

            if (totalCount === 0) {
                vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[Referenced Files] No files, hiding banner' });
                if (banner) banner.style.display = 'none';
                return;
            }

            // Show banner and update count with x/y format
            vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[Referenced Files] Showing banner' });
            if (banner) banner.style.display = 'flex';
            if (text) {
                text.textContent = \`\${includedFiles.length}/\${totalCount} file\${totalCount !== 1 ? 's' : ''} referenced\`;
            }

            // Populate file list with included files first, then excluded
            if (list) {
                let html = '';
                
                // Helper to get just the filename from a path
                const getFileName = (path) => path.split('/').pop() || path;
                
                // Add included files
                if (includedFiles.length > 0) {
                    html += includedFiles.map(file => {
                        const escapedFile = file.replace(/'/g, "\\\\'");
                        const fileName = getFileName(file);
                        return \`
                        <div class="list-item list-item--clickable list-item--hover referenced-file-item included" 
                             title="\${file}" 
                             role="button" 
                             tabindex="0"
                             onclick="openFile('\${escapedFile}')"
                             onkeydown="if(event.key==='Enter') openFile('\${escapedFile}')">
                            <span class="file-icon">\${fileIconSvg}</span>
                            <span class="file-name">\${fileName}</span>
                            <span class="file-status">Will be sent</span>
                        </div>
                    \`;
                    }).join('');
                }
                
                // Add excluded files
                if (excludedFiles.length > 0) {
                    if (includedFiles.length > 0) {
                        html += '<div class="file-list-divider">Excluded files</div>';
                    }
                    html += excludedFiles.map(file => {
                        const escapedPath = file.path.replace(/'/g, "\\\\'");
                        const fileName = getFileName(file.path);
                        // Show "File type ignored" for file type restrictions, otherwise show the reason
                        const statusText = file.reason?.includes('not allowed') ? 'File type ignored' : (file.reason || 'Excluded');
                        return \`
                        <div class="list-item list-item--clickable list-item--hover referenced-file-item excluded" 
                             title="\${file.path} - \${file.reason || 'Excluded'}"
                             role="button"
                             tabindex="0"
                             onclick="openFile('\${escapedPath}')"
                             onkeydown="if(event.key==='Enter') openFile('\${escapedPath}')">
                            <span class="file-icon">\${closeIconSvg}</span>
                            <span class="file-name">\${fileName}</span>
                            <span class="file-status">\${statusText}</span>
                        </div>
                    \`;
                    }).join('');
                }
                
                list.innerHTML = html;
            }
        }

        function updateWebSocketStatus(isConnected) {
            const banner = document.getElementById('websocketStatusBanner');
            if (banner) {
                banner.style.display = isConnected ? 'none' : 'flex';
            }
        }

        function showDisabledBanner(message) {
            const banner = document.getElementById('irisDisabledBanner');
            const messageEl = document.getElementById('irisDisabledMessage');
            const inputWrapper = document.querySelector('.chat-input-wrapper');
            
            if (banner) {
                banner.style.display = 'flex';
                if (messageEl && message) {
                    messageEl.textContent = message;
                }
            }
            
            // Hide the input wrapper when disabled
            if (inputWrapper) {
                inputWrapper.style.display = 'none';
            }
            
            // Also disable input as a safety measure
            const input = document.getElementById('chatInput');
            const button = document.getElementById('sendButton');
            if (input) {
                input.disabled = true;
                input.readOnly = true;
            }
            if (button) {
                button.disabled = true;
            }
        }

        function hideDisabledBanner() {
            const banner = document.getElementById('irisDisabledBanner');
            const inputWrapper = document.querySelector('.chat-input-wrapper');
            
            if (banner) {
                banner.style.display = 'none';
            }
            
            // Show the input wrapper again
            if (inputWrapper) {
                inputWrapper.style.display = 'flex';
            }
        }

        window.addEventListener('message', event => {
            const message = event.data;
            vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 📬 Received message from extension: ' + message.command });

            switch (message.command) {
                case 'showDisabledState':
                    vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🚫 Showing disabled state' });
                    showDisabledBanner(message.message);
                    break;
                case 'hideDisabledState':
                    vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] ✅ Hiding disabled state' });
                    hideDisabledBanner();
                    updateChatInputState();
                    break;
                case 'updateIrisState':
                    vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🔄 Updating Iris state' });
                    if (message.state) {
                        irisState = message.state;
                        updateContextBean();
                        updateDropdownContent();
                        updateChatInputState();
                        saveState();
                    }
                    break;
                case 'showContextPicker':
                    vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🔍 Showing context picker' });
                    if (message.state) {
                        irisState = message.state;
                        forceContextPicker = true;
                        searchQuery = '';
                        const dropdown = document.getElementById('contextDropdownMenu');
                        const arrow = document.getElementById('contextDropdownArrow');
                        dropdown.style.display = 'block';
                        arrow.classList.remove('is-collapsed');
                        arrow.setAttribute('aria-expanded', 'true');
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
                    vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🗑️ Clearing chat messages' });
                    const chatMessages = document.getElementById('chatMessages');
                    chatMessages.innerHTML = \`
                        <div class="welcome-message">
                            <p class="welcome-text">New conversation created! 🎉</p>
                        </div>
                    \`;
                    updateNewSessionButtonState();
                    break;
                case 'updateReferencedFiles':
                    vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 📁 Updating referenced files' });
                    if (message.includedFiles !== undefined) {
                        updateReferencedFiles({
                            includedFiles: message.includedFiles,
                            excludedFiles: message.excludedFiles || [],
                            totalCount: message.totalCount
                        });
                    }
                    break;
                case 'addMessage':
                    vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] ➕ Adding message to chat' });
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
                case 'updateNoAiStatus':
                    vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🚫 Updating .noai status: ' + message.isNoAiDetected });
                    if (message.isNoAiDetected) {
                        showDisabledBanner('🚫 AI assistance is disabled because a .noai file was detected in your workspace.');
                    } else {
                        hideDisabledBanner();
                        updateChatInputState();
                    }
                    break;
            }
        });

        document.addEventListener('click', event => {
            const bean = document.getElementById('contextBean');
            const dropdown = document.getElementById('contextDropdownMenu');
            // Close dropdown only if clicking outside both the bean and the dropdown menu
            if (dropdown.style.display === 'block' && 
                bean && !bean.contains(event.target) && 
                dropdown && !dropdown.contains(event.target)) {
                window.closeDropdown();
            }
        });

        updateContextBean();
        updateDropdownContent();
        updateChatInputState();

        // Notify extension that webview is ready and request initial state
        vscode.postMessage({ command: 'chatViewReady' });
    </script>
</body>
</html>`;
    }
}
