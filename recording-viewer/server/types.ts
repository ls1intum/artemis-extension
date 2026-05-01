export interface AppConfig {
    /** Absolute path to the recordings root directory. */
    recordingsDir: string;
    /** Token required for authenticated requests. If undefined, no auth is required (and server must bind to localhost). */
    liveToken: string | undefined;
    /** When true, mutating endpoints (delete/rename/upload/open-folder/full-replace annotations) are accepted. */
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
    on(event: 'end' | 'close' | 'error', cb: () => void): void;
    pipe(dest: NodeJS.WritableStream): void;
}
