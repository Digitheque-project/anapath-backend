import { IsOptional, IsString } from 'class-validator';

export class UpdateDiagnosticCytoponctionDto {
  /** Site prélevé — champ libre (ex. « masse cervicale »). */
  @IsOptional()
  @IsString()
  sitePreleve?: string;

  /** Organe concerné — champ libre. */
  @IsOptional()
  @IsString()
  organe?: string;

  /** Type de fixateur utilisé — champ libre. */
  @IsOptional()
  @IsString()
  fixation?: string;
}
