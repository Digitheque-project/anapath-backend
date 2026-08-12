import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class ChuClient {
  private readonly cmsBaseUrl: string;
  private readonly anapathServiceId: string;
  private readonly timeout = 5000;

  constructor(configService?: ConfigService) {
    // Ce client ne parle qu'au service CHU (Render) : /chu et /prise-en-charge,
    // sécurisé par le JWT de l'écosystème d'auth (un Bearer est exigé).
    // L'ancien service CHU Railway est arrêté : aucune dépendance ne doit pointer vers lui.
    this.cmsBaseUrl = (
      configService?.get<string>('CHU_CMS_SERVICE_URL') ??
      process.env.CHU_CMS_SERVICE_URL ??
      'https://chu-service-cms7.onrender.com'
    ).replace(/\/$/, '');
    this.anapathServiceId =
      configService?.get<string>('ANAPATH_SERVICE_ID') ??
      process.env.ANAPATH_SERVICE_ID ??
      '9e73904c-71e5-4477-9280-513e4112a468';
  }

  private async cmsGet(token: string, path: string): Promise<any> {
    const { data } = await axios.get(`${this.cmsBaseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: this.timeout,
    });
    return data;
  }

  /** Liste des CHU du service CHU (fonctionne avec le token utilisateur). */
  async getCmsChus(token: string): Promise<any[]> {
    try {
      const data = await this.cmsGet(token, '/chu');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /** CHU par id : route directe puis repli sur la liste filtrée. */
  async getCmsChuById(token: string, chuId: string): Promise<any> {
    try {
      const data = await this.cmsGet(token, `/chu/${encodeURIComponent(chuId)}`);
      if (data) return data;
    } catch {}
    const list = await this.getCmsChus(token);
    return list.find((c) => String(c.id) === String(chuId)) ?? null;
  }

  /** Liste des prises en charge du service CHU (fonctionne avec le token utilisateur). */
  async getCmsPriseEnCharges(token: string): Promise<any[]> {
    try {
      const data = await this.cmsGet(token, '/prise-en-charge');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /** Prise en charge par id : route directe puis repli sur la liste filtrée. */
  async getCmsPriseEnChargeById(token: string, id: string): Promise<any> {
    try {
      const data = await this.cmsGet(token, `/prise-en-charge/${encodeURIComponent(id)}`);
      if (data) return data;
    } catch {}
    const list = await this.getCmsPriseEnCharges(token);
    return list.find((p) => String(p.id) === String(id)) ?? null;
  }
}
