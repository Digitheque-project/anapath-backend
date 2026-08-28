import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { getProbes } from '../common/probe-store';

// TEMPORAIRE : lecture des requêtes captées par ProbeRecorderMiddleware,
// pour identifier le contrat attendu par l'agrégateur dossier-patient.
@ApiTags('debug')
@Controller('debug')
export class DebugController {
  @Public()
  @Get('probes')
  probes() {
    const entries = getProbes();
    return { count: entries.length, entries };
  }
}
