import * as vscode from 'vscode';

/**
 * Log levels for the logging service
 */
enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

/**
 * Log categories for filtering and organizing logs
 */
export enum LogCategory {
    GENERAL = 'General',
    WEBSOCKET = 'WebSocket',
    IRIS_CHAT = 'Iris Chat',
    CONTEXT = 'Context',
    EXERCISE = 'Exercise',
    SUBMISSION = 'Submission',
    AUTH = 'Auth',
    API = 'API',
    FILE_MONITOR = 'File Monitor',
    TELEMETRY = 'Telemetry',
    SESSION = 'Session',
    BUILD = 'Build',
    TEST = 'Test',
    CONFIG = 'Config',
    VIEW = 'View',
    STRUGGLE = 'Struggle'
}

/**
 * Configuration options for the logging service
 */
interface LoggingConfig {
    minLevel: LogLevel;
    enabledCategories: Set<LogCategory> | 'all';
    showTimestamp: boolean;
    showCategory: boolean;
}

/**
 * Centralized logging service for the Artemis extension.
 * All logging should go through this service instead of using console.* directly.
 * 
 * Features:
 * - Configurable log levels
 * - Category-based filtering
 * - Output channel integration for VS Code
 * - Consistent log formatting with emojis and prefixes
 */
class LoggingService {
    private static instance: LoggingService;
    private outputChannel: vscode.OutputChannel | undefined;
    private config: LoggingConfig = {
        minLevel: LogLevel.INFO,
        enabledCategories: 'all',
        showTimestamp: true,
        showCategory: true
    };

    private constructor() {
        // Private constructor for singleton
    }

    /**
     * Get the singleton instance of the logging service
     */
    public static getInstance(): LoggingService {
        if (!LoggingService.instance) {
            LoggingService.instance = new LoggingService();
        }
        return LoggingService.instance;
    }

    /**
     * Initialize the logging service with VS Code output channel
     */
    public initialize(outputChannel?: vscode.OutputChannel): void {
        if (outputChannel) {
            this.outputChannel = outputChannel;
        } else {
            this.outputChannel = vscode.window.createOutputChannel('Artemis Extension');
        }
    }

    /**
     * Check if a log should be output based on level and category
     */
    private shouldLog(level: LogLevel, category?: LogCategory): boolean {
        if (level < this.config.minLevel) {
            return false;
        }
        if (category && this.config.enabledCategories !== 'all') {
            return this.config.enabledCategories.has(category);
        }
        return true;
    }

    /**
     * Format a log message with timestamp and category
     */
    private formatMessage(level: LogLevel, message: string, category?: LogCategory): string {
        const parts: string[] = [];

        if (this.config.showTimestamp) {
            const now = new Date();
            parts.push(`[${now.toISOString()}]`);
        }

        parts.push(`[${LogLevel[level]}]`);

        if (this.config.showCategory && category) {
            parts.push(`[${category}]`);
        }

        parts.push(message);

        return parts.join(' ');
    }

    /**
     * Output a log message to the output channel and optionally console
     */
    private output(level: LogLevel, message: string, category?: LogCategory, ...args: unknown[]): void {
        if (!this.shouldLog(level, category)) {
            return;
        }

        const formattedMessage = this.formatMessage(level, message, category);

        // Format additional arguments
        const argsString = args.length > 0
            ? ' ' + args.map(arg => {
                if (arg instanceof Error) {
                    return `${arg.name}: ${arg.message}\n${arg.stack || ''}`;
                }
                if (typeof arg === 'object') {
                    try {
                        return JSON.stringify(arg, null, 2);
                    } catch {
                        return String(arg);
                    }
                }
                return String(arg);
            }).join(' ')
            : '';

        const fullMessage = formattedMessage + argsString;

        // Output to VS Code output channel
        if (this.outputChannel) {
            this.outputChannel.appendLine(fullMessage);
        }

        // In development, also output to console for debugging
        if (process.env.NODE_ENV === 'development' || process.env.VSCODE_DEBUG_MODE === 'true') {
            switch (level) {
                case LogLevel.DEBUG:
                case LogLevel.INFO:
                    // eslint-disable-next-line no-console
                    console.log(fullMessage);
                    break;
                case LogLevel.WARN:
                    // eslint-disable-next-line no-console
                    console.warn(fullMessage);
                    break;
                case LogLevel.ERROR:
                    // eslint-disable-next-line no-console
                    console.error(fullMessage);
                    break;
            }
        }
    }

    // ========== Public logging methods ==========

    /**
     * Log a debug message
     */
    public debug(message: string, category?: LogCategory, ...args: unknown[]): void {
        this.output(LogLevel.DEBUG, message, category, ...args);
    }

    /**
     * Log an info message
     */
    public info(message: string, category?: LogCategory, ...args: unknown[]): void {
        this.output(LogLevel.INFO, message, category, ...args);
    }

    /**
     * Log a warning message
     */
    public warn(message: string, category?: LogCategory, ...args: unknown[]): void {
        this.output(LogLevel.WARN, message, category, ...args);
    }

    /**
     * Log an error message
     */
    public error(message: string, category?: LogCategory, ...args: unknown[]): void {
        this.output(LogLevel.ERROR, message, category, ...args);
    }

    // ========== Convenience methods with pre-set categories ==========

    /**
     * Log a WebSocket-related message
     */
    public websocket(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, `🔌 ${message}`, LogCategory.WEBSOCKET, ...args);
    }

    /**
     * Log a WebSocket warning
     */
    public websocketWarn(message: string, ...args: unknown[]): void {
        this.output(LogLevel.WARN, `🔌 ${message}`, LogCategory.WEBSOCKET, ...args);
    }

    /**
     * Log an Iris Chat-related message
     */
    public irisChat(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, `💬 ${message}`, LogCategory.IRIS_CHAT, ...args);
    }

    /**
     * Log an Iris Chat warning
     */
    public irisChatWarn(message: string, ...args: unknown[]): void {
        this.output(LogLevel.WARN, `💬 ${message}`, LogCategory.IRIS_CHAT, ...args);
    }

    /**
     * Log a context-related message
     */
    public context(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, `🔧 ${message}`, LogCategory.CONTEXT, ...args);
    }

    /**
     * Log an exercise-related message
     */
    public exercise(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, `📚 ${message}`, LogCategory.EXERCISE, ...args);
    }

    /**
     * Log a file monitor-related message
     */
    public fileMonitor(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, `📁 ${message}`, LogCategory.FILE_MONITOR, ...args);
    }

    /**
     * Log a file monitor error
     */
    public fileMonitorError(message: string, ...args: unknown[]): void {
        this.output(LogLevel.ERROR, `📁 ${message}`, LogCategory.FILE_MONITOR, ...args);
    }

    /**
     * Log a telemetry-related message
     */
    public telemetry(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, message, LogCategory.TELEMETRY, ...args);
    }

    /**
     * Log a session-related message
     */
    public session(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, `🎯 ${message}`, LogCategory.SESSION, ...args);
    }

    /**
     * Log a session error
     */
    public sessionError(message: string, ...args: unknown[]): void {
        this.output(LogLevel.ERROR, `🎯 ${message}`, LogCategory.SESSION, ...args);
    }

    /**
     * Log a view-related message
     */
    public view(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, `👁️ ${message}`, LogCategory.VIEW, ...args);
    }

    /**
     * Log a view error
     */
    public viewError(message: string, ...args: unknown[]): void {
        this.output(LogLevel.ERROR, `👁️ ${message}`, LogCategory.VIEW, ...args);
    }

}

// Export singleton instance
export const logger = LoggingService.getInstance();
