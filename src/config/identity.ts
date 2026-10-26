import { createHmac } from 'crypto';

/**
 * Passerelle unique du CHU : users, services, CHU, accueil, prescriptions,
 * notification, upload et dossier patient passent tous par elle. Une seule
 * variable d'environnement, GATEWAY_URL — aucune adresse de repli dans le code.
 */
export function gatewayUrl(path = ''): string {
  return `${(process.env.GATEWAY_URL ?? '').trim().replace(/\/+$/, '')}${path}`;
}

const sansAccents = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function jetonDeService(secret: string): string {
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ userId: 'bootstrap-anapath', role: 'SERVICE', iat: now, exp: now + 60 });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/**
 * Identifiant du service Anapath, lu au démarrage dans le registre des services
 * par son nom (« Anatomie pathologique (Anapath) » par défaut, réglable par
 * SERVICE_DISPLAY_NAME) — plus d'identifiant écrit dans le code.
 * ANAPATH_SERVICE_ID / AUTH_ANAPATH_SERVICE_ID, s'ils sont définis, restent
 * prioritaires. À appeler AVANT de charger AppModule : plusieurs fichiers lisent
 * ces variables dès leur chargement.
 */
export async function resolveAnapathIdentity(): Promise<void> {
  if (!process.env.GATEWAY_URL) {
    throw new Error('GATEWAY_URL non configurée : le service Anapath ne peut joindre aucun autre service.');
  }
  if (process.env.ANAPATH_SERVICE_ID && process.env.AUTH_ANAPATH_SERVICE_ID) return;
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.warn('[identité] JWT_SECRET manquant : ANAPATH_SERVICE_ID à fournir.');
    return;
  }
  const nom = sansAccents(process.env.SERVICE_DISPLAY_NAME || 'Anatomie pathologique (Anapath)');
  for (let tentative = 1; tentative <= 5; tentative++) {
    try {
      const res = await fetch(gatewayUrl('/services'), {
        headers: { Authorization: `Bearer ${jetonDeService(secret)}` },
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const services = (await res.json()) as Array<{ id?: string; name?: string; chuId?: string }>;
      const svc = services.find((s) => sansAccents(s.name ?? '') === nom);
      if (!svc?.id) {
        console.warn(`[identité] Service « ${nom} » absent du registre.`);
        return;
      }
      process.env.ANAPATH_SERVICE_ID ||= svc.id;
      process.env.AUTH_ANAPATH_SERVICE_ID ||= svc.id;
      console.log(`[identité] Service Anapath ${process.env.ANAPATH_SERVICE_ID}`);
      return;
    } catch (e) {
      console.warn(`[identité] Registre injoignable (tentative ${tentative}/5) : ${e instanceof Error ? e.message : e}`);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}
