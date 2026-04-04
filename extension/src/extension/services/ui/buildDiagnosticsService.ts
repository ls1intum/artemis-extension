import type { ArtemisApiService } from '../../api';
import type { ResultDTO } from '../../types';
import { type ParsedBuildError } from '../../types';
import { BuildLogParser } from '../../utils';
import type { BuildErrorCodeLensProvider } from '../../provider/buildErrorCodeLensProvider';
import { logger, LogCategory } from '../loggingService';

export class BuildDiagnosticsService {
    private _codeLensProvider?: BuildErrorCodeLensProvider;

    constructor(private readonly _artemisApi: ArtemisApiService) {}

    public setCodeLensProvider(provider: BuildErrorCodeLensProvider): void {
        this._codeLensProvider = provider;
    }

    public handleBuildResult(result: ResultDTO): void {
        const participationId = result.participation?.id;
        if (!participationId) {
            return;
        }

        void (async () => {
            try {
                const logs = await this._artemisApi.getBuildLogs(participationId, result.id);
                const errors = BuildLogParser.parseAllErrors(logs);

                this._codeLensProvider?.clearErrors();

                const errorsByFile = new Map<string, ParsedBuildError[]>();
                for (const error of errors) {
                    const existing = errorsByFile.get(error.filePath) ?? [];
                    existing.push(error);
                    errorsByFile.set(error.filePath, existing);
                }

                for (const [filePath, fileErrors] of errorsByFile) {
                    this._codeLensProvider?.setErrors(filePath, fileErrors);
                }
            } catch (err) {
                logger.error('Failed to fetch build logs for CodeLens:', LogCategory.SUBMISSION, err);
            }
        })();
    }
}
