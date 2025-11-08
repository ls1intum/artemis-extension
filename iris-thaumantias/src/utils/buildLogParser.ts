import type { BuildLogEntry, ParsedBuildError } from '../types';

/**
 * Parse build logs to extract error information (file path, line number, message)
 * Supports multiple build systems: Gradle, Maven, Swift, etc.
 */
export class BuildLogParser {
    // Java/Gradle pattern: src/path/File.java:10: error: message
    private static readonly GRADLE_ERROR_REGEX = /(src\/[^:]+\.java):(\d+):\s*error:\s*(.+)/i;
    
    // Maven pattern: [ERROR] /src/path/File.java:[10,5] message
    private static readonly MAVEN_ERROR_REGEX = /\[ERROR\]\s*\/?([^:]+\.java):\[(\d+),(\d+)\]\s*(.+)/i;
    
    // Swift pattern: Sources/path/File.swift:10:5: error: message
    private static readonly SWIFT_ERROR_REGEX = /(Sources\/[^:]+\.swift):(\d+):(\d+):\s*error:\s*(.+)/i;

    /**
     * Parse build logs and extract the first error found
     * @param logs Array of build log entries
     * @returns Parsed error information or null if no error found
     */
    public static parseFirstError(logs: BuildLogEntry[]): ParsedBuildError | null {
        for (const entry of logs) {
            const error = this.parseLogEntry(entry.log);
            if (error) {
                return error;
            }
        }
        return null;
    }

    /**
     * Parse a single log entry for error information
     * @param logText The log text to parse
     * @returns Parsed error or null
     */
    private static parseLogEntry(logText: string): ParsedBuildError | null {
        // Try Gradle pattern first (most common)
        let match = logText.match(this.GRADLE_ERROR_REGEX);
        if (match) {
            return {
                filePath: match[1],
                line: parseInt(match[2], 10),
                message: match[3].trim()
            };
        }

        // Try Maven pattern
        match = logText.match(this.MAVEN_ERROR_REGEX);
        if (match) {
            return {
                filePath: match[1].replace(/^\//, ''), // Remove leading slash
                line: parseInt(match[2], 10),
                column: parseInt(match[3], 10),
                message: match[4].trim()
            };
        }

        // Try Swift pattern
        match = logText.match(this.SWIFT_ERROR_REGEX);
        if (match) {
            return {
                filePath: match[1],
                line: parseInt(match[2], 10),
                column: parseInt(match[3], 10),
                message: match[4].trim()
            };
        }

        return null;
    }

    /**
     * Format error for display in build log
     * @param error Parsed error information
     * @returns Formatted string
     */
    public static formatError(error: ParsedBuildError): string {
        const location = error.column 
            ? `${error.filePath}:${error.line}:${error.column}`
            : `${error.filePath}:${error.line}`;
        return `${location} - ${error.message}`;
    }
}
