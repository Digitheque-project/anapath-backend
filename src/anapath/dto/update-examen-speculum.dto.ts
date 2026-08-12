import { IsOptional, IsString } from 'class-validator';

export class UpdateExamenSpeculumDto {
  @IsOptional()
  @IsString()
  observations?: string;

  /** Prélèvement — champ libre (plus de liste de choix). */
  @IsOptional()
  @IsString()
  prelevementDetails?: string;

  @IsOptional()
  @IsString()
  dateExamen?: string;

  /** Fixation — champ libre (plus de liste de choix). */
  @IsOptional()
  @IsString()
  fixation?: string;
}
