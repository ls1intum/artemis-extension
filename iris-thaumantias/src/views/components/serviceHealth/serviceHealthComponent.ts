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
        const chevronIcon = IconDefinitions.getIcon('chevron-right');
        const titleSection = showTitle ? `
            <h3 class="health-checks-title">
                🔍 Service Health Checks
            </h3>
        ` : '';

        const compactClass = compact ? 'health-compact' : '';

        const generateHealthItem = (serviceId: string, label: string): string => `
            <div class="health-status-item" data-service="${serviceId}">
                <div class="health-status-main">
                    <span class="health-label">${label}</span>
                    <span class="health-value">
                        <span class="health-indicator unknown" id="health-${serviceId}"></span>
                        <span id="health-${serviceId}Text">Not checked</span>
                        <span class="health-chevron" id="chevron-${serviceId}">${chevronIcon}</span>
                    </span>
                </div>
                <div class="health-details" id="details-${serviceId}">
                    <div class="details-content">
                        <div class="detail-row">
                            <span class="detail-label">Endpoint:</span>
                            <code class="detail-value" id="endpoint-${serviceId}">-</code>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">HTTP Status:</span>
                            <span class="detail-value" id="httpStatus-${serviceId}">-</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Response:</span>
                            <span class="detail-value" id="response-${serviceId}">-</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        return `
        <div class="service-health-component ${compactClass}" data-auto-check="${autoCheck}">
            ${titleSection}
            
            ${generateHealthItem('serverReachability', 'Server Reachability')}
            ${generateHealthItem('apiAvailability', 'API Availability')}
            ${generateHealthItem('irisService', 'Iris AI Service')}
            
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
            
            // Track expanded state for each service (only 3 checks now)
            const expandedStates = {
                serverReachability: false,
                apiAvailability: false,
                irisService: false
            };
            
            // DOM element references (only 3 checks now)
            const elements = {
                serverReachability: {
                    indicator: document.getElementById('health-serverReachability'),
                    text: document.getElementById('health-serverReachabilityText'),
                    details: document.getElementById('details-serverReachability'),
                    chevron: document.getElementById('chevron-serverReachability'),
                    item: document.querySelector('[data-service="serverReachability"]')
                },
                apiAvailability: {
                    indicator: document.getElementById('health-apiAvailability'),
                    text: document.getElementById('health-apiAvailabilityText'),
                    details: document.getElementById('details-apiAvailability'),
                    chevron: document.getElementById('chevron-apiAvailability'),
                    item: document.querySelector('[data-service="apiAvailability"]')
                },
                irisService: {
                    indicator: document.getElementById('health-irisService'),
                    text: document.getElementById('health-irisServiceText'),
                    details: document.getElementById('details-irisService'),
                    chevron: document.getElementById('chevron-irisService'),
                    item: document.querySelector('[data-service="irisService"]')
                },
                lastCheckTime: document.getElementById('health-lastCheckTime')
            };
            
            // Toggle details visibility on click
            function toggleDetails(key) {
                const element = elements[key];
                if (!element || !element.details || !element.chevron || !element.item) return;
                
                expandedStates[key] = !expandedStates[key];
                
                if (expandedStates[key]) {
                    element.details.classList.add('expanded');
                    element.chevron.classList.add('expanded');
                    element.item.classList.add('expanded');
                } else {
                    element.details.classList.remove('expanded');
                    element.chevron.classList.remove('expanded');
                    element.item.classList.remove('expanded');
                }
            }
            
            // Add click handlers to all health items
            Object.keys(elements).forEach(key => {
                if (key === 'lastCheckTime') return;
                const element = elements[key];
                if (element && element.item) {
                    element.item.addEventListener('click', (e) => {
                        // Don't toggle if clicking on link or button inside
                        if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;
                        toggleDetails(key);
                    });
                }
            });
            
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
            
            // Helper function to update details information
            function updateDetails(key, endpoint, httpStatus, response) {
                const endpointEl = document.getElementById('endpoint-' + key);
                const httpStatusEl = document.getElementById('httpStatus-' + key);
                const responseEl = document.getElementById('response-' + key);
                
                if (endpointEl) {
                    endpointEl.textContent = endpoint || '-';
                }
                if (httpStatusEl) {
                    httpStatusEl.textContent = httpStatus || '-';
                    // Color code the HTTP status
                    httpStatusEl.className = 'detail-value';
                    if (httpStatus) {
                        const statusCode = parseInt(httpStatus);
                        if (statusCode >= 200 && statusCode < 300) {
                            httpStatusEl.classList.add('status-success');
                        } else if (statusCode >= 400 && statusCode < 500) {
                            httpStatusEl.classList.add('status-warning');
                        } else if (statusCode >= 500) {
                            httpStatusEl.classList.add('status-error');
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
                
                // Request health checks from extension server
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
                    
                    // Update each indicator with results and details data
                    if (results.serverReachability) {
                        updateStatusIndicator(
                            'serverReachability',
                            results.serverReachability.status,
                            results.serverReachability.message
                        );
                        updateDetails(
                            'serverReachability',
                            results.serverReachability.endpoint || 'Server Root (HEAD)',
                            results.serverReachability.httpStatus,
                            results.serverReachability.response || results.serverReachability.message
                        );
                    }
                    
                    if (results.apiAvailability) {
                        updateStatusIndicator(
                            'apiAvailability',
                            results.apiAvailability.status,
                            results.apiAvailability.message
                        );
                        updateDetails(
                            'apiAvailability',
                            results.apiAvailability.endpoint || '/management/health',
                            results.apiAvailability.httpStatus,
                            results.apiAvailability.response || results.apiAvailability.message
                        );
                    }
                    
                    if (results.irisService) {
                        updateStatusIndicator(
                            'irisService',
                            results.irisService.status,
                            results.irisService.message
                        );
                        updateDetails(
                            'irisService',
                            results.irisService.endpoint || '/management/info',
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
