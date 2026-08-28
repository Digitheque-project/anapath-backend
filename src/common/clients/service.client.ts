import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/**
 * Client vers le service-service (registre des services du CHU) — source
 * officielle du libellé « Service demandeur » (serviceIdSource d'une
 * prescription). Accédé via le gateway central (gateway-bwm4.onrender.com).
 * Routes réelles à la racine : GET /services (liste, optionnel ?chuId=)
 * et GET /services/{id} (résolution directe par UUID). Exige un Bearer JWT.
 * À la différence de l'ancien repli via PrescriptionClient.getServices,
 * ce service est dédié et expose la résolution par identifiant.
 */
@Injectable()
export class ServiceServiceClient {
  private readonly baseUrl: string;
  private readonly timeout = 5000;

  constructor(configService?: ConfigService) {
    this.baseUrl = (
      configService?.get<string>('SERVICE_SERVICE_URL') ??
      process.env.SERVICE_SERVICE_URL ??
      'https://gateway-bwm4.onrender.com'
    ).replace(/\/$/, '');
  }

  private async getJson(token: string, path: string): Promise<any> {
    const { data } = await axios.get(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: this.timeout,
    });
    return data;
  }

  /** Service par UUID (résolution directe du service demandeur). */
  async getServiceById(token: string, serviceId: string): Promise<any | null> {
    try {
      const data = await this.getJson(
        token,
        `/services/${encodeURIComponent(serviceId)}`,
      );
      return data ?? null;
    } catch {
      return null;
    }
  }

  /** Services d'un CHU (tous si chuId absent). */
  async getServicesByChu(token: string, chuId?: string): Promise<any[]> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/services`, {
        headers: { Authorization: `Bearer ${token}` },
        params: chuId ? { chuId } : undefined,
        timeout: this.timeout,
      });
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }
}
