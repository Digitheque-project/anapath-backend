import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { recordProbe } from './probe-store';

// TEMPORAIRE : enregistre chaque requête (y compris celles qui finiront en
// 404) pour découvrir les chemins que l'agrégateur dossier-patient sonde.
@Injectable()
export class ProbeRecorderMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    recordProbe({
      ts: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl,
      userAgent: req.headers?.['user-agent'],
    });
    next();
  }
}
