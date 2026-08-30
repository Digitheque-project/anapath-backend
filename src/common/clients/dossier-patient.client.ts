import { Injectable, Logger } from '@nestjs/common';
import { AuthServiceTokenService } from './auth-service-token.service';

const DOSSIER_PATIENT_BASE_URL =
  process.env.DOSSIER_PATIENT_URL ??
  'https://gateway-bwm4.onrender.com';

@Injectable()
export class DossierPatientClient {
  private readonly logger = new Logger('DossierPatientClient');
  private readonly baseUrl: string;
  private readonly timeout = 30000;

  constructor(private readonly authServiceToken: AuthServiceTokenService) {
    this.baseUrl = (DOSSIER_PATIENT_BASE_URL).replace(/\/$/, '');
  }

  private async headers(): Promise<Record<string, string>> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = await this.authServiceToken.getToken();
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  /**
   * Historique complet des examens complémentaires d'un patient dans TOUT le
   * CHU (serviceId omis volontairement) : chirurgie, anapath, imagerie…
   * Réponse du service : [items, total].
   */
  async getPatientExaminations(
    chuId: string,
    patientId: string,
  ): Promise<any[]> {
    try {
      const url = `${this.baseUrl}/dossier-patient/complementary-examinations`;
      const res = await fetch(`${url}?chuId=${encodeURIComponent(chuId)}&patientId=${encodeURIComponent(patientId)}`, {
        headers: await this.headers(),
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(`getPatientExaminations ${res.status}: ${body}`);
        return [];
      }
      const data = await res.json();
      // Format paginé [items, total] sinon liste directe.
      return Array.isArray(data)
        ? Array.isArray(data[0])
          ? data[0]
          : data
        : [];
    } catch (e) {
      this.logger.warn(`getPatientExaminations erreur: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  /**
   * Résultats paracliniques AGRÉGÉS d'un patient (tous services du CHU) :
   * ECG, imagerie, kinésithérapie… C'est la vue « Résultats Paracliniques »
   * du dossier-patient — différente des complementary-examinations.
   * Réponse : { data: [...], total }.
   */
  async getPatientAggregatedResults(patientId: string, chuId: string): Promise<any[]> {
    try {
      const url = `${this.baseUrl}/dossier-patient/patients/${encodeURIComponent(patientId)}/resultats`;
      const res = await fetch(`${url}?chuId=${encodeURIComponent(chuId)}`, {
        headers: await this.headers(),
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(`getPatientAggregatedResults ${res.status}: ${body}`);
        return [];
      }
      const data = await res.json();
      return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    } catch (e) {
      this.logger.warn(`getPatientAggregatedResults erreur: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }
}
