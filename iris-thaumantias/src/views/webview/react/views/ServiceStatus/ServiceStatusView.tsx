import { useState, useEffect } from 'react';
import type {
    ServiceStatusViewProps,
    HealthCheckResult,
    ServiceStatusPersistedState,
} from './types';
import type {
    ExtensionToWebviewMessage,
    ServiceStatusInitMessage,
    HealthCheckResultsMessage,
} from '../../../../../shared/messageContracts';
import {
    BackLink,
    Container,
    TextInput,
    Button,
    ServiceHealth,
} from '../../components';
import type { ServiceInfo } from '../../components/ServiceHealth/ServiceHealth';

export function ServiceStatusView({ vscodeApi }: ServiceStatusViewProps) {
    // Restore persisted state (serverUrl only)
    const persistedState = vscodeApi.getState<ServiceStatusPersistedState>();
    const [serverUrl, setServerUrl] = useState<string>(persistedState?.serverUrl || '');
    const [healthResults, setHealthResults] = useState<Record<string, HealthCheckResult>>({});
    const [isChecking, setIsChecking] = useState<boolean>(false);
    const [lastCheckTime, setLastCheckTime] = useState<Date | undefined>(undefined);

    // Handle messages from extension
    useEffect(() => {
        const messageHandler = (event: MessageEvent<unknown>) => {
            const message = event.data;

            if (typeof message !== 'object' || message === null || !('type' in message)) {
                return;
            }

            const typedMessage = message as ExtensionToWebviewMessage;

            switch (typedMessage.type) {
                case 'serviceStatusInit': {
                    const initMsg = typedMessage as ServiceStatusInitMessage;
                    const url = initMsg.payload.serverUrl ?? '';
                    setServerUrl(url);
                    // Trigger health check if we have a server URL
                    if (url) {
                        setIsChecking(true);
                        vscodeApi.postMessage({
                            type: 'command',
                            command: 'performHealthChecks',
                            payload: { serverUrl: url },
                        });
                    }
                    break;
                }
                case 'healthCheckResults': {
                    const resultsMsg = typedMessage as HealthCheckResultsMessage;
                    setHealthResults(resultsMsg.payload.results as Record<string, HealthCheckResult>);
                    setIsChecking(false);
                    setLastCheckTime(new Date());
                    break;
                }
            }
        };

        window.addEventListener('message', messageHandler);
        return () => window.removeEventListener('message', messageHandler);
    }, [vscodeApi]);

    // Persist serverUrl when it changes
    useEffect(() => {
        if (serverUrl) {
            vscodeApi.setState<ServiceStatusPersistedState>({ serverUrl });
        }
    }, [serverUrl, vscodeApi]);

    // Handle back navigation
    const handleBack = () => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'backToDashboard',
        });
    };

    // Handle refresh
    const handleRefresh = () => {
        if (serverUrl) {
            setIsChecking(true);
            vscodeApi.postMessage({
                type: 'command',
                command: 'performHealthChecks',
                payload: { serverUrl },
            });
        }
    };

    // Map health results to ServiceHealth component format
    const services: ServiceInfo[] = Object.entries(healthResults).map(([name, result]) => ({
        name: formatServiceName(name),
        status: result.status as 'online' | 'offline' | 'checking' | 'unknown',
        message: result.message,
        endpoint: result.endpoint,
        httpStatus: result.httpStatus !== null ? String(result.httpStatus) : undefined,
        response: result.response || undefined,
    }));

    return (
        <>
            <BackLink onClick={handleBack}>Back to Dashboard</BackLink>

            <div style={{ padding: '20px 20px 0 20px' }}>
                {/* Header Card */}
                <Container
                    header={
                        <div>
                            <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>
                                Service Status
                            </div>
                            <div style={{ fontSize: '13px', opacity: 0.8 }}>
                                Real-time monitoring of Artemis services
                            </div>
                        </div>
                    }
                    variant="default"
                    padding="default"
                >
                    <div />
                </Container>

                {/* Server Info Card */}
                <div style={{ marginTop: '16px' }}>
                    <Container
                        header={
                            <div style={{ fontSize: '15px', fontWeight: 600 }}>
                                Connected Server
                            </div>
                        }
                        variant="default"
                        padding="default"
                    >
                        <TextInput
                            id="serverUrl"
                            type="text"
                            value={serverUrl}
                            onChange={() => {}} // No-op since it's disabled
                            disabled={true}
                            fullWidth={true}
                        />
                    </Container>
                </div>

                {/* Health Checks Card */}
                <div style={{ marginTop: '16px', marginBottom: '20px' }}>
                    <Container
                        header={
                            <div>
                                <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>
                                    Health Checks
                                </div>
                                <div style={{ fontSize: '12px', opacity: 0.8 }}>
                                    Click on each service to see detailed information
                                </div>
                            </div>
                        }
                        variant="default"
                        padding="default"
                    >
                        {services.length > 0 ? (
                            <ServiceHealth
                                services={services}
                                onRefresh={handleRefresh}
                                isRefreshing={isChecking}
                                lastCheckTime={lastCheckTime}
                                showTitle={false}
                                compact={false}
                            />
                        ) : (
                            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--vscode-descriptionForeground)' }}>
                                {isChecking ? 'Performing health checks...' : 'No health check results available'}
                            </div>
                        )}
                    </Container>
                </div>
            </div>
        </>
    );
}

/**
 * Format service name from camelCase to Title Case.
 */
function formatServiceName(name: string): string {
    // Convert camelCase to spaces: "serverReachability" -> "Server Reachability"
    return name
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (str) => str.toUpperCase())
        .trim();
}
