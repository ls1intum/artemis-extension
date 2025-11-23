import * as vscode from 'vscode';

export class MockSecretStorage implements vscode.SecretStorage {
    private secrets: Map<string, string> = new Map();
    onDidChange: vscode.Event<vscode.SecretStorageChangeEvent> = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event;

    get(key: string): Thenable<string | undefined> {
        return Promise.resolve(this.secrets.get(key));
    }

    store(key: string, value: string): Thenable<void> {
        this.secrets.set(key, value);
        return Promise.resolve();
    }

    delete(key: string): Thenable<void> {
        this.secrets.delete(key);
        return Promise.resolve();
    }
}

export class MockMemento implements vscode.Memento {
    private storage: Map<string, any> = new Map();

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get(key: string, defaultValue?: any): any {
        return this.storage.get(key) ?? defaultValue;
    }

    update(key: string, value: any): Thenable<void> {
        if (value === undefined) {
            this.storage.delete(key);
        } else {
            this.storage.set(key, value);
        }
        return Promise.resolve();
    }

    keys(): readonly string[] {
        return Array.from(this.storage.keys());
    }
}

export class MockExtensionContext implements vscode.ExtensionContext {
    subscriptions: { dispose(): any }[] = [];
    workspaceState: vscode.Memento = new MockMemento();
    globalState: vscode.Memento & { setKeysForSync(keys: string[]): void } = new MockMemento() as any;
    secrets: vscode.SecretStorage = new MockSecretStorage();
    extensionUri: vscode.Uri = vscode.Uri.file('/');
    extensionPath: string = '/';
    environmentVariableCollection: vscode.GlobalEnvironmentVariableCollection = {} as any;
    storageUri: vscode.Uri | undefined;
    globalStorageUri: vscode.Uri = vscode.Uri.file('/global');
    logUri: vscode.Uri = vscode.Uri.file('/log');
    
    // Deprecated properties
    storagePath: string | undefined;
    globalStoragePath: string = '/global';
    logPath: string = '/log';

    extensionMode: vscode.ExtensionMode = vscode.ExtensionMode.Test;
    extension: vscode.Extension<any> = {} as any;
    languageModelAccessInformation: any;

    asAbsolutePath(relativePath: string): string {
        return relativePath;
    }
}
