/**
 * Origines CORS autorisées pour l'API REST et la Gateway WebSocket temps réel.
 * Même liste dans les deux cas : CORS_ORIGINS (env) + localhost en dev.
 */
export function getCorsOrigins(): string[] {
  const configured = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : [];
  return [
    ...new Set([
      ...configured,
      'http://localhost:3031',
      'http://127.0.0.1:3031',
    ]),
  ].filter(Boolean);
}
