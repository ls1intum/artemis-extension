import type { BuildLogEntry, ParsedBuildError } from '@extension/types';

import { normalizeRelativePath } from './pathUtils';

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

    public static parseFirstError(logs: BuildLogEntry[]): ParsedBuildError | null {
        for (const entry of logs) {
            const error = this.parseLogEntry(entry.log);
            if (error) {
                return error;
            }
        }
        return null;
    }

    /** Deduplicates by file, line and message. */
    public static parseAllErrors(logs: BuildLogEntry[]): ParsedBuildError[] {
        const errors: ParsedBuildError[] = [];
        const seen = new Set<string>();
        for (const entry of logs) {
            const error = this.parseLogEntry(entry.log);
            if (error) {
                const key = `${error.filePath}:${error.line}:${error.message}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    errors.push(error);
                }
            }
        }
        return errors;
    }

    private static parseLogEntry(logText: string): ParsedBuildError | null {
        // Try Gradle pattern first (most common)
        let match = logText.match(this.GRADLE_ERROR_REGEX);
        if (match) {
            return {
                filePath: normalizeRelativePath(match[1]),
                line: parseInt(match[2], 10),
                message: match[3].trim(),
            };
        }

        match = logText.match(this.MAVEN_ERROR_REGEX);
        if (match) {
            return {
                filePath: normalizeRelativePath(match[1]),
                line: parseInt(match[2], 10),
                message: match[4].trim(),
                column: parseInt(match[3], 10),
            };
        }

        match = logText.match(this.SWIFT_ERROR_REGEX);
        if (match) {
            return {
                filePath: normalizeRelativePath(match[1]),
                line: parseInt(match[2], 10),
                message: match[4].trim(),
                column: parseInt(match[3], 10),
            };
        }

        return null;
    }

    public static formatError(error: ParsedBuildError): string {
        const location = error.column 
            ? `${error.filePath}:${error.line}:${error.column}`
            : `${error.filePath}:${error.line}`;
        return `${location} - ${error.message}`;
    }
}
