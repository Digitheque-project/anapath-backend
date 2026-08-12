import { IsOptional, IsString } from 'class-validator';

export class UpdateExamenTechniqueDto {
  /** Compte rendu d'examen technique — champ libre, requis avant validation. */
  @IsOptional()
  @IsString()
  compteRendu?: string;
}
