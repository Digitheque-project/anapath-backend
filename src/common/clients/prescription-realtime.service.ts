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

function decodeJwtExp(token: string): number | null {
  try {
    const payloadB64 = token.split('.')[1];
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Client WebSocket (Socket.IO) vers le service Prescription — §4 du prompt
 * d'intégration. Le WebSocket sert de SIGNAL : à chaque événement pertinent, on
 * re-pull en REST (source de vérité) via AnapathService.synchroniserPrescriptions,
 * puis on acquitte la notification.
 *
 * Le token provient d'AuthServiceTokenService : renouvelé automatiquement via un
 * compte de service dédié si configuré (AUTH_SERVICE_URL + PRESCRIPTION_SERVICE_ACCOUNT_*),
 * sinon replié sur PRESCRIPTION_CRON_JWT statique. `auth` est fourni en fonction (pas en
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
        'Temps réel non démarré : aucun token disponible (ni compte de service, ni PRESCRIPTION_CRON_JWT) — le cron 15 min prend le relais',
      );
      return;
    }
    // Détection précoce d'un token statique EXPIRÉ : le WebSocket Prescription
    // n'authentifie pas la connexion, mais le re-pull REST qui suit chaque événement
    // partira avec ce token et sera rejeté en 401 (cause n°1 de « rien n'apparaît »).
    const exp = decodeJwtExp(token);
    if (exp !== null && exp * 1000 < Date.now()) {
      this.logger.error(
        `PRESCRIPTION_CRON_JWT EXPIRÉ depuis ${((Date.now() - exp * 1000) / 3600000).toFixed(1)}h — le socket va se connecter mais chaque re-pull REST renverra 401 (aucune notification). Renouveler PRESCRIPTION_CRON_JWT ou configurer un compte de service (PRESCRIPTION_SERVICE_ACCOUNT_EMAIL/PASSWORD).`,
      );
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
