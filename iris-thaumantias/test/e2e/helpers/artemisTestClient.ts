import { logger, LogCategory } from '../../../src/extension/services/loggingService';

/**
 * Base Artemis API test client with authentication and cookie management.
 * Extend this class with domain-specific methods for each E2E test suite.
 */
export class ArtemisTestClient {
    protected baseUrl: string;
    protected cookies: string[] = [];

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    async login(username: string, password: string): Promise<boolean> {
        logger.info(`[E2E] Logging in as ${username}...`, LogCategory.TEST);

        const response = await fetch(`${this.baseUrl}/api/core/public/authenticate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, rememberMe: true }),
        });

        if (response.ok) {
            const setCookieHeader = response.headers.get('set-cookie');
            if (setCookieHeader) {
                this.cookies = setCookieHeader.split(',').map(c => c.split(';')[0].trim());
            }
            logger.info('[E2E] Login successful', LogCategory.TEST);
            return true;
        }

        logger.error(`[E2E] Login failed: ${response.status}`, LogCategory.TEST);
        return false;
    }

    protected getHeaders(): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.cookies.length > 0) {
            headers['Cookie'] = this.cookies.join('; ');
        }
        return headers;
    }
}
