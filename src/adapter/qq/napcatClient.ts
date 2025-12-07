import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'node:url';
import type { Dispatcher } from '../../core/dispatcher/dispatcher.js';
import type { Logger } from '../../infra/logger/logger.js';
import type { Context } from '../../core/model/Context.js';
import type { MessageReceivedEvent } from '../../core/model/Event.js';
import { createContext } from '../../core/model/Context.js';
import { mapOneBot11ToEvent, type OneBot11Message } from './qqEventMapper.js';
import { qqPerformAction } from './qqActionAdapter.js';

/**
 * NapCat reverse WebSocket client for QQ integration.
 * Connects to NapCat's reverse WS endpoint and handles OneBot11 protocol.
 * https://napcat.onlineread more about NapCat
 */
export class NapcatClient {
  private dispatcher: Dispatcher;
  private logger: Logger;
  private wsPort: number;
  private wsPath: string;
  private token?: string;
  private wss: WebSocketServer | null = null;
  private connections: Set<WebSocket> = new Set();

  constructor(dispatcher: Dispatcher, logger: Logger, wsPort: number = 6090, token?: string) {
    this.dispatcher = dispatcher;
    this.logger = logger;
    this.wsPort = wsPort;
    this.wsPath = '/';
    this.token = token;
  }

  /**
   * Start reverse WebSocket server to accept connections from NapCat.
   */
  public start(): void {
    this.wss = new WebSocketServer({
      port: this.wsPort,
      path: this.wsPath,
    });

    this.logger.info(
      'napcat',
      `Reverse WS server listening on ws://localhost:${this.wsPort}${this.wsPath}`,
    );

    this.wss.on('connection', (ws: WebSocket, req) => {
      // Token validation: required in prod, optional in dev/test
      if (this.token) {
        const providedToken = this.extractToken(req.headers['authorization'], req.url);
        if (providedToken !== this.token) {
          const providedPreview = providedToken ? String(providedToken).substring(0, 10) : 'none';
          const expectedPreview = this.token ? String(this.token).substring(0, 10) : 'none';
          this.logger.warn(
            'napcat',
            `Connection rejected: invalid token (provided: ${providedPreview}..., expected: ${expectedPreview}...)`,
          );
          ws.close(4401, 'Unauthorized');
          return;
        }
      } else {
        this.logger.warn('napcat', 'Token not configured - accepting connection (dev/test mode)');
      }

      this.logger.info('napcat', 'New NapCat connection established');
      this.connections.add(ws);

      ws.on('message', async (data: Buffer) => {
        try {
          const raw = JSON.parse(data.toString()) as OneBot11Message;
          await this.handleMessage(raw, ws);
        } catch (err) {
          this.logger.error(
            'napcat',
            `Failed to parse message: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });

      ws.on('close', () => {
        this.logger.info('napcat', 'NapCat connection closed');
        this.connections.delete(ws);
      });

      ws.on('error', (err: Error) => {
        this.logger.error(
          'napcat',
          `WebSocket error: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.connections.delete(ws);
      });
    });

    this.wss.on('error', (err: Error) => {
      this.logger.error(
        'napcat',
        `Server error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private extractToken(
    authHeader: string | string[] | undefined,
    url?: string,
  ): string | undefined {
    // 1. Try Authorization header
    if (typeof authHeader === 'string') {
      // Handle "Bearer <token>" format
      if (authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
      }
      // Handle plain token
      return authHeader;
    }
    if (Array.isArray(authHeader) && authHeader.length > 0) {
      const first = authHeader[0];
      if (first.startsWith('Bearer ')) {
        return first.substring(7);
      }
      return first;
    }

    // 2. Try query parameter ?access_token=<token>
    if (url) {
      try {
        const parsed = new URL(url, `http://localhost:${this.wsPort}`);
        const t = parsed.searchParams.get('access_token');
        if (t) return t;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Handle incoming OneBot11 message.
   */
  private async handleMessage(raw: OneBot11Message, ws: WebSocket): Promise<void> {
    // Map OneBot11 message to ArxsBot event
    const event = mapOneBot11ToEvent(raw);
    if (!event || event.type !== 'message.received') {
      return; // Not a message event we care about
    }

    const msgEvent = event as MessageReceivedEvent;
    const channelId = msgEvent.message.channelId;
    const user = msgEvent.message.author || {
      id: msgEvent.message.userId,
      platform: 'qq' as const,
      displayName: `User${msgEvent.message.userId}`,
    };

    const context: Context = createContext('qq', channelId, user, {
      group: msgEvent.group,
      currentMessage: msgEvent.message,
      recentMessages: [msgEvent.message],
    });

    this.logger.debug('napcat', `Received message from ${msgEvent.message.userId} in ${channelId}`);

    // Dispatch to get actions
    const actions = await this.dispatcher.dispatch(msgEvent, context);

    // Execute actions
    for (const action of actions) {
      try {
        await qqPerformAction(action, (msg) => ws.send(JSON.stringify(msg)), this.logger);
      } catch (err) {
        this.logger.error(
          'napcat',
          `Failed to perform action: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Stop the reverse WebSocket server.
   */
  public stop(): void {
    if (this.wss) {
      for (const ws of this.connections) {
        ws.close();
      }
      this.wss.close(() => {
        this.logger.info('napcat', 'Reverse WS server stopped');
      });
    }
  }
}
