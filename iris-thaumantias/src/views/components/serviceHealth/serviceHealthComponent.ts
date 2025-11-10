import { IconDefinitions } from '../../../utils/iconDefinitions';
import { ButtonComponent } from '../button/buttonComponent';

/**
 * Reusable component for displaying service health status checks
 * Can be embedded in any view (login, service status, etc.)
 */
export class ServiceHealthComponent {
    /**
     * Generate the HTML for the service health component
     * @param options Configuration options for the component
     * @returns HTML string for the health check component
     */
    public static generateHtml(options: {
        showTitle?: boolean;
        compact?: boolean;
        autoCheck?: boolean;
    } = {}): string {
        const {
            showTitle = true,
            compact = false,
            autoCheck = false
        } = options;

        const refreshIcon = IconDefinitions.getIcon('refresh');
        const titleSection = showTitle ? `
            <h3 class="health-checks-title">
                🔍 Service Health Checks
            </h3>
        ` : '';

        const compactClass = compact ? 'health-compact' : '';

        return `
        <div class="service-health-component ${compactClass}" data-auto-check="${autoCheck}">
            ${titleSection}
            
            <div class="health-status-item" data-service="serverReachability">
                <div class="health-status-main">
                    <span class="health-label">Server Reachability</span>
                    <span class="health-value">
                        <span class="health-indicator unknown" id="health-serverReachability"></span>
                        <span id="health-serverReachabilityText">Not checked</span>
                    </span>
                </div>
                <div class="health-tooltip" id="tooltip-serverReachability">
                    <div class="tooltip-content">
                        <strong>Endpoint:</strong> <code id="endpoint-serverReachability">-</code><br>
                        <strong>HTTP Status:</strong> <span id="httpStatus-serverReachability">-</span><br>
                        <strong>Response:</strong> <span id="response-serverReachability">-</span>
                    </div>
                </div>
            </div>
            
            <div class="health-status-item" data-service="authService">
                <div class="health-status-main">
                    <span class="health-label">Authentication Service</span>
                    <span class="health-value">
                        <span class="health-indicator unknown" id="health-authService"></span>
                        <span id="health-authServiceText">Not checked</span>
                    </span>
                </div>
                <div class="health-tooltip" id="tooltip-authService">
                    <div class="tooltip-content">
                        <strong>Endpoint:</strong> <code id="endpoint-authService">-</code><br>
                        <strong>HTTP Status:</strong> <span id="httpStatus-authService">-</span><br>
                        <strong>Response:</strong> <span id="response-authService">-</span>
                    </div>
                </div>
            </div>
            
            <div class="health-status-item" data-service="apiAvailability">
                <div class="health-status-main">
                    <span class="health-label">API Availability</span>
                    <span class="health-value">
                        <span class="health-indicator unknown" id="health-apiAvailability"></span>
                        <span id="health-apiAvailabilityText">Not checked</span>
                    </span>
                </div>
                <div class="health-tooltip" id="tooltip-apiAvailability">
                    <div class="tooltip-content">
                        <strong>Endpoint:</strong> <code id="endpoint-apiAvailability">-</code><br>
                        <strong>HTTP Status:</strong> <span id="httpStatus-apiAvailability">-</span><br>
                        <strong>Response:</strong> <span id="response-apiAvailability">-</span>
                    </div>
                </div>
            </div>
            
            <div class="health-status-item" data-service="websocket">
                <div class="health-status-main">
                    <span class="health-label">WebSocket Connection</span>
                    <span class="health-value">
                        <span class="health-indicator unknown" id="health-websocket"></span>
                        <span id="health-websocketText">Not checked</span>
                    </span>
                </div>
                <div class="health-tooltip" id="tooltip-websocket">
                    <div class="tooltip-content">
                        <strong>Endpoint:</strong> <code id="endpoint-websocket">-</code><br>
                        <strong>HTTP Status:</strong> <span id="httpStatus-websocket">-</span><br>
                        <strong>Response:</strong> <span id="response-websocket">-</span>
                    </div>
                </div>
            </div>
            
            <div class="health-status-item" data-service="irisService">
                <div class="health-status-main">
                    <span class="health-label">Iris AI Service</span>
                    <span class="health-value">
                        <span class="health-indicator unknown" id="health-irisService"></span>
                        <span id="health-irisServiceText">Not checked</span>
                    </span>
                </div>
                <div class="health-tooltip" id="tooltip-irisService">
                    <div class="tooltip-content">
                        <strong>Endpoint:</strong> <code id="endpoint-irisService">-</code><br>
                        <strong>HTTP Status:</strong> <span id="httpStatus-irisService">-</span><br>
                        <strong>Response:</strong> <span id="response-irisService">-</span>
                    </div>
                </div>
            </div>
            
            <div class="health-last-check" id="health-lastCheckTime">Last checked: Never</div>
            
            ${ButtonComponent.generate({
                id: 'health-checkBtn',
                label: 'Check Status',
                icon: refreshIcon,
                variant: 'primary',
                fullWidth: true,
                height: '2.5rem'
            })}
        </div>`;
    }

    /**
     * Generate the JavaScript code for the service health component
     * This handles the health check logic and UI updates
     * @returns JavaScript code as a string
     */
    public static generateScript(): string {
        return `
        // Service Health Component Script
        (function() {
            const healthComponent = document.querySelector('.service-health-component');
            if (!healthComponent) return;
            
            const autoCheck = healthComponent.dataset.autoCheck === 'true';
            const checkBtn = document.getElementById('health-checkBtn');
            
            // DOM element references
            const elements = {
                serverReachability: {
                    indicator: document.getElementById('health-serverReachability'),
                    text: document.getElementById('health-serverReachabilityText')
                },
                authService: {
                    indicator: document.getElementById('health-authService'),
                    text: document.getElementById('health-authServiceText')
                },
                apiAvailability: {
                    indicator: document.getElementById('health-apiAvailability'),
                    text: document.getElementById('health-apiAvailabilityText')
                },
                websocket: {
                    indicator: document.getElementById('health-websocket'),
                    text: document.getElementById('health-websocketText')
                },
                irisService: {
                    indicator: document.getElementById('health-irisService'),
                    text: document.getElementById('health-irisServiceText')
                },
                lastCheckTime: document.getElementById('health-lastCheckTime')
            };
            
            // Helper function to update status indicators
            function updateStatusIndicator(key, status, message) {
                const element = elements[key];
                if (element && element.indicator) {
                    element.indicator.className = 'health-indicator ' + status;
                }
                if (element && element.text) {
                    element.text.textContent = message;
                }
            }
            
            // Helper function to update tooltip information
            function updateTooltip(key, endpoint, httpStatus, response) {
                const endpointEl = document.getElementById('endpoint-' + key);
                const httpStatusEl = document.getElementById('httpStatus-' + key);
                const responseEl = document.getElementById('response-' + key);
                
                if (endpointEl) {
                    endpointEl.textContent = endpoint || '-';
                }
                if (httpStatusEl) {
                    httpStatusEl.textContent = httpStatus || '-';
                    // Color code the HTTP status
                    if (httpStatus) {
                        const statusCode = parseInt(httpStatus);
                        if (statusCode >= 200 && statusCode < 300) {
                            httpStatusEl.style.color = 'var(--theme-success)';
                        } else if (statusCode >= 400 && statusCode < 500) {
                            httpStatusEl.style.color = 'var(--theme-warning, #f59e0b)';
                        } else if (statusCode >= 500) {
                            httpStatusEl.style.color = 'var(--theme-error)';
                        }
                    }
                }
                if (responseEl) {
                    responseEl.textContent = response || '-';
                }
            }
            
            // Perform health checks
            function performHealthChecks() {
                // Get server URL from vscode configuration
                const serverUrl = document.getElementById('serverUrl')?.value || 
                                 document.querySelector('.server-url')?.textContent || 
                                 'https://artemis.tum.de';
                
                if (!serverUrl) {
                    Object.keys(elements).forEach(key => {
                        if (key !== 'lastCheckTime') {
                            updateStatusIndicator(key, 'unknown', 'No server URL');
                        }
                    });
                    return;
                }
                
                // Disable button during check
                if (checkBtn) {
                    checkBtn.disabled = true;
                    const btnLabel = checkBtn.querySelector('.btn-label');
                    if (btnLabel) {
                        btnLabel.textContent = 'Checking...';
                    }
                }
                
                // Set all to checking state
                Object.keys(elements).forEach(key => {
                    if (key !== 'lastCheckTime') {
                        updateStatusIndicator(key, 'checking', 'Checking...');
                    }
                });
                
                // Request health checks from extension backend
                vscode.postMessage({ 
                    command: 'performHealthChecks',
                    serverUrl: serverUrl 
                });
            }
            
            // Handle health check results
            window.addEventListener('message', event => {
                const message = event.data;
                
                if (message.command === 'healthCheckResults') {
                    const results = message.results;
                    
                    // Update each indicator with results and tooltip data
                    if (results.serverReachability) {
                        updateStatusIndicator(
                            'serverReachability',
                            results.serverReachability.status,
                            results.serverReachability.message
                        );
                        updateTooltip(
                            'serverReachability',
                            results.serverReachability.endpoint || 'Server Root (HEAD)',
                            results.serverReachability.httpStatus,
                            results.serverReachability.response || results.serverReachability.message
                        );
                    }
                    
                    if (results.authService) {
                        updateStatusIndicator(
                            'authService',
                            results.authService.status,
                            results.authService.message
                        );
                        updateTooltip(
                            'authService',
                            results.authService.endpoint || '/api/core/public/authenticate',
                            results.authService.httpStatus,
                            results.authService.response || results.authService.message
                        );
                    }
                    
                    if (results.apiAvailability) {
                        updateStatusIndicator(
                            'apiAvailability',
                            results.apiAvailability.status,
                            results.apiAvailability.message
                        );
                        updateTooltip(
                            'apiAvailability',
                            results.apiAvailability.endpoint || '/management/health',
                            results.apiAvailability.httpStatus,
                            results.apiAvailability.response || results.apiAvailability.message
                        );
                    }
                    
                    if (results.websocket) {
                        updateStatusIndicator(
                            'websocket',
                            results.websocket.status,
                            results.websocket.message
                        );
                        updateTooltip(
                            'websocket',
                            results.websocket.endpoint || '/websocket/tracker',
                            results.websocket.httpStatus || 'N/A',
                            results.websocket.response || results.websocket.message
                        );
                    }
                    
                    if (results.irisService) {
                        updateStatusIndicator(
                            'irisService',
                            results.irisService.status,
                            results.irisService.message
                        );
                        updateTooltip(
                            'irisService',
                            results.irisService.endpoint || '/api/iris/status',
                            results.irisService.httpStatus,
                            results.irisService.response || results.irisService.message
                        );
                    }
                    
                    // Update last check time
                    const now = new Date();
                    if (elements.lastCheckTime) {
                        elements.lastCheckTime.textContent = 'Last checked: ' + now.toLocaleTimeString();
                    }
                    
                    // Re-enable button
                    if (checkBtn) {
                        checkBtn.disabled = false;
                        const btnLabel = checkBtn.querySelector('.btn-label');
                        if (btnLabel) {
                            btnLabel.textContent = 'Check Status';
                        }
                    }
                }
            });
            
            // Event listeners
            if (checkBtn) {
                checkBtn.addEventListener('click', performHealthChecks);
            }
            
            // Auto-check on load if enabled
            if (autoCheck) {
                setTimeout(performHealthChecks, 500);
            }
        })();`;
    }
}
