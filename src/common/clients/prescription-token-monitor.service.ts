import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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

export interface PrescriptionTokenStatus {
  mode: 'compte-de-service' | 'token-statique' | 'non-configure';
  configured: boolean;
  expired: boolean | null;
  expiresAt: string | null;
  hoursRemaining: number | null;
}

/**
 * Surveille le token utilisé par le cron de pull et le WebSocket temps réel Prescription.
 * Deux modes possibles :
 * - "compte-de-service" : AuthServiceTokenService renouvelle automatiquement via
 *   AUTH_SERVICE_URL + PRESCRIPTION_SERVICE_ACCOUNT_* — dégradation quasi impossible tant
 *   que ces identifiants restent valides.
 * - "token-statique" : repli sur PRESCRIPTION_CRON_JWT (JWT de session ~24h) tant qu'aucun
 *   compte de service n'est configuré — ce moniteur alerte alors avant expiration pour
 *   éviter une dégradation silencieuse.
 */
@Injectable()
export class PrescriptionTokenMonitorService implements OnModuleInit {
  private readonly logger = new Logger('PrescriptionTokenMonitor');

  constructor(private readonly authServiceToken: AuthServiceTokenService) {}

  onModuleInit(): void {
    void this.checkExpiry();
  }

  @Cron('0 * * * *')
  async checkExpiry(): Promise<void> {
    const status = await this.getStatus();

    if (status.mode === 'compte-de-service') {
      // Renouvellement automatique — rien à surveiller manuellement, juste un
      // log si jamais le login échoue (déjà géré/loggé dans AuthServiceTokenService).
      return;
    }
    if (!status.configured) {
      this.logger.warn(
        'Ni compte de service (AUTH_SERVICE_URL + PRESCRIPTION_SERVICE_ACCOUNT_*) ni PRESCRIPTION_CRON_JWT configurés — cron de pull et WebSocket temps réel désactivés (mode dégradé).',
      );
      return;
    }
    if (status.hoursRemaining === null) {
      this.logger.warn(
        'PRESCRIPTION_CRON_JWT : impossible de lire son expiration (token malformé ?).',
      );
      return;
    }
    if (status.expired) {
      this.logger.error(
        `PRESCRIPTION_CRON_JWT EXPIRÉ depuis ${Math.abs(status.hoursRemaining).toFixed(1)}h — pull et WebSocket dégradés. Renouveler la variable d'env, ou configurer un compte de service dédié (AUTH_SERVICE_URL + PRESCRIPTION_SERVICE_ACCOUNT_*) pour ne plus jamais avoir ce problème.`,
      );
    } else if (status.hoursRemaining < 4) {
      this.logger.warn(
        `⚠️ PRESCRIPTION_CRON_JWT expire dans ${status.hoursRemaining.toFixed(1)}h — penser à le renouveler avant expiration.`,
      );
    }
  }

  async getStatus(): Promise<PrescriptionTokenStatus> {
    if (this.authServiceToken.hasServiceAccount()) {
      const token = await this.authServiceToken.getToken();
      if (!token) {
        return {
          mode: 'compte-de-service',
          configured: true,
          expired: true,
          expiresAt: null,
          hoursRemaining: null,
        };
      }
      const exp = decodeJwtExp(token);
      const expiresAtMs = exp ? exp * 1000 : null;
      return {
        mode: 'compte-de-service',
        configured: true,
        expired: false,
        expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
        hoursRemaining: expiresAtMs ? (expiresAtMs - Date.now()) / (1000 * 60 * 60) : null,
      };
    }

    const staticToken = process.env.PRESCRIPTION_CRON_JWT;
    if (!staticToken) {
      return { mode: 'non-configure', configured: false, expired: null, expiresAt: null, hoursRemaining: null };
    }
    const exp = decodeJwtExp(staticToken);
    if (!exp) {
      return { mode: 'token-statique', configured: true, expired: null, expiresAt: null, hoursRemaining: null };
    }
    const expiresAtMs = exp * 1000;
    const hoursRemaining = (expiresAtMs - Date.now()) / (1000 * 60 * 60);
    return {
      mode: 'token-statique',
      configured: true,
      expired: hoursRemaining < 0,
      expiresAt: new Date(expiresAtMs).toISOString(),
      hoursRemaining,
    };
  }
}
