import { IsEnum, IsString, IsOptional, IsBoolean, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ExamenType } from '../entities/anapath-request.entity';

class PrelevementDto {
  @ApiProperty({ example: 'Foie', description: 'Site du prélèvement' })
  @IsString()
  site: string;

  @ApiProperty({ example: '3 fragments', description: 'Description du prélèvement' })
  @IsString()
  description: string;
}

export class CreateAnapathDto {
  @ApiProperty({ example: 'P12345', description: 'Identifiant du patient' })
  @IsString()
  patientId: string;

  @ApiProperty({ required: false, example: 'EP-001', description: 'Identifiant de l\'épisode' })
  @IsOptional()
  @IsString()
  episodeId?: string;

  @ApiProperty({ required: false, example: 'PR-001', description: 'Identifiant de la prescription' })
  @IsOptional()
  @IsString()
  prescriptionId?: string;

  @ApiProperty({ enum: ExamenType, example: 'BIOPSIE', description: 'Type d\'examen' })
  @IsEnum(ExamenType)
  typeExamen: ExamenType;

  @ApiProperty({ required: false, default: false, description: 'Examen extemporané STAT' })
  @IsBoolean()
  @IsOptional()
  isExtemporane?: boolean;

  @ApiProperty({ type: PrelevementDto, description: 'Informations sur le prélèvement' })
  @ValidateNested()
  @Type(() => PrelevementDto)
  prelevement: PrelevementDto;

  @ApiProperty({ required: false, description: 'Métadonnées enrichies (CHU, service, urgence)' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiProperty({ required: false, description: 'Informations patient enrichies depuis Accueil' })
  @IsOptional()
  @IsObject()
  patientInfo?: Record<string, unknown>;
}