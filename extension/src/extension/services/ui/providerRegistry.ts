import type { IChatWebviewProvider } from '../../types/IChatWebviewProvider';
import type { IArtemisWebviewProvider } from '../../types/IArtemisWebviewProvider';

export interface IProviderRegistry {
    getChatWebviewProvider(): IChatWebviewProvider | undefined;
    setChatWebviewProvider(provider: IChatWebviewProvider): void;
    getArtemisWebviewProvider(): IArtemisWebviewProvider | undefined;
    setArtemisWebviewProvider(provider: IArtemisWebviewProvider): void;
}

export function createProviderRegistry(): IProviderRegistry {
    let chatProvider: IChatWebviewProvider | undefined;
    let artemisProvider: IArtemisWebviewProvider | undefined;
    return {
        getChatWebviewProvider: () => chatProvider,
        setChatWebviewProvider: (provider) => { chatProvider = provider; },
        getArtemisWebviewProvider: () => artemisProvider,
        setArtemisWebviewProvider: (provider) => { artemisProvider = provider; },
    };
}
