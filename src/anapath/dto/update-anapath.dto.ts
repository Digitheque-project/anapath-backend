import { IsEnum, IsString, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Statut } from '../entities/anapath-request.entity';

class ResultatDto {
  @IsString()
  conclusion: string;

  @IsString()
  details: string;

  @IsOptional()
  @IsString({ each: true })
  imageUrls?: string[];
}

class PrelevementDto {
  @IsOptional()
  @IsString()
  site?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Object)
  clinicalData?: Record<string, any>;
}

export class UpdateAnapathDto {
  @IsOptional()
  @IsEnum(Statut)
  statut?: Statut;

  @IsOptional()
  @ValidateNested()
  @Type(() => ResultatDto)
  resultat?: ResultatDto;

  @IsOptional()
  @IsString()
  resultatDetails?: string;

  @IsOptional()
  @IsString()
  resultatConclusion?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  conclusion?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PrelevementDto)
  prelevement?: PrelevementDto;

  @IsOptional()
  @IsString()
  motifAnnulation?: string;

  @IsOptional()
  @IsString()
  signature?: string;

  @IsOptional()
  @IsString()
  numeroOrdre?: string;

  @IsOptional()
  @IsString()
  hash?: string;
}