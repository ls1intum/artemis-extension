import { useEffect, useState } from 'react';

import { ExtensionMsg, postCommand } from '@shared/messageContracts';

import { BackLink, Container, PageHeader, ServiceHealth, SkeletonList, TextInput } from '@webview/components';
import type { ServiceInfo } from '@webview/components/ServiceHealth/ServiceHealth';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';
import { formatServiceName } from '@webview/utils/formatServiceName';

import styles from './ServiceStatusView.module.css';
import type { HealthCheckResult, ServiceStatusPersistedState, ServiceStatusViewProps } from './types';

export function ServiceStatusView({ vscodeApi }: ServiceStatusViewProps) {
    const persistedState = vscodeApi.getState<ServiceStatusPersistedState>();
    const [serverUrl, setServerUrl] = useState<string>(persistedState?.serverUrl || '');
    const [healthResults, setHealthResults] = useState<Record<string, HealthCheckResult>>({});
    const [isLoaded, setIsLoaded] = useState(false);
    const [isChecking, setIsChecking] = useState<boolean>(false);
    const [lastCheckTime, setLastCheckTime] = useState<Date | undefined>(undefined);

    useExtensionMessage((msg) => {
        switch (msg.type) {
            case ExtensionMsg.ServiceStatusInit: {
                const url = msg.serverUrl ?? '';
                setServerUrl(url);
                setIsLoaded(true);
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

    useEffect(() => {
        if (serverUrl) {
            vscodeApi.setState<ServiceStatusPersistedState>({ serverUrl });
        }
    }, [serverUrl, vscodeApi]);

    const handleBack = () => {
        postCommand(vscodeApi, 'backToDashboard');
    };

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