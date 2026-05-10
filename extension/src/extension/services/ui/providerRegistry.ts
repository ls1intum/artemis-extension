import type { IChatWebviewProvider } from '../../types/IChatWebviewProvider';

export interface IProviderRegistry {
    getChatWebviewProvider(): IChatWebviewProvider | undefined;
    setChatWebviewProvider(provider: IChatWebviewProvider): void;
}

export function createProviderRegistry(): IProviderRegistry {
    let chatProvider: IChatWebviewProvider | undefined;
    return {
        getChatWebviewProvider: () => chatProvider,
        setChatWebviewProvider: (provider) => { chatProvider = provider; },
    };
}
