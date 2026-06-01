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

    keys(): Thenable<string[]> {
        return Promise.resolve(Array.from(this.secrets.keys()));
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

export class MockTextDocument implements vscode.TextDocument {
    uri: vscode.Uri;
    fileName: string;
    isUntitled: boolean = false;
    languageId: string = 'java';
    version: number = 1;
    isDirty: boolean = false;
    isClosed: boolean = false;
    eol: vscode.EndOfLine = vscode.EndOfLine.LF;
    lineCount: number = 100;
    encoding: string = 'utf-8';

    constructor(uri: vscode.Uri, fileName: string) {
        this.uri = uri;
        this.fileName = fileName;
    }

    save(): Thenable<boolean> { return Promise.resolve(true); }
    lineAt(lineOrPos: number | vscode.Position): vscode.TextLine {
        const line = typeof lineOrPos === 'number' ? lineOrPos : lineOrPos.line;
        return {
            lineNumber: line,
            text: '',
            range: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0)),
            rangeIncludingLineBreak: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0)),
            firstNonWhitespaceCharacterIndex: 0,
            isEmptyOrWhitespace: true
        };
    }
    offsetAt(_position: vscode.Position): number { return 0; }
    positionAt(_offset: number): vscode.Position { return new vscode.Position(0, 0); }
    getText(_range?: vscode.Range): string { return ''; }
    getWordRangeAtPosition(_position: vscode.Position, _regex?: RegExp): vscode.Range | undefined { return undefined; }
    validateRange(range: vscode.Range): vscode.Range { return range; }
    validatePosition(position: vscode.Position): vscode.Position { return position; }
}
