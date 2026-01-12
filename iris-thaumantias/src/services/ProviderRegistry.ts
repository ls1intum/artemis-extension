import { ChatWebviewProvider } from '../provider/chatWebviewProvider';
import { ArtemisWebviewProvider } from '../provider/artemisWebviewProvider';

/**
 * Registry for managing extension-wide provider instances.
 * Replaces global state anti-pattern with a proper singleton registry.
 */
export interface IProviderRegistry {
    getChatWebviewProvider(): ChatWebviewProvider | undefined;
    getArtemisWebviewProvider(): ArtemisWebviewProvider | undefined;
    setChatWebviewProvider(provider: ChatWebviewProvider): void;
    setArtemisWebviewProvider(provider: ArtemisWebviewProvider): void;
    reset(): void;
}

export class ProviderRegistry implements IProviderRegistry {
    private static instance: ProviderRegistry;
    private chatProvider: ChatWebviewProvider | undefined;
    private artemisProvider: ArtemisWebviewProvider | undefined;

    private constructor() {
        // Private constructor enforces singleton pattern
    }

    public static getInstance(): ProviderRegistry {
        if (!ProviderRegistry.instance) {
            ProviderRegistry.instance = new ProviderRegistry();
        }
        return ProviderRegistry.instance;
    }

    public getChatWebviewProvider(): ChatWebviewProvider | undefined {
        return this.chatProvider;
    }

    public getArtemisWebviewProvider(): ArtemisWebviewProvider | undefined {
        return this.artemisProvider;
    }

    public setChatWebviewProvider(provider: ChatWebviewProvider): void {
        this.chatProvider = provider;
    }

    public setArtemisWebviewProvider(provider: ArtemisWebviewProvider): void {
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
    public requireChatWebviewProvider(): ChatWebviewProvider {
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
    public requireArtemisWebviewProvider(): ArtemisWebviewProvider {
        const provider = this.getArtemisWebviewProvider();
        if (!provider) {
            throw new Error('ArtemisWebviewProvider not initialized. This is a programming error.');
        }
        return provider;
    }
}
