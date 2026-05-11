import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as readline from 'readline';

/**
 * One JSONL line plus its 1-based file line number. The line number lets the
 * SSE handler emit `id:` values that align with file positions, so reconnect
 * via Last-Event-ID can skip forward deterministically.
 */
export interface NumberedLine {
    lineNo: number;
    line: string;
}

/**
 * Streaming-read `events.jsonl` and keep the last `limit` non-empty lines via
 * a ringbuffer. Memory is O(limit), not O(file). Returns each retained line
 * with its file-line-number.
 *
 * Also returns the cursor that the caller can use to coordinate live tailing:
 * `endLineNo` is the line number of the last line in the file at read time,
 * `endByteOffset` is the byte position right after the final newline.
 */
export async function readLastNLines(
    filePath: string,
    limit: number,
): Promise<{ lines: NumberedLine[]; endLineNo: number; endByteOffset: number }> {
    // Always stream the file to compute endLineNo correctly. A short-circuit
    // that returns endLineNo: 0 for limit=0 would mislead callers that rely
    // on this cursor (e.g. SSE gap-read interpreting "no catch-up requested"
    // as "no lines exist yet" and replaying the entire file).
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const ring: NumberedLine[] = [];
    let lineNo = 0;
    for await (const line of rl) {
        lineNo++;
        if (line.length === 0) continue;
        if (limit > 0) {
            ring.push({ lineNo, line });
            if (ring.length > limit) ring.shift();
        }
    }
    const stat = await fsPromises.stat(filePath);
    return { lines: ring, endLineNo: lineNo, endByteOffset: Number(stat.size) };
}

/**
 * Stream-read `events.jsonl` and emit every line with `lineNo > afterLineNo`
 * (and `<= maxLineNo` if provided). Used by the SSE handler to send the
 * "gap" between a per-connection catch-up snapshot and the shared tailer's
 * current broadcast position, and to resume a connection from a client's
 * Last-Event-ID.
 */
export async function readLinesAfter(
    filePath: string,
    afterLineNo: number,
    maxLineNo?: number,
): Promise<{ lines: NumberedLine[]; endLineNo: number; endByteOffset: number }> {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const out: NumberedLine[] = [];
    let lineNo = 0;
    for await (const line of rl) {
        lineNo++;
        if (line.length === 0) continue;
        if (lineNo <= afterLineNo) continue;
        if (maxLineNo !== undefined && lineNo > maxLineNo) break;
        out.push({ lineNo, line });
    }
    const stat = await fsPromises.stat(filePath);
    return { lines: out, endLineNo: lineNo, endByteOffset: Number(stat.size) };
}
