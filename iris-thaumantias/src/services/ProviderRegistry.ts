import type { IChatWebviewProvider } from '../types/IChatWebviewProvider';
import type { IArtemisWebviewProvider } from '../types/IArtemisWebviewProvider';

/**
 * Registry for managing extension-wide provider instances.
 * Replaces global state anti-pattern with a proper singleton registry.
 */
export interface IProviderRegistry {
    getChatWebviewProvider(): IChatWebviewProvider | undefined;
    getArtemisWebviewProvider(): IArtemisWebviewProvider | undefined;
    setChatWebviewProvider(provider: IChatWebviewProvider): void;
    setArtemisWebviewProvider(provider: IArtemisWebviewProvider): void;
    reset(): void;
}

export class ProviderRegistry implements IProviderRegistry {
    private chatProvider: IChatWebviewProvider | undefined;
    private artemisProvider: IArtemisWebviewProvider | undefined;

    public getChatWebviewProvider(): IChatWebviewProvider | undefined {
        return this.chatProvider;
    }

    public getArtemisWebviewProvider(): IArtemisWebviewProvider | undefined {
        return this.artemisProvider;
    }

    public setChatWebviewProvider(provider: IChatWebviewProvider): void {
        this.chatProvider = provider;
    }

    public setArtemisWebviewProvider(provider: IArtemisWebviewProvider): void {
        this.artemisProvider = provider;
    }

    /**
     * Clears all registered providers.
     * Useful for testing to ensure clean state between test runs.
     */
    public reset(): void {
        this.chatProvider = undefined;
        this.artemisProvider = undefined;
    }

    /**
     * Gets the chat provider or throws an error if not initialized.
     * Use this when the provider must be available.
     */
    public requireChatWebviewProvider(): IChatWebviewProvider {
        const provider = this.getChatWebviewProvider();
        if (!provider) {
            throw new Error('ChatWebviewProvider not initialized. This is a programming error.');
        }
        return provider;
    }

    /**
     * Gets the artemis provider or throws an error if not initialized.
     * Use this when the provider must be available.
     */
    public requireArtemisWebviewProvider(): IArtemisWebviewProvider {
        const provider = this.getArtemisWebviewProvider();
        if (!provider) {
            throw new Error('ArtemisWebviewProvider not initialized. This is a programming error.');
        }
        return provider;
    }
}
