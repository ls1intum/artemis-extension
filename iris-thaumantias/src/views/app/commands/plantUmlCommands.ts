import * as vscode from 'vscode';
import { processPlantUml, extractErrorMessage } from '../../../utils';
import { logger } from '../../../services/loggingService';
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
        const { plantUml, index } = getPayload<WebCmd<'renderPlantUmlInline'>>(message);

        if (!plantUml) {
            this.context.sendMessage({
                type: ExtensionMsg.PlantUmlError,
                index: index,
                error: 'No PlantUML content provided'
            });
            return;
        }

        try {
            logger.plantUml(`Rendering inline PlantUML diagram ${index + 1}`);

            const processedPlantUml = processPlantUml(plantUml);
            const isDarkTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
            const svg = await this.context.artemisApi.renderPlantUmlToSvg(processedPlantUml, isDarkTheme);

            this.context.sendMessage({
                type: ExtensionMsg.PlantUmlRendered,
                index: index,
                svg: svg
            });

            logger.plantUml(`✅ Inline PlantUML diagram ${index + 1} rendered successfully`);
        } catch (error: unknown) {
            logger.plantUmlError(`Render inline PlantUML error for diagram ${index + 1}:`, error);
            const errorMsg = extractErrorMessage(error);
            this.context.sendMessage({
                type: ExtensionMsg.PlantUmlError,
                index: index,
                error: errorMsg
            });
        }
    };

}
