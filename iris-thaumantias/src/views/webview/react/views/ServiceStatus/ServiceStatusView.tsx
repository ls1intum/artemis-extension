import { useState, useEffect } from 'react';
import type {
    ServiceStatusViewProps,
    HealthCheckResult,
    ServiceStatusPersistedState,
} from './types';
import { ExtensionMsg, postCommand } from '../../../../../shared/messageContracts';
import { useExtensionMessage } from '../../hooks/useExtensionMessage';
import {
    BackLink,
    Container,
    PageHeader,
    TextInput,
    Button,
    ServiceHealth,
    SkeletonList,
} from '../../components';
import type { ServiceInfo } from '../../components/ServiceHealth/ServiceHealth';
import { formatServiceName } from '../../utils/formatServiceName';
import styles from './ServiceStatusView.module.css';

export function ServiceStatusView({ vscodeApi }: ServiceStatusViewProps) {
    // Restore persisted state (serverUrl only)
    const persistedState = vscodeApi.getState<ServiceStatusPersistedState>();
    const [serverUrl, setServerUrl] = useState<string>(persistedState?.serverUrl || '');
    const [healthResults, setHealthResults] = useState<Record<string, HealthCheckResult>>({});
    const [isLoaded, setIsLoaded] = useState(false);
    const [isChecking, setIsChecking] = useState<boolean>(false);
    const [lastCheckTime, setLastCheckTime] = useState<Date | undefined>(undefined);

    // Handle messages from extension
    useExtensionMessage((msg) => {
        switch (msg.type) {
            case ExtensionMsg.ServiceStatusInit: {
                const url = msg.serverUrl ?? '';
                setServerUrl(url);
                setIsLoaded(true);
                // Trigger health check if we have a server URL
                if (url) {
                    setIsChecking(true);
                    postCommand(vscodeApi, 'performHealthChecks', { serverUrl: url });
                }
                break;
            }
            case ExtensionMsg.HealthCheckResults: {
                setHealthResults(msg.results);
                setIsChecking(false);
                setLastCheckTime(new Date());
                break;
            }
        }
    }, [vscodeApi, setServerUrl, setIsLoaded, setIsChecking, setHealthResults, setLastCheckTime]);

    // Persist serverUrl when it changes
    useEffect(() => {
        if (serverUrl) {
            vscodeApi.setState<ServiceStatusPersistedState>({ serverUrl });
        }
    }, [serverUrl, vscodeApi]);

    // Handle back navigation
    const handleBack = () => {
        postCommand(vscodeApi, 'backToDashboard');
    };

    // Handle refresh
    const handleRefresh = () => {
        if (serverUrl) {
            setIsChecking(true);
            postCommand(vscodeApi, 'performHealthChecks', { serverUrl });
        }
    };

    if (!isLoaded) {
        return (
            <div className={styles.serviceStatusView}>
                <BackLink onClick={handleBack}>Back to Dashboard</BackLink>
                <SkeletonList count={5} />
            </div>
        );
    }

    // Map health results to ServiceHealth component format
    const services: ServiceInfo[] = Object.entries(healthResults).map(([name, result]) => ({
        name: formatServiceName(name),
        status: result.status,
        message: result.message,
        endpoint: result.endpoint,
        httpStatus: result.httpStatus !== null ? String(result.httpStatus) : undefined,
        response: result.response || undefined,
    }));

    return (
        <div className={styles.serviceStatusView}>
            <BackLink onClick={handleBack}>Back to Dashboard</BackLink>

            <PageHeader title="Service Status" subtitle="Real-time monitoring of Artemis services" />

            <Container
                header={<div className={styles.sectionTitle}>Connected Server</div>}
            >
                <TextInput
                    id="serverUrl"
                    label="Server URL"
                    type="text"
                    value={serverUrl}
                    onChange={() => {}} // No-op since it's disabled
                    disabled={true}
                    fullWidth={true}
                />
            </Container>

            <Container
                header={
                    <div>
                        <div className={styles.sectionTitle}>Health Checks</div>
                        <div style={{ fontSize: '12px', opacity: 0.8, marginTop: '4px' }}>
                            Click on each service to see detailed information
                        </div>
                    </div>
                }
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
    );
}