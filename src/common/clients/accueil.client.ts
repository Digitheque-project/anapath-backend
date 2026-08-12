import { Injectable } from '@nestjs/common';

// Valeur confirmée en prod : le service Accueil (migré sur Render) expose ses
// routes AVEC le préfixe `/accueil/...` — l'URL de base est donc la racine,
// SANS suffixe `/accueil/api` (celui-ci pointe vers le Swagger UI, pas l'API).
// Vérifié : GET https://acceuil-back.onrender.com/accueil/patients?chuId=… → 200 JSON.
const ACCUEIL_BASE_URL =
  process.env.ACCUEIL_BASE_URL ??
  'https://acceuil-back.onrender.com';

@Injectable()
export class AccueilClient {
  /**
   * En-têtes des appels vers Accueil. Vérifié sur le service en prod : l'API est
   * actuellement ouverte (200 sans token) malgré un securitySchemes.bearer déclaré
   * dans l'OpenAPI. Si `ACCUEIL_SERVICE_TOKEN` est défini, on l'envoie en Bearer
   * pour rester compatible le jour où Accueil imposerait le JWT — sinon le
   * comportement est strictement identique à aujourd'hui.
   */
  private buildHeaders(): Record<string, string> {
    const token = process.env.ACCUEIL_SERVICE_TOKEN;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  // Cache en mémoire des patients résolus (patientId|chuId -> patient ou null),
  // pour que l'enrichissement des listes (GET /anapath) n'appelle Accueil qu'une
  // fois par patient au lieu d'un appel par demande. Les résultats négatifs sont
  // aussi mis en cache (évite de marteler Accueil quand il est indisponible) mais
  // avec un TTL plus long (backoff) pour ne pas re-attaquer un service en panne.
  private patientCache = new Map<string, { at: number; patient: any | null }>();
  // Requêtes en vol : évite que N enrichissements parallèles du même patient
  // déclenchent N appels Accueil simultanés (cause racine des 429).
  private inflight = new Map<string, Promise<any | null>>();
  private readonly PATIENT_CACHE_TTL_MS = 10 * 60 * 1000;
  private readonly PATIENT_CACHE_FAIL_TTL_MS = 60 * 60 * 1000;
  private readonly PATIENT_CACHE_MAX = 500;
  // Render free tier met ~20-30 s à "réveiller" Accueil après une inactivité :
  // un timeout de 8 s coupait tous les appels pendant le cold start.
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
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(this.ACCUEIL_TIMEOUT_MS),
      });
      if (!res.ok) {
        // 429 = rate limit d'Accueil : un log par fenêtre de cache suffit,
        // le backoff (TTL long sur échec) évite de re-marteler le service.
        console.warn(`Accueil getPatient ${res.status}:`, url);
        this.setPatientCache(key, null);
        return null;
      }
      const data = await res.json();
      this.setPatientCache(key, data);
      return data;
    } catch (e) {
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

  async getPatientsByChu(chuId: string): Promise<any[]> {
    if (!chuId) return [];
    try {
      const url = `${ACCUEIL_BASE_URL}/accueil/patients`
        + `?chuId=${encodeURIComponent(chuId)}`;
      const res = await fetch(url, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(this.ACCUEIL_TIMEOUT_MS),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('Accueil getPatientsByChu erreur:', e);
      return [];
    }
  }

  /** POST /accueil/patients/register — enregistrer un nouveau patient (Étape 1). */
  async registerPatient(dto: Record<string, any>): Promise<any | null> {
    if (!dto || typeof dto !== 'object') return null;
    try {
      const url = `${ACCUEIL_BASE_URL}/accueil/patients/register`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.buildHeaders() },
        body: JSON.stringify(dto),
        signal: AbortSignal.timeout(this.ACCUEIL_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(`Accueil registerPatient ${res.status}:`, url);
        return null;
      }
      return await res.json();
    } catch (e) {
      console.warn('Accueil registerPatient erreur:', e);
      return null;
    }
  }

  /** PATCH /accueil/patients/{id}?chuId= — modifier un patient (champs optionnels). */
  async updatePatient(
    id: string,
    chuId: string,
    dto: Record<string, any>,
  ): Promise<any | null> {
    if (!id || !chuId) return null;
    try {
      const url = `${ACCUEIL_BASE_URL}/accueil/patients/`
        + `${encodeURIComponent(id)}?chuId=${encodeURIComponent(chuId)}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...this.buildHeaders() },
        body: JSON.stringify(dto ?? {}),
        signal: AbortSignal.timeout(this.ACCUEIL_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(`Accueil updatePatient ${res.status}:`, url);
        return null;
      }
      return await res.json();
    } catch (e) {
      console.warn('Accueil updatePatient erreur:', e);
      return null;
    }
  }

  /** GET /accueil/patients/{id}/allergie?chuId= — renvoie la valeur d'allergie. */
  async getAllergie(id: string, chuId: string): Promise<string | null> {
    if (!id || !chuId) return null;
    try {
      const url = `${ACCUEIL_BASE_URL}/accueil/patients/`
        + `${encodeURIComponent(id)}/allergie?chuId=${encodeURIComponent(chuId)}`;
      const res = await fetch(url, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(this.ACCUEIL_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(`Accueil getAllergie ${res.status}:`, url);
        return null;
      }
      const data = await res.json();
      return typeof data?.allergie === 'string' ? data.allergie : null;
    } catch (e) {
      console.warn('Accueil getAllergie erreur:', e);
      return null;
    }
  }

  /** PATCH /accueil/patients/{id}/allergie?chuId= — mettre à jour l'allergie. */
  async updateAllergie(
    id: string,
    chuId: string,
    allergie: string,
  ): Promise<any | null> {
    if (!id || !chuId) return null;
    try {
      const url = `${ACCUEIL_BASE_URL}/accueil/patients/`
        + `${encodeURIComponent(id)}/allergie?chuId=${encodeURIComponent(chuId)}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...this.buildHeaders() },
        body: JSON.stringify({ allergie }),
        signal: AbortSignal.timeout(this.ACCUEIL_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(`Accueil updateAllergie ${res.status}:`, url);
        return null;
      }
      return await res.json();
    } catch (e) {
      console.warn('Accueil updateAllergie erreur:', e);
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
