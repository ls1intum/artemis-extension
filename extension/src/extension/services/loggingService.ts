import * as vscode from 'vscode';

enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

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
    VIEW = 'View'
}

interface LoggingConfig {
    minLevel: LogLevel;
    enabledCategories: Set<LogCategory> | 'all';
    showTimestamp: boolean;
    showCategory: boolean;
}

/**
 * Centralized logging service. All logging goes through this instead of
 * console.* directly.
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

    public static getInstance(): LoggingService {
        if (!LoggingService.instance) {
            LoggingService.instance = new LoggingService();
        }
        return LoggingService.instance;
    }

    public initialize(outputChannel?: vscode.OutputChannel): void {
        if (outputChannel) {
            this.outputChannel = outputChannel;
        } else {
            this.outputChannel = vscode.window.createOutputChannel('Artemis Extension');
        }
    }

    private shouldLog(level: LogLevel, category?: LogCategory): boolean {
        if (level < this.config.minLevel) {
            return false;
        }
        if (category && this.config.enabledCategories !== 'all') {
            return this.config.enabledCategories.has(category);
        }
        return true;
    }

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

    private output(level: LogLevel, message: string, category?: LogCategory, ...args: unknown[]): void {
        if (!this.shouldLog(level, category)) {
            return;
        }

        const formattedMessage = this.formatMessage(level, message, category);

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

    public debug(message: string, category?: LogCategory, ...args: unknown[]): void {
        this.output(LogLevel.DEBUG, message, category, ...args);
    }

    public info(message: string, category?: LogCategory, ...args: unknown[]): void {
        this.output(LogLevel.INFO, message, category, ...args);
    }

    public warn(message: string, category?: LogCategory, ...args: unknown[]): void {
        this.output(LogLevel.WARN, message, category, ...args);
    }

    public error(message: string, category?: LogCategory, ...args: unknown[]): void {
        this.output(LogLevel.ERROR, message, category, ...args);
    }

    public websocket(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, `🔌 ${message}`, LogCategory.WEBSOCKET, ...args);
    }

    public websocketWarn(message: string, ...args: unknown[]): void {
        this.output(LogLevel.WARN, `🔌 ${message}`, LogCategory.WEBSOCKET, ...args);
    }

    public irisChat(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, `💬 ${message}`, LogCategory.IRIS_CHAT, ...args);
    }

    public irisChatWarn(message: string, ...args: unknown[]): void {
        this.output(LogLevel.WARN, `💬 ${message}`, LogCategory.IRIS_CHAT, ...args);
    }

    public context(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, `🔧 ${message}`, LogCategory.CONTEXT, ...args);
    }

    public exercise(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, `📚 ${message}`, LogCategory.EXERCISE, ...args);
    }

    public fileMonitor(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, `📁 ${message}`, LogCategory.FILE_MONITOR, ...args);
    }

    public fileMonitorError(message: string, ...args: unknown[]): void {
        this.output(LogLevel.ERROR, `📁 ${message}`, LogCategory.FILE_MONITOR, ...args);
    }

    public telemetry(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, message, LogCategory.TELEMETRY, ...args);
    }

    public session(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, `🎯 ${message}`, LogCategory.SESSION, ...args);
    }

    public sessionError(message: string, ...args: unknown[]): void {
        this.output(LogLevel.ERROR, `🎯 ${message}`, LogCategory.SESSION, ...args);
    }

    public view(message: string, ...args: unknown[]): void {
        this.output(LogLevel.INFO, `👁️ ${message}`, LogCategory.VIEW, ...args);
    }

    public viewError(message: string, ...args: unknown[]): void {
        this.output(LogLevel.ERROR, `👁️ ${message}`, LogCategory.VIEW, ...args);
    }

}

export const logger = LoggingService.getInstance();
