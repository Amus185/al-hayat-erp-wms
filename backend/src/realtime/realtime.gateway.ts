import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';

interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  permissions: string[];
  warehouseId?: string;
  branchId?: string;
}

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: 'operations',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Extract token from handshake auth or query
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        (client.handshake.query?.token as string | undefined);

      if (!token) {
        this.logger.warn(`WS client ${client.id} rejected — no token`);
        client.emit('error', { message: 'Authentication required' });
        client.disconnect(true);
        return;
      }

      const secret = this.config.get<string>('JWT_ACCESS_SECRET');
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, { secret });

      // Store user info on socket for later use
      (client as Socket & { user: JwtPayload }).user = payload;

      // Join user-specific room for targeted notifications
      void client.join(`user:${payload.sub}`);

      // Join role-based rooms
      for (const perm of payload.permissions ?? []) {
        void client.join(`perm:${perm}`);
      }

      // Join warehouse/branch operational rooms if scoped
      if (payload.warehouseId) {
        void client.join(`warehouse:${payload.warehouseId}`);
      }
      if (payload.branchId) {
        void client.join(`branch:${payload.branchId}`);
      }

      // Managers join global ops room
      const isManager =
        payload.permissions?.some((p) =>
          ['inventory.adjust', 'transfers.approve', 'purchasing.write', 'reports.read'].includes(p),
        ) ?? false;
      if (isManager) {
        void client.join('ops:managers');
      }

      this.logger.log(`WS connected: ${payload.email} (${client.id})`);
      client.emit('connected', { userId: payload.sub, name: payload.name });
    } catch (err) {
      this.logger.warn(`WS auth failed for ${client.id}: ${(err as Error).message}`);
      client.emit('error', { message: 'Invalid or expired token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const user = (client as Socket & { user?: JwtPayload }).user;
    if (user) {
      this.logger.log(`WS disconnected: ${user.email} (${client.id})`);
    }
  }

  /** Client can ping to check connection health */
  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket, @MessageBody() _data: unknown) {
    client.emit('pong', { timestamp: Date.now() });
  }
}
