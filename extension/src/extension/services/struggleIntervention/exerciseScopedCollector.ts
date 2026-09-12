import * as vscode from 'vscode';

import { shouldRecordUriString } from '@extension/services/sensing/uriFilter';
import { checkWorkspaceFiles } from '@extension/services/workspace/workspaceFileChecker';

export interface EgressCaps {
    maxFiles: number;
    maxPerFileBytes: number;
    maxTotalBytes: number;
}

const DEFAULT_EGRESS_CAPS: EgressCaps = { maxFiles: 40, maxPerFileBytes: 64 * 1024, maxTotalBytes: 256 * 1024 };

export interface CandidateFile {
    path: string;
    content: string;
}

const byteLen = (s: string): number => new TextEncoder().encode(s).length;

/** Pure: enforce count / per-file / total-byte caps on already-collected, already-scoped candidates. */
export function applyEgressCaps(candidates: readonly CandidateFile[], caps: EgressCaps): Record<string, string> {
    const out: Record<string, string> = {};
    let total = 0;
    let count = 0;
    for (const f of candidates) {
        if (count >= caps.maxFiles) {
            break;
        }
        const bytes = byteLen(f.content);
        if (bytes > caps.maxPerFileBytes) {
            continue;
        }
        if (total + bytes > caps.maxTotalBytes) {
            break;
        }
        out[f.path] = f.content;
        total += bytes;
        count += 1;
    }
    return out;
}

/**
 * Collect uncommitted files scoped to the active exercise. Reuses the existing workspace
 * collector, then keeps only files under {@code exerciseRoot} (the engine's membership primitive) and
 * applies the egress caps. Returns a path→content map (the wire {@code uncommittedFiles}).
 */
export async function collectExerciseScopedFiles(exerciseRoot: vscode.Uri | undefined, caps: EgressCaps = DEFAULT_EGRESS_CAPS): Promise<Record<string, string>> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        return {};
    }
    const result = await checkWorkspaceFiles(folder, { includeContent: true, applyFilters: true, includeStatus: true, checkUnpushed: true, includeDirty: true });
    const rootStr = exerciseRoot?.toString();
    const candidates: CandidateFile[] = result.files
        .filter(f => f.status === 'included' && f.content !== undefined)
        .filter(f => shouldRecordUriString(vscode.Uri.joinPath(folder.uri, f.path).toString(), rootStr))
        .map(f => ({ path: f.path, content: f.content as string }));
    return applyEgressCaps(candidates, caps);
}
