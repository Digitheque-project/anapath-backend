import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthClient } from '../auth/clients/auth.client';
import { getCorsOrigins } from '../common/cors-origins';
import {
  isMajorRole,
  isChefRole,
  notificationRecipientGroups,
  userRecipientGroup,
} from '../common/notification-recipients';
import { NotificationType } from '../notification/dto/receive-notification.dto';

/**
 * Gateway WebSocket backend → navigateur : pousse en temps réel chaque
 * notification créée (event `notification:new`) vers les clients concernés.
 *
 * Authentification : le client fournit le MÊME JWT que l'API REST via
 * `auth.token` du handshake (obtenu côté frontend par /api/anapath/notifications/ws-ticket,
 * qui n'expose que le token de la session en cours). La validation réutilise
 * AuthClient.validateToken — exactement la même logique que JwtAuthGuard.
 * Connexion rejetée (disconnect) si le token est absent, invalide ou expiré.
 *
 * Ciblage par rôle : chaque client rejoint le salon « anapath » (toutes les
 * notifications) ET un salon de groupe (« anapath:technicien »,
 * « anapath:pathologiste », « anapath:autre »). Une notification destinée à un
 * groupe précis (metadata.recipientRole, ex. technicien ou pathologiste) n'est
 * poussée QUE vers ce groupe — un major ne reçoit jamais la notification d'un
 * autre rôle.
 */
@WebSocketGateway({
  namespace: '/anapath',
  cors: { origin: getCorsOrigins(), credentials: true },
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection
{
  @WebSocketServer()
  server: Server;

  constructor(private readonly authClient: AuthClient) {}

  afterInit(): void {
    console.log(
      `✅ Gateway temps réel active sur /anapath (origines: ${getCorsOrigins().join(', ')})`,
    );
  }

  async handleConnection(client: Socket): Promise<void> {
    const auth = (client.handshake.auth ?? {}) as { token?: string };
    const token = auth.token;
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const user = await this.authClient.validateToken(token);
      if (!user) {
        client.disconnect(true);
        return;
      }
      client.data.user = user;
      const group = userRecipientGroup(user);
      client.data.recipientGroup = group;
      client.data.isMajor = isMajorRole(user.roleName);
      // Le chef de service consulte les rapports hebdomadaires (sans pouvoir
      // les télécharger) : il est donc aussi destinataire de la notification.
      client.data.reportViewer = isMajorRole(user.roleName) || isChefRole(user.roleName);
      client.join('anapath');
      client.join(`anapath:${group}`);
    } catch {
      client.disconnect(true);
    }
  }

  /** Émet `notification:new` vers les groupes de destinataires (ou tous si aucun). */
  async emitNotificationCreated(notification: unknown): Promise<void> {
    const groups = notificationRecipientGroups(notification);
    if (groups && groups.length > 0) {
      // Ciblage par groupes de rôles : une STAT_ALERT va au technicien ET au
      // pathologiste ; une notification destinée au major (rapport hebdomadaire)
      // ne part jamais à la secrétaire, pourtant du groupe « autre ».
      if (groups.includes('major')) {
        const sockets = await this.server?.in('anapath').fetchSockets();
        if (!sockets) return;
        for (const socket of sockets) {
          if (!socket.data?.reportViewer) continue;
          socket.emit('notification:new', notification);
        }
        return;
      }
      if (groups.includes('autre')) {
        const sockets = await this.server?.in('anapath').fetchSockets();
        if (!sockets) return;
        for (const socket of sockets) {
          if (socket.data?.isMajor) continue;
          socket.emit('notification:new', notification);
        }
        return;
      }
      // Groupes « simple » (technicien / pathologiste) : salon dédié.
      for (const g of groups) {
        this.server?.to(`anapath:${g}`).emit('notification:new', notification);
      }
      return;
    }
    // Notification générique (sans groupe ciblé) : tout le monde SAUF le major —
    // qui ne reçoit que la notification du rapport hebdomadaire.
    const type =
      (notification as any)?.type ?? (notification as any)?.metadata?.type;
    const isReport =
      type === NotificationType.RAPPORT_HEBDOMADAIRE || type === 'RAPPORT';
    const sockets = await this.server?.in('anapath').fetchSockets();
    if (!sockets) return;
    for (const socket of sockets) {
      if (!isReport && socket.data?.isMajor) continue;
      socket.emit('notification:new', notification);
    }
  }
}
