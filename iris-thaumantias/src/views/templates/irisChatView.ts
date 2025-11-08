import * as vscode from "vscode";
import { ThemeManager } from "../../theme";
import { IconDefinitions } from "../../utils/iconDefinitions";
import { StyleManager } from "../styles";
import { Button, Card, IconButton, SearchField, Toolbar } from "../../components";

export class IrisChatView {
  private _themeManager: ThemeManager;
  private _extensionContext: vscode.ExtensionContext;
  private _styleManager: StyleManager;

  constructor(
    extensionContext: vscode.ExtensionContext,
    styleManager: StyleManager
  ) {
    this._themeManager = new ThemeManager();
    this._extensionContext = extensionContext;
    this._styleManager = styleManager;
  }

  public generateHtml(
    webview?: vscode.Webview,
    showDiagnostics: boolean = false
  ): string {
    const themeCSS = this._themeManager.getThemeCSS();
    const currentTheme = this._themeManager.getCurrentTheme();
    const styles = this._styleManager.getStyles(currentTheme, [
      "views/iris-chat.css",
    ]);
    const themeScript = this._themeManager.getThemeScript(currentTheme);

    const trashIcon = IconDefinitions.getIcon("trash");
    const stethoscopeIcon = IconDefinitions.getIcon("stethoscope");
    const questionMarkIcon = IconDefinitions.getIcon("question-mark");
    const refreshIcon = IconDefinitions.getIcon("refresh");
    const courseIcon = IconDefinitions.getIcon("course");
    const exerciseIcon = IconDefinitions.getIcon("exercise");
    const lockIcon = IconDefinitions.getIcon("shield");
    const workspaceIcon = IconDefinitions.getIcon("workspace");
    const checkIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>`;
    const plusIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z"/></svg>`;
    const switchIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z"/></svg>`;
    const burgerIconMarkup = `<span class="iris-chat__menu-icon"><span></span><span></span><span></span></span>`;
    const menuButton = IconButton({
      id: "burgerMenu",
      icon: burgerIconMarkup,
      ariaLabel: "Toggle menu",
      onClick: "toggleSideMenu()",
      className: "iris-chat__menu-button burger-menu",
    });
    const newSessionButton = Button({
      id: "newSessionBtn",
      label: "New Conversation",
      leadingIcon: plusIcon,
      variant: "secondary",
      className: "iris-context-card__action dropdown-action-btn",
      onClick: "createNewSession()",
      disabled: true,
    });
    const workspaceButton = Button({
      id: "workspaceContextBtn",
      label: "Switch to Workspace",
      leadingIcon: lockIcon,
      variant: "secondary",
      className: "iris-context-card__action dropdown-action-btn",
      onClick: "switchToWorkspaceContext()",
      disabled: true,
    });
    const requestContextButton = Button({
      label: "Switch to Different Context",
      leadingIcon: switchIcon,
      variant: "ghost",
      className: "iris-context-card__action dropdown-action-btn",
      onClick: "requestContextSwitch()",
    });
    const reconnectButton = Button({
      id: "reconnectButton",
      label: "Reconnect",
      variant: "primary",
      className: "iris-chat__banner-action websocket-reconnect-btn",
      onClick: "reconnectWebSocket()",
    });
    const sendButton = Button({
      id: "sendButton",
      label: "Send",
      variant: "primary",
      className: "iris-chat__send-button send-button",
      disabled: true,
    });
    // VS Code icons for file status
    const fileIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.5 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5.5L9.5 1zM4 0a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V5.5L9.5 0H4z"/><path d="M9.5 1v4H13L9.5 1z"/></svg>`;
    const closeIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/></svg>`;
    const chevronIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"/></svg>`;

    // Get the path to the iris logo image
    let irisLogoSrc = "";
    if (webview) {
      const irisLogoUri = vscode.Uri.file(
        this._extensionContext.asAbsolutePath("media/iris-logo-big-left.png")
      );
      irisLogoSrc = webview.asWebviewUri(irisLogoUri).toString();
    }

    const header = Toolbar({
      className: "iris-chat__header chat-header",
      leading: irisLogoSrc
        ? `<img src="${irisLogoSrc}" alt="Iris Logo" class="iris-chat__logo chat-header-logo" />`
        : undefined,
      title: "Chat with Iris",
      titleClassName: "chat-title",
      actions: menuButton,
    });

    const contextSearchField = SearchField({
      id: "contextSearchInput",
      placeholder: "Search exercises or courses...",
      autoComplete: "off",
      className: "iris-context-card__search context-search-container",
      inputClassName: "context-search-input",
      attributes: { autocapitalize: "off" },
    });

    const contextCard = Card({
      id: "contextBean",
      className: "iris-context-card context-bean",
      children: `
        <button type="button" class="iris-context-card__toggle context-bean-header" onclick="toggleContextDropdown()">
          <div class="iris-context-card__info context-info">
            <span class="iris-context-card__lock context-lock-icon" id="contextLockIcon" style="display: none;">${lockIcon}</span>
            <span class="iris-context-card__icon context-icon" id="contextIcon">${courseIcon}</span>
            <div class="iris-context-card__text context-text-container">
              <span class="iris-context-card__title context-text" id="contextText">No context selected</span>
              <span class="iris-context-card__subtitle context-subtext" id="contextSubtext" style="display: none;"></span>
            </div>
          </div>
          <span class="iris-context-card__caret context-dropdown-arrow" id="contextDropdownArrow">▼</span>
        </button>
        <div class="iris-context-card__dropdown context-dropdown-menu" id="contextDropdownMenu" style="display: none;">
          ${contextSearchField}
          <div class="iris-context-card__search-results search-results-section" id="searchResultsSection" style="display: none;">
            <div class="iris-context-card__search-list search-results" id="searchResults"></div>
          </div>
          <div class="iris-context-card__section session-section" id="sessionSection" style="display: none;">
            <div class="iris-context-card__section-title dropdown-section-header">Sessions</div>
            <div class="iris-context-card__session-list session-list" id="sessionList"></div>
            <div class="iris-context-card__divider dropdown-divider"></div>
            <div class="iris-context-card__actions dropdown-section">
              ${newSessionButton}
              ${workspaceButton}
              ${requestContextButton}
            </div>
          </div>
          <div class="iris-context-card__section context-picker-section" id="contextPickerSection" style="display: none;">
            <div class="iris-context-card__group context-picker-group">
              <div class="iris-context-card__section-title dropdown-section-header">Recent Exercises</div>
              <div class="iris-context-card__list context-list" id="recentExercisesList"></div>
            </div>
            <div class="iris-context-card__group context-picker-group">
              <div class="iris-context-card__section-title dropdown-section-header">Recent Courses</div>
              <div class="iris-context-card__list context-list" id="recentCoursesList"></div>
            </div>
            <div class="iris-context-card__divider dropdown-divider"></div>
            <div class="iris-context-card__empty context-empty-info">
              Start typing to search all available exercises and courses.
            </div>
          </div>
        </div>
      `,
    });

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
<body class="iris-theme theme-${currentTheme}" data-iris-theme="${currentTheme}">
    <div class="iris-chat chat-container">
        ${header}
        <div class="iris-chat__context context-bean-container" id="contextBeanContainer">
            ${contextCard}
        </div>

        <div class="iris-chat__messages chat-messages" id="chatMessages">
            <div class="welcome-message">
                <p class="welcome-text">
                    Welcome to Iris Chat!<br>
                    Select or search for a context to begin chatting with Iris.
                </p>
            </div>
        </div>

        <div class="iris-chat__input chat-input-container">
            <div class="iris-chat__status-banner websocket-status-banner" id="websocketStatusBanner" style="display: none;">
                <div class="iris-chat__status-content websocket-status-content">
                    <span class="iris-chat__status-icon websocket-status-icon">⚠️</span>
                    <span class="iris-chat__status-text websocket-status-text">WebSocket disconnected</span>
                </div>
                ${reconnectButton}
            </div>
            <div class="iris-chat__files referenced-files-banner" id="referencedFilesBanner" style="display: none;">
                <div class="iris-chat__files-header referenced-files-header" onclick="toggleReferencedFiles()">
                    <span class="iris-chat__files-icon referenced-files-icon">${fileIcon}</span>
                    <span class="iris-chat__files-text referenced-files-text" id="referencedFilesText">0 files referenced</span>
                    <span class="iris-chat__files-caret referenced-files-arrow" id="referencedFilesArrow">${chevronIcon}</span>
                </div>
                <div class="iris-chat__files-list referenced-files-list" id="referencedFilesList" style="display: none;">
                    <!-- File list will be populated dynamically -->
                </div>
            </div>
            <div class="iris-chat__composer chat-input-wrapper">
                <textarea
                    class="iris-chat__textarea chat-input"
                    id="chatInput"
                    placeholder="Select a context to start chatting"
                    rows="1"
                    disabled
                    readonly
                ></textarea>
                ${sendButton}
            </div>
            <div class="iris-chat__disclaimer iris-disclaimer-banner">
                <span class="disclaimer-text">
                    Iris has access to your uncommitted changes (<a href="#" onclick="openUncommittedChangesSettings(); return false;" class="settings-link">configurable</a>).
                    Iris can make mistakes. Consider verifying important information.
                </span>
            </div>
        </div>
    </div>

    <div class="help-overlay iris-chat__overlay" id="helpOverlay" onclick="closeHelpPopup()"></div>
    <div class="help-popup iris-chat__help" id="helpPopup">
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
                        <span class="help-icon">${exerciseIcon}</span>
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
                        <span class="help-icon">${courseIcon}</span>
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

    <div class="menu-overlay iris-chat__overlay" id="menuOverlay" onclick="closeSideMenu()"></div>
    <div class="side-menu iris-chat__side-menu" id="sideMenu">
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
                ${
                  showDiagnostics
                    ? `
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
                `
                    : ""
                }
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
        ${themeScript}
    </script>
    <script>
        const vscode = acquireVsCodeApi();

        window.toggleSideMenu = function() {
            const sideMenu = document.getElementById('sideMenu');
            const menuOverlay = document.getElementById('menuOverlay');
            const burger = document.getElementById('burgerMenu');
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
            document.getElementById('burgerMenu')?.classList.remove('active');
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
            const isOpen = dropdown.style.display === 'flex';

            dropdown.style.display = isOpen ? 'none' : 'flex';
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

            if (searchQuery && searchQuery.length > 0) {
                sessionSection.style.display = 'none';
                contextPickerSection.style.display = 'none';
                searchSection.style.display = 'flex';
                renderSearchResults();
                return;
            }

            searchSection.style.display = 'none';

            if (irisState.context && !forceContextPicker) {
                sessionSection.style.display = 'flex';
                contextPickerSection.style.display = 'none';
                renderSessionList();
                updateWorkspaceButtonState();
            } else {
                sessionSection.style.display = 'none';
                contextPickerSection.style.display = 'flex';
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

            exercisesList.innerHTML = '';
            coursesList.innerHTML = '';

            if (irisState.recentExercises.length === 0) {
                exercisesList.innerHTML = '<div class="context-empty">No exercises yet</div>';
            } else {
                const exerciseIconSvg = \`${exerciseIcon}\`;
                const lockIconSvg = \`${lockIcon}\`;
                irisState.recentExercises.forEach(exercise => {
                    const element = document.createElement('div');
                    element.className = 'context-item';
                    element.onclick = () => window.selectContext('exercise', exercise.id, exercise.title, exercise.shortName);
                    const isWorkspace = exercise.isWorkspace || /\\(Workspace\\)/i.test(exercise.title);
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

            if (irisState.recentCourses.length === 0) {
                coursesList.innerHTML = '<div class="context-empty">No courses yet</div>';
            } else {
                const courseIconSvg = \`${courseIcon}\`;
                irisState.recentCourses.forEach(course => {
                    const element = document.createElement('div');
                    element.className = 'context-item';
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
            
            if (!hasWorkspaceExercise) {
                workspaceBtn.title = 'No workspace exercise detected';
            } else {
                workspaceBtn.title = 'Switch to workspace exercise context';
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
            console.log('[Referenced Files] Update called with:', data);
            const banner = document.getElementById('referencedFilesBanner');
            const text = document.getElementById('referencedFilesText');
            const list = document.getElementById('referencedFilesList');
            
            const includedFiles = data.includedFiles || [];
            const excludedFiles = data.excludedFiles || [];
            const totalCount = data.totalCount || (includedFiles.length + excludedFiles.length);

            console.log('[Referenced Files] Counts:', { includedFiles: includedFiles.length, excludedFiles: excludedFiles.length, totalCount });

            if (totalCount === 0) {
                console.log('[Referenced Files] No files, hiding banner');
                if (banner) banner.style.display = 'none';
                return;
            }

            // Show banner and update count with x/y format
            console.log('[Referenced Files] Showing banner');
            if (banner) banner.style.display = 'flex';
            if (text) {
                text.textContent = \`\${includedFiles.length}/\${totalCount} file\${totalCount !== 1 ? 's' : ''} referenced\`;
            }

            // Populate file list with included files first, then excluded
            if (list) {
                let html = '';
                
                // Add included files
                if (includedFiles.length > 0) {
                    html += includedFiles.map(file => \`
                        <div class="referenced-file-item included" title="\${file}">
                            <span class="file-icon">\${fileIconSvg}</span>
                            <span class="file-name">\${file}</span>
                            <span class="file-status">Will be sent</span>
                        </div>
                    \`).join('');
                }
                
                // Add excluded files
                if (excludedFiles.length > 0) {
                    if (includedFiles.length > 0) {
                        html += '<div class="file-list-divider">Excluded files</div>';
                    }
                    html += excludedFiles.map(file => \`
                        <div class="referenced-file-item excluded" title="\${file.path} - \${file.reason || 'Excluded'}">
                            <span class="file-icon">\${closeIconSvg}</span>
                            <span class="file-name">\${file.path}</span>
                            <span class="file-status">\${file.reason || 'Excluded'}</span>
                        </div>
                    \`).join('');
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
                        dropdown.style.display = 'flex';
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
                case 'updateReferencedFiles':
                    if (message.includedFiles !== undefined) {
                        updateReferencedFiles({
                            includedFiles: message.includedFiles,
                            excludedFiles: message.excludedFiles || [],
                            totalCount: message.totalCount
                        });
                    }
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
            if (dropdown.style.display === 'flex' && bean && !bean.contains(event.target)) {
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
