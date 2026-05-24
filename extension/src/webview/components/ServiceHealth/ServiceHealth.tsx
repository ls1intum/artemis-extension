import clsx from 'clsx';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import { useState } from 'react';

import styles from './ServiceHealth.module.css';

export type ServiceStatus = 'online' | 'offline' | 'checking' | 'unknown';

export interface ServiceInfo {
  name: string;
  status: ServiceStatus;
  message: string;
  endpoint?: string;
  httpStatus?: string;
  response?: string;
}

interface ServiceHealthProps {
  services: ServiceInfo[];
  onRefresh?: () => void;
  isRefreshing?: boolean;
  lastCheckTime?: Date;
  compact?: boolean;
  showTitle?: boolean;
  className?: string;
}

interface ServiceItemProps {
  service: ServiceInfo;
  isExpanded: boolean;
  onToggle: () => void;
}

function ServiceItem({ service, isExpanded, onToggle }: ServiceItemProps) {
  return (
    <div
      className={clsx(styles.healthStatusItem, isExpanded && styles.expanded)}
      onClick={onToggle}
    >
      <div className={styles.healthStatusMain}>
        <span className={styles.healthLabel}>{service.name}</span>
        <span className={styles.healthValue}>
          <span className={clsx(styles.healthIndicator, styles[service.status])} />
          <span>{service.message}</span>
          <ChevronRight
            className={clsx(styles.healthChevron, isExpanded && styles.expanded)}
            size={12}
          />
        </span>
      </div>

      {isExpanded && (
        <div className={clsx(styles.healthDetails, isExpanded && styles.expanded)}>
          <div className={styles.detailsContent}>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Endpoint:</span>
              <code className={styles.detailValue}>{service.endpoint || '-'}</code>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>HTTP Status:</span>
              <span
                className={clsx(
                  styles.detailValue,
                  service.httpStatus && getHttpStatusClass(service.httpStatus)
                )}
              >
                {service.httpStatus || '-'}
              </span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Response:</span>
              <span className={styles.detailValue}>{service.response || '-'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getHttpStatusClass(httpStatus: string): string {
  const statusCode = parseInt(httpStatus);
  if (statusCode >= 200 && statusCode < 300) {
    return styles.statusSuccess;
  } else if (statusCode >= 400 && statusCode < 500) {
    return styles.statusWarning;
  } else if (statusCode >= 500) {
    return styles.statusError;
  }
  return '';
}

export function ServiceHealth({
  services,
  onRefresh,
  isRefreshing = false,
  lastCheckTime,
  compact = false,
  showTitle = true,
  className,
}: ServiceHealthProps) {
  const [expandedServices, setExpandedServices] = useState<Set<string>>(new Set());

  const toggleService = (serviceName: string) => {
    setExpandedServices((prev) => {
      const next = new Set(prev);
      if (next.has(serviceName)) {
        next.delete(serviceName);
      } else {
        next.add(serviceName);
      }
      return next;
    });
  };

  const formatLastCheckTime = () => {
    if (!lastCheckTime) {return 'Never';}
    return lastCheckTime.toLocaleTimeString();
  };

  return (
    <div className={clsx(styles.serviceHealthComponent, compact && styles.healthCompact, className)}>
      {showTitle && (
        <h3 className={styles.healthChecksTitle}>
          🔍 Service Health Checks
        </h3>
      )}

      {services.map((service) => (
        <ServiceItem
          key={service.name}
          service={service}
          isExpanded={expandedServices.has(service.name)}
          onToggle={() => toggleService(service.name)}
        />
      ))}

      <div className={styles.healthLastCheck}>
        Last checked: {formatLastCheckTime()}
      </div>

      {onRefresh && (
        <button
          type="button"
          className={clsx(styles.refreshBtn, isRefreshing && styles.refreshing)}
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={styles.refreshIcon} />
          <span>{isRefreshing ? 'Checking...' : 'Check Status'}</span>
        </button>
      )}
    </div>
  );
}
