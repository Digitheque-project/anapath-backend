import { Injectable } from '@nestjs/common';
import { AuthServiceTokenService } from './auth-service-token.service';

const ACCUEIL_BASE_URL =
  process.env.ACCUEIL_BASE_URL ??
  'https://gateway-bwm4.onrender.com';

@Injectable()
export class AccueilClient {
  constructor(private readonly authServiceToken: AuthServiceTokenService) {}

  private async buildHeaders(): Promise<Record<string, string>> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const token =
      process.env.ACCUEIL_SERVICE_TOKEN ??
      (await this.authServiceToken.getToken());
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  private patientCache = new Map<string, { at: number; patient: any | null }>();
  private inflight = new Map<string, Promise<any | null>>();
  private readonly PATIENT_CACHE_TTL_MS = 10 * 60 * 1000;
  // Échec (accueil endormi, timeout…) : on retente vite — sinon un seul raté
  // affiche l'ID brut du patient à la place de son nom pendant une heure.
  private readonly PATIENT_CACHE_FAIL_TTL_MS = 60 * 1000;
  private readonly PATIENT_CACHE_MAX = 500;
  private readonly ACCUEIL_TIMEOUT_MS = 30000;

  async getPatient(patientId: string, chuId: string): Promise<any | null> {
    if (!patientId || !chuId) {
      console.warn('getPatient: patientId et chuId requis', { patientId, chuId });
      return null;
    }
    const key = `${patientId}|${chuId}`;
    const cached = this.patientCache.get(key);
    if (cached) {
      const ttl = cached.patient ? this.PATIENT_CACHE_TTL_MS : this.PATIENT_CACHE_FAIL_TTL_MS;
      if (Date.now() - cached.at < ttl) return cached.patient;
    }
    const inflight = this.inflight.get(key);
    if (inflight) return inflight;
    const promise = this.doGetPatient(key, patientId, chuId).finally(() => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  private async doGetPatient(
    key: string,
    patientId: string,
    chuId: string,
  ): Promise<any | null> {
    try {
      const url = `${ACCUEIL_BASE_URL}/accueil/patients/`
        + `${encodeURIComponent(patientId)}`
        + `?chuId=${encodeURIComponent(chuId)}`;
      const res = await fetch(url, {
        headers: await this.buildHeaders(),
        signal: AbortSignal.timeout(this.ACCUEIL_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(`Accueil getPatient ${res.status}:`, url);
        this.setPatientCache(key, null);
        return null;
      }
      const data = await res.json();
      this.setPatientCache(key, data);
      return data;
    } catch {
      this.setPatientCache(key, null);
      return null;
    }
  }

  private setPatientCache(key: string, patient: any | null): void {
    if (this.patientCache.size >= this.PATIENT_CACHE_MAX) {
      const oldest = this.patientCache.keys().next().value;
      if (oldest !== undefined) this.patientCache.delete(oldest);
    }
    this.patientCache.set(key, { at: Date.now(), patient });
  }

  async getAllergie(id: string, chuId: string): Promise<string | null> {
    if (!id || !chuId) return null;
    try {
      const url = `${ACCUEIL_BASE_URL}/accueil/patients/`
        + `${encodeURIComponent(id)}/allergie?chuId=${encodeURIComponent(chuId)}`;
      const res = await fetch(url, {
        headers: await this.buildHeaders(),
        signal: AbortSignal.timeout(this.ACCUEIL_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(`Accueil getAllergie ${res.status}:`, url);
        return null;
      }
      const data = await res.json();
      return typeof data?.allergie === 'string' ? data.allergie : null;
    } catch {
      return null;
    }
  }

  calculateAge(dateNaissance: string): number | null {
    if (!dateNaissance) return null;
    try {
      const birth = new Date(dateNaissance);
      const now = new Date();
      let age = now.getFullYear() - birth.getFullYear();
      const m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) {
        age--;
      }
      return age;
    } catch {
      return null;
    }
  }

  buildNomComplet(patient: any): string {
    if (!patient) return '';
    if (typeof patient.nomComplet === 'string' && patient.nomComplet.trim()) {
      return patient.nomComplet.trim();
    }
    const nom = patient.nom ?? '';
    const prenom = patient.prenom ?? '';
    return [nom, prenom].filter(Boolean).join(' ').trim();
  }
}
