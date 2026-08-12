import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface PrescriptionDemande {
  id: string;
  typeExamen: string;
  data?: Record<string, any>;
  statut?: string;
  [key: string]: any;
}

export interface AnapathPrescription {
  id: string;
  patientId: string;
  prescripteurId?: string;
  urgence?: string;
  alertes?: string;
  chuId?: string;
  serviceIdSource?: string;
  serviceIdDest?: string;
  demandes: PrescriptionDemande[];
  [key: string]: any;
}

interface AnapathPrescriptionFilters {
  chuId?: string;
  serviceIdDest?: string;
  typeExamen?: string;
}

/**
 * Client vers le service Prescription externe. Contrairement à ChuClient/AccueilClient,
 * ce service exige un Bearer JWT — celui de l'utilisateur actuellement connecté à anapath
 * est réutilisé tel quel (même écosystème d'auth que user-services), le token est donc
 * toujours passé en paramètre explicite plutôt que lu d'un état global.
 */
@Injectable()
export class PrescriptionClient {
  private readonly baseUrl: string;
  private readonly timeout = 5000;

  constructor(configService?: ConfigService) {
    this.baseUrl = (
      configService?.get<string>('PRESCRIPTION_SERVICE_URL') ??
      process.env.PRESCRIPTION_SERVICE_URL ??
      'https://prescriptionback-production.up.railway.app'
    ).replace(/\/$/, '');
  }

  private headers(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  /** Normalise la forme d'une demande — le champ id exact n'est pas documenté côté service externe. */
  private normalizeDemande(raw: any): PrescriptionDemande {
    return {
      ...raw,
      id: raw?.id ?? raw?._id ?? raw?.demandeId,
    };
  }

  private normalizePrescription(raw: any): AnapathPrescription {
    return {
      ...raw,
      id: raw?.id ?? raw?._id ?? raw?.prescriptionId,
      demandes: Array.isArray(raw?.demandes)
        ? raw.demandes.map((d: any) => this.normalizeDemande(d))
        : [],
    };
  }

  async getAnapathPrescriptions(
    token: string,
    filters?: AnapathPrescriptionFilters,
  ): Promise<AnapathPrescription[]> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/prescriptions/anapath`, {
        headers: this.headers(token),
        params: filters,
        timeout: this.timeout,
      });
      return Array.isArray(data) ? data.map((p) => this.normalizePrescription(p)) : [];
    } catch (e: any) {
      // 401 = token invalide/expiré (cause racine fréquente du « temps réel qui ne
      // remonte pas » : le WebSocket se connecte mais le re-pull REST est rejeté).
      const status = e?.response?.status;
      console.warn(
        `PrescriptionClient.getAnapathPrescriptions échoué (HTTP ${status ?? 'inconnu'}):`,
        e instanceof Error ? e.message : e,
      );
      return [];
    }
  }

  /** Propage le changement de statut d'une demande vers le service Prescription. Ne throw jamais — mode dégradé. */
  async updateDemandeStatut(
    token: string,
    prescriptionId: string,
    demandeId: string,
    statut: string,
    motif?: string,
  ): Promise<boolean> {
    try {
      await axios.patch(
        `${this.baseUrl}/prescriptions/anapath/${prescriptionId}/demandes/${demandeId}/statut`,
        { statut, ...(motif ? { motif } : {}) },
        { headers: this.headers(token), timeout: this.timeout },
      );
      return true;
    } catch (e) {
      console.warn(
        `PrescriptionClient.updateDemandeStatut échoué (prescription=${prescriptionId}, demande=${demandeId}):`,
        e instanceof Error ? e.message : e,
      );
      return false;
    }
  }
}
