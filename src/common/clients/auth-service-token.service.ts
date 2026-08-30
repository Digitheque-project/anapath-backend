import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

const ANAPATH_SERVICE_ID =
  process.env.ANAPATH_SERVICE_ID ?? '9e73904c-71e5-4477-9280-513e4112a468';

/**
 * Jeton de service auto-signé pour les appels sortants sans requête utilisateur
 * (cron de pull des prescriptions, WebSocket temps réel, repli dans
 * AnapathService.resolveTokens quand aucun token utilisateur n'est disponible).
 *
 * Remplace l'ancien mécanisme à base de compte de service dédié (POST
 * /auth/login avec PRESCRIPTION_SERVICE_ACCOUNT_EMAIL/PASSWORD stockés en
 * variable d'environnement) : dans un déploiement hospitalier réel, ces
 * identifiants peuvent être changés ou révoqués par l'IT sans préavis, ce qui
 * casserait silencieusement le pull en production sans qu'aucun code n'ait
 * changé. Un jeton auto-signé n'a pas ce problème — rien à stocker, rien à
 * faire tourner, rien qui expire sans qu'on puisse le regénérer à la volée.
 *
 * Signé avec le même secret que celui qui signe déjà les JWT utilisateurs SSO
 * (JWT_SECRET, partagé avec la gateway et les autres services de
 * l'écosystème) : les services tiers qui font confiance à ce secret (ex.
 * service Prescription) acceptent ce jeton comme n'importe quel JWT SSO
 * légitime.
 *
 * Jamais mis en cache : régénéré à chaque appel. Durée de vie volontairement
 * courte (5 min) pour limiter la fenêtre d'exploitation en cas de fuite —
 * sans coût, puisqu'il n'y a justement plus de renouvellement à orchestrer.
 */
@Injectable()
export class AuthServiceTokenService {
  private readonly logger = new Logger('AuthServiceToken');
  private readonly jwtSecret: string;

  constructor(configService?: ConfigService) {
    this.jwtSecret =
      configService?.get<string>('JWT_SECRET') ?? process.env.JWT_SECRET ?? '';
  }

  /** Un jeton de service peut être signé dès que JWT_SECRET est configuré. */
  hasServiceAccount(): boolean {
    return Boolean(this.jwtSecret);
  }

  /** Ne throw jamais : renvoie undefined si JWT_SECRET est absent, l'appelant reste dégradé proprement. */
  async getToken(): Promise<string | undefined> {
    if (!this.jwtSecret) {
      this.logger.warn(
        'JWT_SECRET non défini — impossible de signer un jeton de service, le pull de fond des prescriptions et le WebSocket temps réel échoueront.',
      );
      return undefined;
    }
    return jwt.sign(
      {
        userId: 'anapath-service-account',
        name: 'Anapath',
        firstname: 'Service',
        email: 'service@anapath.internal',
        services: [
          {
            serviceId: ANAPATH_SERVICE_ID,
            serviceName: 'Anatomopathologie',
            roleName: 'SERVICE',
            permissions: [],
          },
        ],
      },
      this.jwtSecret,
      { expiresIn: '5m' },
    );
  }
}
