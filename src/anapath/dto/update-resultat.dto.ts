import { IsOptional, IsString } from 'class-validator';

export class UpdateResultatDto {
  @IsOptional()
  @IsString()
  resultatDetails?: string;

  @IsOptional()
  @IsString()
  resultatConclusion?: string;
}
