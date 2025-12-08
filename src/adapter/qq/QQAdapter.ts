import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'node:url';
import type { Logger } from '../../infra/logger/logger.js';
import type { MainRouter } from '../../core/router/MainRouter.js';
import { mapToChatEvent, type OneBot11Message } from './qqEventMapper.js';
import { QQMessageSender } from './QQMessageSender.js';

/**
 * QQ/NapCat adapter - handles OneBot11 protocol.
 * Normalizes all events to ChatEvent and forwards to MainRouter.
 */
export class QQAdapter {
  private router: MainRouter;
  private logger: Logger;
  private wsPort: number;
  private wsPath: string;
  private token?: string;
  private wss: WebSocketServer | null = null;
  private connections: Set<WebSocket> = new Set();

  constructor(router: MainRouter, logger: Logger, wsPort: number = 6090, token?: string) {
    this.router = router;
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

    this.logger.info('qq-adapter', `Listening on ws://localhost:${this.wsPort}${this.wsPath}`);

    this.wss.on('connection', (ws: WebSocket, req) => {
      // Token validation
      if (this.token) {
        const providedToken = this.extractToken(req.headers['authorization'], req.url);
        if (providedToken !== this.token) {
          this.logger.warn('qq-adapter', 'Connection rejected: invalid token');
          ws.close(4401, 'Unauthorized');
          return;
        }
      } else {
        this.logger.warn('qq-adapter', 'Token not configured - accepting connection (dev mode)');
      }

      this.logger.info('qq-adapter', 'New connection established');
      this.connections.add(ws);

      // Create message sender for this connection
      const sender = new QQMessageSender(ws, this.logger);

      // Temporarily inject sender into router and command router
      // TODO: Better architecture - consider passing sender in handleEvent() or using ConnectionContext
      (this.router as any).sender = sender;
      if ((this.router as any).commandRouter) {
        (this.router as any).commandRouter.sender = sender;
      }

      ws.on('message', async (data: Buffer) => {
        try {
          const raw = JSON.parse(data.toString()) as OneBot11Message;
          await this.handleMessage(raw);
        } catch (err) {
          this.logger.error(
            'qq-adapter',
            `Parse error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });

      ws.on('close', () => {
        this.logger.info('qq-adapter', 'Connection closed');
        this.connections.delete(ws);
      });

      ws.on('error', (err: Error) => {
        this.logger.error('qq-adapter', `WebSocket error: ${err.message}`);
        this.connections.delete(ws);
      });
    });

    this.wss.on('error', (err: Error) => {
      this.logger.error('qq-adapter', `Server error: ${err.message}`);
    });
  }

  private extractToken(
    authHeader: string | string[] | undefined,
    url?: string,
  ): string | undefined {
    // Try Authorization header (OneBot11 standard)
    if (typeof authHeader === 'string') {
      if (authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
      }
      return authHeader;
    }
    if (Array.isArray(authHeader) && authHeader.length > 0) {
      const first = authHeader[0];
      if (first.startsWith('Bearer ')) {
        return first.substring(7);
      }
      return first;
    }

    // Try query parameter ?access_token=<token>
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
   * Handle incoming OneBot11 message - normalize to ChatEvent and forward to router.
   */
  private async handleMessage(raw: OneBot11Message): Promise<void> {
    const chatEvent = mapToChatEvent(raw, this.logger);
    if (!chatEvent) {
      return; // Invalid event or self-message, ignore
    }

    // Forward to main router
    await this.router.handleEvent(chatEvent);
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
        this.logger.info('qq-adapter', 'Server stopped');
      });
    }
  }
}
