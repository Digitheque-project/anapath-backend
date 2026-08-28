import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AnapathService } from './anapath.service';

/**
 * Alias « racine » du contrat Résultats paracliniques : l'agrégateur
 * dossier-patient interroge chaque service source sur un chemin qui n'est pas
 * documenté publiquement. On expose donc le même handler sous plusieurs chemins
 * candidats afin que la découverte se fasse quel que soit le format attendu.
 */
@ApiTags('Résultats paracliniques')
@Controller()
export class ResultatsParacliniquesController {
  constructor(private readonly anapathService: AnapathService) {}

  @ApiOperation({ summary: 'Résultats paracliniques anapath d’un patient' })
  @ApiParam({ name: 'patientId', required: true })
  @ApiQuery({ name: 'chuId', required: false })
  @Get(['resultats/patient/:patientId', 'patients/:patientId/resultats'])
  getResultats(
    @Param('patientId') patientId: string,
    @Query('chuId') chuId?: string,
  ) {
    return this.anapathService.getResultatsParacliniquesPatient(patientId, chuId);
  }
}
