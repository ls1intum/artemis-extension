import * as vscode from 'vscode';
import { processPlantUml, extractErrorMessage } from '../../utils';
import { logger, LogCategory } from '../../services/loggingService';
import type { CommandContext, CommandMap } from './types';
import { getPayload, ExtensionMsg, WebviewCmd } from '../../../shared/messageContracts';
import type {
    WebviewToExtensionMessage,
    WebCmd,
} from '../../../shared/messageContracts';

export class PlantUmlCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.RenderPlantUmlInline]: this.handleRenderPlantUmlInline,
        };
    }

    private handleRenderPlantUmlInline = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { plantUml, index, nonce } = getPayload<WebCmd<'renderPlantUmlInline'>>(message);

        if (!plantUml) {
            this.context.sendMessage({
                type: ExtensionMsg.PlantUmlError,
                index: index,
                error: 'No PlantUML content provided',
                nonce: nonce
            });
            return;
        }

        try {
            logger.info(`Rendering inline PlantUML diagram ${index + 1}`, LogCategory.PLANTUML);

            const processedPlantUml = processPlantUml(plantUml);
            const isDarkTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
            const svg = await this.context.artemisApi.renderPlantUmlToSvg(processedPlantUml, isDarkTheme);

            this.context.sendMessage({
                type: ExtensionMsg.PlantUmlRendered,
                index: index,
                svg: svg,
                nonce: nonce
            });

            logger.info(`✅ Inline PlantUML diagram ${index + 1} rendered successfully`, LogCategory.PLANTUML);
        } catch (error: unknown) {
            logger.error(`Render inline PlantUML error for diagram ${index + 1}:`, LogCategory.PLANTUML, error);
            const errorMsg = extractErrorMessage(error);
            this.context.sendMessage({
                type: ExtensionMsg.PlantUmlError,
                index: index,
                error: errorMsg,
                nonce: nonce
            });
        }
    };

}
