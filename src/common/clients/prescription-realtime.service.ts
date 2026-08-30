import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { io, Socket } from 'socket.io-client';
import { AnapathService } from '../../anapath/anapath.service';
import { AuthServiceTokenService } from './auth-service-token.service';

/**
 * Client WebSocket (Socket.IO) vers le service Prescription — §4 du prompt
 * d'intégration. Le WebSocket sert de SIGNAL : à chaque événement pertinent, on
 * re-pull en REST (source de vérité) via AnapathService.synchroniserPrescriptions,
 * puis on acquitte la notification.
 *
 * Le token provient d'AuthServiceTokenService (jeton de service auto-signé
 * avec JWT_SECRET, régénéré à chaque appel) : plus de compte de service à gérer,
 * plus de token statique à renouveler. `auth` est fourni en fonction (pas en
 * objet figé) pour que chaque tentative de reconnexion Socket.IO récupère un token frais
 * plutôt que de rejouer indéfiniment celui capturé au premier appel.
 */
@Injectable()
export class PrescriptionRealtimeService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('PrescriptionRealtime');
  private socket?: Socket;
  private repullTimer?: ReturnType<typeof setTimeout>;

  private readonly baseUrl: string;
  private readonly enabled: boolean;
  private readonly serviceId?: string;

  constructor(
    private readonly anapathService: AnapathService,
    private readonly authServiceToken: AuthServiceTokenService,
    configService?: ConfigService,
  ) {
    this.baseUrl = (
      configService?.get<string>('PRESCRIPTION_SERVICE_URL') ??
      process.env.PRESCRIPTION_SERVICE_URL ??
      'https://gateway-bwm4.onrender.com'
    ).replace(/\/$/, '');
    this.enabled =
      (configService?.get<string>('PRESCRIPTION_WS_ENABLED') ??
        process.env.PRESCRIPTION_WS_ENABLED ??
        'true') === 'true';
    this.serviceId =
      configService?.get<string>('ANAPATH_SERVICE_ID') ??
      process.env.ANAPATH_SERVICE_ID;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Temps réel désactivé (PRESCRIPTION_WS_ENABLED=false)');
      return;
    }
    const token = await this.authServiceToken.getToken();
    if (!token) {
      this.logger.warn(
        'Temps réel non démarré : aucun jeton de service disponible (JWT_SECRET manquant) — le cron 15 min prend le relais',
      );
      return;
    }
    this.connect();
  }

  onModuleDestroy(): void {
    if (this.repullTimer) clearTimeout(this.repullTimer);
    this.socket?.disconnect();
  }

  private connect(): void {
    const url = `${this.baseUrl}/notifications`;
    this.socket = io(url, {
      transports: ['websocket'],
      // Fonction (pas objet figé) : appelée à chaque tentative de connexion/reconnexion,
      // garantit un token toujours frais sans avoir à recréer le socket.
      auth: (cb: (data: { token?: string }) => void) => {
        this.authServiceToken
          .getToken()
          .then((token) => cb({ token }))
          .catch(() => cb({}));
      },
      query: this.serviceId ? { service: this.serviceId } : undefined,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.socket.on('connect', () => {
      this.logger.log('Connecté au temps réel Prescription');
      // Pull de rattrapage à chaque (re)connexion : on récupère ce qui a pu
      // être manqué pendant une déconnexion.
      this.scheduleRepull('connect');
    });

    this.socket.on('disconnect', (reason: string) => {
      this.logger.warn(`Déconnecté (${reason}) — reconnexion automatique`);
    });

    this.socket.on('connect_error', (err: Error) => {
      this.logger.warn(`Erreur de connexion temps réel : ${err.message}`);
    });

    this.socket.io.on('reconnect_attempt', (attempt: number) => {
      this.logger.warn(
        `Tentative de reconnexion temps réel n°${attempt} — cause sous-jacente à vérifier si répétée (réseau, CORS, namespace /notifications côté service Prescription)`,
      );
    });

    // Événements signalant une nouvelle prescription / un changement pour anapath.
    const handle = (label: string) => (payload: any) => {
      this.logger.log(`Événement reçu : ${label}`);
      this.scheduleRepull(label);
      const notificationId = payload?.id ?? payload?.notificationId;
      if (notificationId && this.socket?.connected) {
        this.socket.emit('ack', { notificationId });
      }
    };

    this.socket.on('notification', handle('notification'));
    this.socket.on('prescription.anapath', handle('prescription.anapath'));
    this.socket.on('prescription:created', handle('prescription:created'));
    this.socket.on('prescription:updated', handle('prescription:updated'));
  }

  /**
   * Re-pull anti-rafale : plusieurs événements rapprochés ne déclenchent qu'un
   * seul pull REST (débounce 500 ms). Le pull dédoublonne déjà par demandeId.
   */
  private scheduleRepull(reason: string): void {
    if (this.repullTimer) clearTimeout(this.repullTimer);
    this.repullTimer = setTimeout(() => {
      void this.authServiceToken
        .getToken()
        .then((token) => {
          if (!token) return null;
          return this.anapathService.synchroniserPrescriptions(token);
        })
        .then((r) => {
          if (r && r.notificationsCreees > 0) {
            this.logger.log(
              `Re-pull (${reason}) : ${r.notificationsCreees} nouvelle(s) notification(s)`,
            );
          }
        })
        .catch((e) => {
          this.logger.warn(
            `Re-pull (${reason}) échoué : ${e instanceof Error ? e.message : e}`,
          );
        });
    }, 500);
  }
}
