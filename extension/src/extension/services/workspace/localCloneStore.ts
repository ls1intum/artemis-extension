import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { selectParticipation } from '@shared/utils/participationSelection';

import { LogCategory, logger } from '@extension/services/loggingService';
import { expandHomePath, VSCODE_CONFIG } from '@extension/utils';

import { getRepositoryOriginUrl, normalizeRepositoryUrl } from './workspaceDetectionService';

const STORAGE_KEY = 'artemis.localClones';

/** Oldest entries are evicted beyond this; one entry per cloned repository. */
const MAX_ENTRIES = 50;

/** Normalized repository URL to the folder it was cloned into, oldest first. */
type CloneMap = Record<string, string>;

export interface LocalCloneStoreDeps {
    readOriginUrl: (fsPath: string) => Promise<string | null>;
    isDirectory: (fsPath: string) => Promise<boolean>;
    getDefaultClonePath: () => string;
}

const defaultDeps: LocalCloneStoreDeps = {
    readOriginUrl: getRepositoryOriginUrl,
    isDirectory: async (fsPath) => (await fs.promises.stat(fsPath)).isDirectory(),
    getDefaultClonePath: () => expandHomePath(
        vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION)
            .get<string>(VSCODE_CONFIG.DEFAULT_CLONE_PATH_KEY, '').trim(),
    ),
};

/**
 * Where each exercise repository was cloned on this machine, so a clone that is
 * not the open workspace can still be offered for opening after a reload or a
 * restart. Paths are machine-local, hence globalState without sync.
 */
export class LocalCloneStore {
    private readonly deps: LocalCloneStoreDeps;

    constructor(private readonly memento: vscode.Memento, deps: Partial<LocalCloneStoreDeps> = {}) {
        this.deps = { ...defaultDeps, ...deps };
    }

    /** Never throws: a clone that worked must not be reported as failed over bookkeeping. */
    public async remember(repositoryUri: string, fsPath: string): Promise<void> {
        try {
            const key = normalizeRepositoryUrl(repositoryUri);
            const clones = { ...this.read() };
            // Re-inserted so a fresh clone counts as the newest entry for eviction.
            delete clones[key];
            clones[key] = fsPath;
            const keys = Object.keys(clones);
            for (const evicted of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
                delete clones[evicted];
            }
            await this.memento.update(STORAGE_KEY, clones);
        } catch (error: unknown) {
            logger.warn('Could not remember a local clone', LogCategory.SUBMISSION, error);
        }
    }

    /**
     * The folder holding a clone of `repositoryUri`: the remembered one, else the
     * repository-named folder inside the default clone path. A candidate counts
     * only while its origin is still that repository. Never throws: callers use
     * it beside a workspace status that must still reach the view.
     */
    public async find(repositoryUri: string): Promise<string | undefined> {
        try {
            return await this.lookup(repositoryUri);
        } catch (error: unknown) {
            logger.warn('Could not look up a local clone', LogCategory.SUBMISSION, error);
            return undefined;
        }
    }

    private async lookup(repositoryUri: string): Promise<string | undefined> {
        const key = normalizeRepositoryUrl(repositoryUri);
        const remembered = this.read()[key];
        if (remembered !== undefined) {
            if (await this.isCloneOf(remembered, key)) {
                return remembered;
            }
            await this.forget(key);
        }

        const defaultClonePath = this.deps.getDefaultClonePath();
        if (defaultClonePath) {
            const candidate = path.join(defaultClonePath, path.basename(repositoryUri).replace(/\.git$/, ''));
            if (candidate !== remembered && await this.isCloneOf(candidate, key)) {
                return candidate;
            }
        }
        return undefined;
    }

    /**
     * Whether the participation a disconnected exercise view shows has a clone on
     * disk. Only that one: the button it drives opens what the card describes.
     */
    public async hasCloneOfDisplayedParticipation(
        participations: readonly { testRun?: boolean; repositoryUri?: string }[] | undefined,
    ): Promise<boolean> {
        const repositoryUri = selectParticipation(participations, false)?.repositoryUri;
        return repositoryUri !== undefined && (await this.find(repositoryUri)) !== undefined;
    }

    private async isCloneOf(fsPath: string, normalizedUri: string): Promise<boolean> {
        try {
            if (!await this.deps.isDirectory(fsPath)) {
                return false;
            }
            const origin = await this.deps.readOriginUrl(fsPath);
            return origin !== null && normalizeRepositoryUrl(origin) === normalizedUri;
        } catch (error: unknown) {
            logger.debug('Local clone candidate rejected', LogCategory.SUBMISSION, error);
            return false;
        }
    }

    private async forget(key: string): Promise<void> {
        const clones = { ...this.read() };
        delete clones[key];
        try {
            await this.memento.update(STORAGE_KEY, clones);
        } catch (error: unknown) {
            logger.warn('Could not forget a stale local clone', LogCategory.SUBMISSION, error);
        }
    }

    private read(): CloneMap {
        const stored = this.memento.get<unknown>(STORAGE_KEY);
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
            return {};
        }
        return Object.fromEntries(
            Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        );
    }
}
