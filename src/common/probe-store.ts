// Magasin mémoire TEMPORAIRE des requêtes HTTP entrantes : sert à capturer le
// contrat exact (chemin + query) que l'agrégateur dossier-patient demande au
// backend anapath. À retirer une fois l'intégration confirmée.

export interface ProbeEntry {
  ts: string;
  method: string;
  url: string;
  userAgent?: string;
}

const MAX_ENTRIES = 500;

const store: { entries: ProbeEntry[] } = { entries: [] };

export function recordProbe(entry: ProbeEntry): void {
  store.entries.push(entry);
  if (store.entries.length > MAX_ENTRIES) {
    store.entries.splice(0, store.entries.length - MAX_ENTRIES);
  }
}

export function getProbes(): ProbeEntry[] {
  return [...store.entries].reverse();
}
