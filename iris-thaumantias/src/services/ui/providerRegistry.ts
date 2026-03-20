import type { IChatWebviewProvider } from '../../types/IChatWebviewProvider';

/**
 * Registry for managing extension-wide provider instances.
 * Replaces global state anti-pattern with a proper singleton registry.
 */
export interface IProviderRegistry {
    getChatWebviewProvider(): IChatWebviewProvider | undefined;
    setChatWebviewProvider(provider: IChatWebviewProvider): void;
}

export class ProviderRegistry implements IProviderRegistry {
    private chatProvider: IChatWebviewProvider | undefined;

    public getChatWebviewProvider(): IChatWebviewProvider | undefined {
        return this.chatProvider;
    }

    public setChatWebviewProvider(provider: IChatWebviewProvider): void {
        this.chatProvider = provider;
    }
}
