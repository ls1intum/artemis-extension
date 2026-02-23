import { useState } from 'react';
import clsx from 'clsx';
import { Badge } from '../Badge';
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

export interface ServiceHealthProps {
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
  const statusVariantMap: Record<ServiceStatus, 'success' | 'error' | 'warning' | 'muted'> = {
    online: 'success',
    offline: 'error',
    checking: 'warning',
    unknown: 'muted',
  };

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
          <svg
            className={clsx(styles.healthChevron, isExpanded && styles.expanded)}
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
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
    if (!lastCheckTime) return 'Never';
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
          <svg
            className={styles.refreshIcon}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M21 12C21 16.9706 16.9706 21 12 21C9.69494 21 7.59227 20.1334 6 18.7083L3 16M3 12C3 7.02944 7.02944 3 12 3C14.3051 3 16.4077 3.86656 18 5.29168L21 8M3 21V16M3 16H8M21 3V8M21 8H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>{isRefreshing ? 'Checking...' : 'Check Status'}</span>
        </button>
      )}
    </div>
  );
}
