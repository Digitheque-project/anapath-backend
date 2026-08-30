import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AuthServiceTokenService } from './auth-service-token.service';

export interface PrescriptionTokenStatus {
  mode: 'auto-signe' | 'non-configure';
  configured: boolean;
}

/**
 * Depuis le passage au jeton de service auto-signé (voir
 * AuthServiceTokenService), il n'y a plus de token stocké qui puisse dériver
 * vers une expiration silencieuse : chaque appel régénère un jeton frais de
 * 5 min, jamais mis en cache. La seule chose qui reste à surveiller est donc
 * binaire — JWT_SECRET est-il configuré ? — sans quoi le pull de fond et le
 * WebSocket temps réel ne peuvent tout simplement pas signer de jeton.
 */
@Injectable()
export class PrescriptionTokenMonitorService implements OnModuleInit {
  private readonly logger = new Logger('PrescriptionTokenMonitor');

  constructor(private readonly authServiceToken: AuthServiceTokenService) {}

  onModuleInit(): void {
    if (!this.authServiceToken.hasServiceAccount()) {
      this.logger.warn(
        'JWT_SECRET non défini — pull des prescriptions et WebSocket temps réel désactivés (aucun jeton de service ne peut être signé).',
      );
    }
  }

  async getStatus(): Promise<PrescriptionTokenStatus> {
    const configured = this.authServiceToken.hasServiceAccount();
    return { mode: configured ? 'auto-signe' : 'non-configure', configured };
  }
}
