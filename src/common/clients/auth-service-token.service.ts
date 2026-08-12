import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

function decodeJwtExpMs(token: string): number | null {
  try {
    const payloadB64 = token.split('.')[1];
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Obtient et renouvelle automatiquement un token JWT pour un compte de service dédié,
 * via POST /auth/login sur le service d'authentification central (auth-service). Remplace
 * le besoin de coller manuellement un token de session (PRESCRIPTION_CRON_JWT) qui expire
 * ~24h — utilisé par le cron de pull ET le WebSocket temps réel Prescription.
 *
 * Si PRESCRIPTION_SERVICE_ACCOUNT_EMAIL/PASSWORD ne sont pas configurés, retombe sur le
 * token statique PRESCRIPTION_CRON_JWT (compatibilité ascendante / migration progressive
 * tant qu'aucun compte de service dédié n'a été créé côté auth).
 */
@Injectable()
export class AuthServiceTokenService {
  private readonly logger = new Logger('AuthServiceToken');
  private readonly authServiceUrl: string;
  private readonly email?: string;
  private readonly password?: string;
  private readonly staticFallbackToken?: string;
  private readonly timeout = 30000;
  // Renouvelle un peu avant l'expiration réelle pour ne jamais être pris au dépourvu.
  private readonly refreshMarginMs = 15 * 60 * 1000;
  private cached: CachedToken | null = null;
  private loginPromise: Promise<string | undefined> | null = null;

  constructor(configService?: ConfigService) {
    this.authServiceUrl = (
      configService?.get<string>('AUTH_SERVICE_URL') ??
      process.env.AUTH_SERVICE_URL ??
      'https://auth-service-4q6g.onrender.com'
    ).replace(/\/$/, '');
    this.email =
      configService?.get<string>('PRESCRIPTION_SERVICE_ACCOUNT_EMAIL') ??
      process.env.PRESCRIPTION_SERVICE_ACCOUNT_EMAIL ??
      // Variante acceptée sur Render : le nom EMAIL n'a pas pu y être enregistré,
      // le compte est stocké sous PRESCRIPTION_SERVICE_ACCOUNT_MAIL.
      process.env.PRESCRIPTION_SERVICE_ACCOUNT_MAIL;
    this.password =
      configService?.get<string>('PRESCRIPTION_SERVICE_ACCOUNT_PASSWORD') ??
      process.env.PRESCRIPTION_SERVICE_ACCOUNT_PASSWORD ??
      // Variante acceptée sur Render : PRESCRIPTION_SERVICE_ACCOUNT_PWD.
      process.env.PRESCRIPTION_SERVICE_ACCOUNT_PWD;
    this.staticFallbackToken =
      configService?.get<string>('PRESCRIPTION_CRON_JWT') ??
      process.env.PRESCRIPTION_CRON_JWT;
  }

  hasServiceAccount(): boolean {
    return Boolean(this.email && this.password);
  }

  /** Retourne un token valide — se reconnecte automatiquement si besoin, sinon retombe sur le token statique. */
  async getToken(): Promise<string | undefined> {
    if (!this.hasServiceAccount()) {
      return this.staticFallbackToken;
    }
    if (this.cached && this.cached.expiresAtMs - this.refreshMarginMs > Date.now()) {
      return this.cached.token;
    }
    // Anti-rafale : n'appelle /auth/login qu'une fois même si getToken() est invoqué en parallèle.
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }
    return this.loginPromise;
  }

  private async login(): Promise<string | undefined> {
    try {
      const { data } = await axios.post(
        `${this.authServiceUrl}/auth/login`,
        { email: this.email, password: this.password },
        { timeout: this.timeout },
      );
      const token: string | undefined = data?.accessToken ?? data?.token ?? data?.access_token;
      if (!token) {
        this.logger.error(
          `Réponse de /auth/login sans token reconnu (clés reçues: ${Object.keys(data ?? {}).join(', ') || 'aucune'})`,
        );
        return this.cached?.token ?? this.staticFallbackToken;
      }
      const expiresAtMs = decodeJwtExpMs(token) ?? Date.now() + 60 * 60 * 1000;
      this.cached = { token, expiresAtMs };
      this.logger.log(
        `Nouveau token de service obtenu automatiquement, valide jusqu'à ${new Date(expiresAtMs).toISOString()}`,
      );
      return token;
    } catch (e) {
      this.logger.error(
        `Échec du renouvellement automatique du token de service : ${e instanceof Error ? e.message : e}`,
      );
      // Dégradé : garder l'ancien token en cache s'il existe encore, sinon le repli statique.
      return this.cached?.token ?? this.staticFallbackToken;
    }
  }
}
