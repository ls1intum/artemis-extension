export interface AppConfig {
    /** Absolute path to the recordings root directory. */
    recordingsDir: string;
    /** Token for a rater login. If undefined, rater login is not configured. */
    liveToken: string | undefined;
    /** Token for a researcher login (`/annotations/all` access). If undefined, researcher login is not configured. */
    researcherToken: string | undefined;
    /** HMAC secret for signed `ViewerSession` cookies. Must be at least 32 bytes worth of entropy. */
    sessionSecret: string;
    /** When true, mutating endpoints (delete/rename/upload/open-folder) are accepted. */
    allowWrite: boolean;
}

export interface ServerResponse {
    setHeader(name: string, value: string): void;
    end(data?: string | Buffer): void;
    writeHead(status: number): void;
    write?(chunk: string | Buffer): boolean;
}

export interface IncomingRequest {
    url?: string;
    method?: string;
    headers?: Record<string, string | string[] | undefined>;
    on(event: 'data', cb: (chunk: Buffer) => void): void;
    on(event: 'end' | 'close', cb: () => void): void;
    on(event: 'error', cb: (err: Error) => void): void;
    pipe(dest: NodeJS.WritableStream): void;
}
