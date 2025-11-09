import { StyleManager } from '../styles';
import { ServiceHealthComponent } from '../components/serviceHealthComponent';

/**
 * Renders the login view for the Artemis webview.
 */
export class LoginView {
    private readonly _styleManager: StyleManager;

    constructor(styleManager: StyleManager) {
        this._styleManager = styleManager;
    }

    public generateHtml(): string {
        const styles = this._styleManager.getStyles([
            'views/login.css',
            'components/service-health.css',
        ]);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Artemis Login</title>
    <style>
        ${styles}
    </style>

</head>
<body>
    <div class="header">
        <div class="logo">
            <h1>Artemis Login</h1>
            <p>VS Code Extension for the Artemis Learning Platform</p>
        </div>
    </div>

    <div id="loadingIndicator" class="loading-indicator">
        <div class="loading-spinner"></div>
        <div class="loading-content">
            <div class="loading-text">Checking authentication<span class="loading-dots"></span></div>
            <div class="loading-subtext">Please wait while we verify your credentials</div>
        </div>
    </div>

    <div class="login-container" id="loginSection">
        <form id="loginForm">
            <div class="form-group">
                <label for="username">Username</label>
                <input type="text" id="username" name="username" placeholder="Enter your TUM username" required />
            </div>
            <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" placeholder="Enter your password" required />
            </div>
            <div class="checkbox-group">
                <input type="checkbox" id="rememberMe" name="rememberMe" checked />
                <label for="rememberMe">Remember me on this device</label>
            </div>
            <button type="submit" class="btn" id="loginButton">Login to Artemis</button>
            <div id="statusMessage" class="status"></div>
        </form>
        
        <!-- Server Health Status Component -->
        <div id="serverStatus" class="server-status">
            ${ServiceHealthComponent.generateHtml({ showTitle: true, compact: true, autoCheck: false })}
        </div>
        
        <div class="quick-links">
            <a class="quick-link" id="openWebsiteLink">Open Artemis in Browser →</a>
            <a class="quick-link" id="openSettingsLink">Open Artemis Settings →</a>
        </div>
    </div>

    <div class="login-container" id="loggedInSection" style="display: none;">
        <div class="logged-in">
            <h2>You're already logged in! ✅</h2>
            <div class="user-info">
                <div>
                    <div class="label">Username</div>
                    <div class="value" id="loggedInUsername">-</div>
                </div>
                <div>
                    <div class="label">Server URL</div>
                    <div class="value" id="loggedInServerUrl">-</div>
                </div>
            </div>
            <button class="btn" id="viewDashboardButton">Go to Dashboard</button>
            <button class="logout-btn" id="openLogoutButton">Logout from Artemis</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const loginForm = document.getElementById('loginForm');
        const statusMessage = document.getElementById('statusMessage');
        const loginButton = document.getElementById('loginButton');
        const loginSection = document.getElementById('loginSection');
        const loggedInSection = document.getElementById('loggedInSection');
        const loginInputs = loginForm.querySelectorAll('input');
        const openWebsiteLink = document.getElementById('openWebsiteLink');
        const openSettingsLink = document.getElementById('openSettingsLink');
        const openLogoutButton = document.getElementById('openLogoutButton');
        const viewDashboardButton = document.getElementById('viewDashboardButton');
        const loggedInUsername = document.getElementById('loggedInUsername');
        const loggedInServerUrl = document.getElementById('loggedInServerUrl');
        const loadingIndicator = document.getElementById('loadingIndicator');
        const loadingText = document.querySelector('.loading-text');
        const loadingSubtext = document.querySelector('.loading-subtext');
        
        // Server status elements
        const serverStatus = document.getElementById('serverStatus');
        const recheckServerBtn = document.getElementById('recheckServerBtn');
        const serverReachabilityIndicator = document.getElementById('serverReachabilityIndicator');
        const serverReachabilityText = document.getElementById('serverReachabilityText');
        const authServiceIndicator = document.getElementById('authServiceIndicator');
        const authServiceText = document.getElementById('authServiceText');
        const apiAvailabilityIndicator = document.getElementById('apiAvailabilityIndicator');
        const apiAvailabilityText = document.getElementById('apiAvailabilityText');

        const loadingMessages = {
            'Initializing...': 'Setting up your Artemis workspace',
            'Checking stored credentials...': 'Looking for saved authentication data',
            'Validating authentication...': 'Verifying your login credentials',
            'Loading user information...': 'Fetching your profile and preferences',
            'Connecting to Artemis...': 'Establishing secure connection'
        };

        function showLoadingIndicator(message = 'Checking authentication...') {
            if (loadingText) {
                loadingText.innerHTML = message.replace(/\.\.\.$/, '') + '<span class="loading-dots"></span>';
            }
            if (loadingSubtext) {
                loadingSubtext.textContent = loadingMessages[message] || 'Please wait while we process your request';
            }
            if (loadingIndicator) {
                loadingIndicator.classList.add('show');
            }
        }

        function hideLoadingIndicator() {
            if (loadingIndicator && loadingIndicator.classList.contains('show')) {
                loadingIndicator.classList.add('hide');
                setTimeout(() => {
                    loadingIndicator.classList.remove('show', 'hide');
                }, 300);
            }
        }

        function updateLoadingMessage(message) {
            if (loadingText) {
                loadingText.innerHTML = message.replace(/\.\.\.$/, '') + '<span class="loading-dots"></span>';
            }
            if (loadingSubtext) {
                loadingSubtext.textContent = loadingMessages[message] || 'Please wait while we process your request';
            }
        }

        // Server Status Checking Functions
        function getArtemisServerUrl() {
            // Try to get server URL from VS Code configuration
            // This will be set by the extension when the page loads
            return window.artemisServerUrl || 'https://artemis.tum.de';
        }

        function updateStatusIndicator(indicator, text, status, message) {
            if (indicator) {
                indicator.className = \`status-indicator \${status}\`;
            }
            if (text) {
                text.textContent = message;
            }
        }

        async function checkServerReachability(serverUrl) {
            try {
                updateStatusIndicator(serverReachabilityIndicator, serverReachabilityText, 'checking', 'Checking...');
                
                // First try a simple fetch to see if the server responds
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
                
                const response = await fetch(serverUrl, {
                    method: 'HEAD',
                    signal: controller.signal,
                    mode: 'no-cors' // This allows us to check reachability even with CORS issues
                });
                
                clearTimeout(timeoutId);
                updateStatusIndicator(serverReachabilityIndicator, serverReachabilityText, 'online', 'Reachable');
                return true;
            } catch (error) {
                if (error.name === 'AbortError') {
                    updateStatusIndicator(serverReachabilityIndicator, serverReachabilityText, 'offline', 'Timeout');
                } else {
                    updateStatusIndicator(serverReachabilityIndicator, serverReachabilityText, 'offline', 'Unreachable');
                }
                return false;
            }
        }

        async function checkAuthenticationService(serverUrl) {
            try {
                updateStatusIndicator(authServiceIndicator, authServiceText, 'checking', 'Checking...');
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
                
                // Try to access the authentication endpoint
                const response = await fetch(\`\${serverUrl}/api/core/public/authenticate\`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        username: '',
                        password: '',
                        rememberMe: false
                    }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                // Even if auth fails (400/401), if we get a response, the service is available
                if (response.status === 400 || response.status === 401) {
                    updateStatusIndicator(authServiceIndicator, authServiceText, 'online', 'Available');
                    return true;
                } else if (response.status === 200) {
                    updateStatusIndicator(authServiceIndicator, authServiceText, 'online', 'Available');
                    return true;
                } else {
                    updateStatusIndicator(authServiceIndicator, authServiceText, 'offline', \`Error \${response.status}\`);
                    return false;
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    updateStatusIndicator(authServiceIndicator, authServiceText, 'offline', 'Timeout');
                } else {
                    updateStatusIndicator(authServiceIndicator, authServiceText, 'offline', 'Unavailable');
                }
                return false;
            }
        }

        async function checkApiAvailability(serverUrl) {
            try {
                updateStatusIndicator(apiAvailabilityIndicator, apiAvailabilityText, 'checking', 'Checking...');
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
                
                // Try to access a public API endpoint
                const response = await fetch(\`\${serverUrl}/api/core/public/health\`, {
                    method: 'GET',
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (response.ok) {
                    updateStatusIndicator(apiAvailabilityIndicator, apiAvailabilityText, 'online', 'Available');
                    return true;
                } else {
                    updateStatusIndicator(apiAvailabilityIndicator, apiAvailabilityText, 'offline', \`Error \${response.status}\`);
                    return false;
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    updateStatusIndicator(apiAvailabilityIndicator, apiAvailabilityText, 'offline', 'Timeout');
                } else {
                    updateStatusIndicator(apiAvailabilityIndicator, apiAvailabilityText, 'offline', 'Unavailable');
                }
                return false;
            }
        }

        async function performServerStatusCheck() {
            const serverUrl = getArtemisServerUrl();
            
            if (!serverUrl) {
                updateStatusIndicator(serverReachabilityIndicator, serverReachabilityText, 'unknown', 'No server URL');
                updateStatusIndicator(authServiceIndicator, authServiceText, 'unknown', 'No server URL');
                updateStatusIndicator(apiAvailabilityIndicator, apiAvailabilityText, 'unknown', 'No server URL');
                return;
            }

            // Show the server status section
            if (serverStatus) {
                serverStatus.classList.add('show');
            }

            // Disable recheck button during check
            if (recheckServerBtn) {
                recheckServerBtn.disabled = true;
                recheckServerBtn.textContent = 'Checking...';
            }

            // Run all checks in parallel
            await Promise.all([
                checkServerReachability(serverUrl),
                checkAuthenticationService(serverUrl),
                checkApiAvailability(serverUrl)
            ]);

            // Re-enable recheck button
            if (recheckServerBtn) {
                recheckServerBtn.disabled = false;
                recheckServerBtn.textContent = 'Recheck Server Status';
            }
        }

        function showServerStatus() {
            performServerStatusCheck();
        }

        function hideServerStatus() {
            if (serverStatus) {
                serverStatus.classList.remove('show');
            }
        }

        // Event listener for recheck button
        if (recheckServerBtn) {
            recheckServerBtn.addEventListener('click', () => {
                performServerStatusCheck();
            });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'showLoading':
                    showLoadingIndicator(message.message || 'Checking authentication...');
                    break;
                case 'hideLoading':
                    hideLoadingIndicator();
                    break;
                case 'updateLoading':
                    updateLoadingMessage(message.message || 'Processing...');
                    break;
                case 'loginSuccess':
                    hideLoadingIndicator();
                    setStatus('success', \`Successfully logged in as \${message.username}\`);
                    hideServerStatus();
                    break;
                case 'loginError':
                    hideLoadingIndicator();
                    setStatus('error', message.error || 'Login failed. Please try again.');
                    enableInputs();
                    // Show server status check after login error
                    showServerStatus();
                    break;
                case 'logoutSuccess':
                    hideLoadingIndicator();
                    showLoginForm();
                    setStatus('info', 'You have been logged out.');
                    enableInputs();
                    break;
                case 'showLoggedIn':
                    hideLoadingIndicator();
                    showLoggedInState(message.userInfo);
                    hideServerStatus();
                    break;
                case 'setServerUrl':
                    // Store the server URL for status checking
                    window.artemisServerUrl = message.serverUrl;
                    break;
            }
        });

        loginForm.addEventListener('submit', event => {
            event.preventDefault();
            const username = loginForm.username.value.trim();
            const password = loginForm.password.value;
            const rememberMe = loginForm.rememberMe.checked;

            if (!username || !password) {
                setStatus('error', 'Please enter both username and password.');
                return;
            }

            setStatus('info', 'Logging in to Artemis...');
            disableInputs();

            vscode.postMessage({
                command: 'login',
                username,
                password,
                rememberMe
            });
        });

        if (openWebsiteLink) {
            openWebsiteLink.addEventListener('click', () => {
                vscode.postMessage({ command: 'openWebsite' });
            });
        }

        if (openSettingsLink) {
            openSettingsLink.addEventListener('click', () => {
                vscode.postMessage({ command: 'openSettings' });
            });
        }

        if (openLogoutButton) {
            openLogoutButton.addEventListener('click', () => {
                vscode.postMessage({ command: 'logout' });
            });
        }

        if (viewDashboardButton) {
            viewDashboardButton.addEventListener('click', () => {
                vscode.postMessage({ command: 'browseCourses' });
            });
        }

        function disableInputs() {
            loginInputs.forEach(input => input.disabled = true);
            loginButton.disabled = true;
        }

        function enableInputs() {
            loginInputs.forEach(input => input.disabled = false);
            loginButton.disabled = false;
        }

        function setStatus(type, message) {
            statusMessage.className = \`status \${type}\`;
            statusMessage.textContent = message;
            statusMessage.style.display = 'block';
        }

        function showLoggedInState(userInfo) {
            loginSection.style.display = 'none';
            loggedInSection.style.display = 'block';
            loggedInUsername.textContent = userInfo?.username || 'Unknown';
            loggedInServerUrl.textContent = userInfo?.serverUrl || 'Unknown';
        }

        function showLoginForm() {
            loginSection.style.display = 'block';
            loggedInSection.style.display = 'none';
            hideServerStatus();
        }

        // No need to show loading indicator by default - it will be shown only during auto-login
        
        // Initialize Service Health Component
        ${ServiceHealthComponent.generateScript()}
    </script>
</body>
</html>`;
    }
}
