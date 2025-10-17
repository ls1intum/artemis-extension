declare module '@stomp/stompjs' {
    export interface IFrame {
        command: string;
        headers: Record<string, string>;
        body: string;
    }

    export interface IMessage {
        command: string;
        headers: Record<string, string>;
        body: string;
        ack: (headers?: Record<string, string>) => void;
        nack: (headers?: Record<string, string>) => void;
    }

    export interface StompSubscription {
        id: string;
        unsubscribe: (headers?: Record<string, string>) => void;
    }

    export interface StompConfig {
        brokerURL?: string;
        connectHeaders?: Record<string, string>;
        disconnectHeaders?: Record<string, string>;
        heartbeatIncoming?: number;
        heartbeatOutgoing?: number;
        reconnectDelay?: number;
        debug?: (msg: string) => void;
        onConnect?: (frame: IFrame) => void;
        onDisconnect?: (frame: IFrame) => void;
        onStompError?: (frame: IFrame) => void;
        onWebSocketClose?: (evt: any) => void;
        onWebSocketError?: (evt: any) => void;
        onUnhandledMessage?: (message: IMessage) => void;
        onUnhandledReceipt?: (frame: IFrame) => void;
        onUnhandledFrame?: (frame: IFrame) => void;
        beforeConnect?: () => void | Promise<void>;
        webSocketFactory?: () => any;
    }

    export class Client {
        constructor(conf?: StompConfig);
        
        connected: boolean;
        active: boolean;
        
        activate(): void;
        deactivate(): Promise<void>;
        
        publish(params: {
            destination: string;
            body?: string;
            headers?: Record<string, string>;
        }): void;
        
        subscribe(
            destination: string,
            callback: (message: IMessage) => void,
            headers?: Record<string, string>
        ): StompSubscription;
        
        unsubscribe(id: string, headers?: Record<string, string>): void;
        
        begin(transaction?: string): { id: string; commit: () => void; abort: () => void };
        commit(transaction: string): void;
        abort(transaction: string): void;
        
        ack(messageId: string, subscriptionId: string, headers?: Record<string, string>): void;
        nack(messageId: string, subscriptionId: string, headers?: Record<string, string>): void;
        
        forceDisconnect(): void;
        
        onConnect?: (frame: IFrame) => void;
        onDisconnect?: (frame: IFrame) => void;
        onStompError?: (frame: IFrame) => void;
        onWebSocketClose?: (evt: any) => void;
        onWebSocketError?: (evt: any) => void;
    }
}
