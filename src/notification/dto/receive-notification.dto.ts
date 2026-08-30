import { IsString, IsOptional, IsEnum, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum NotificationType {
  STAT_ALERT = 'STAT_ALERT',
  EN_ATTENTE_VALIDATION = 'EN_ATTENTE_VALIDATION',
  VALIDATION = 'VALIDATION',
  URGENT = 'URGENT',
  INFO = 'INFO',
  RAPPORT_HEBDOMADAIRE = 'RAPPORT_HEBDOMADAIRE',
  RAPPEL_VALIDATION = 'RAPPEL_VALIDATION',
  NOUVELLE_PRESCRIPTION = 'NOUVELLE_PRESCRIPTION',
  // Examen technique validé par le technicien — le pathologiste est notifié
  // qu'un examen est prêt pour l'examen demandé (le vrai examen).
  EXAMEN_TECHNIQUE_TERMINE = 'EXAMEN_TECHNIQUE_TERMINE',
  // Diagnostic cytoponction validé par le pathologiste — le technicien est
  // notifié qu'un patient est prêt pour passer un examen technique.
  PATIENT_PRET_EXAMEN_TECHNIQUE = 'PATIENT_PRET_EXAMEN_TECHNIQUE',
}

export class ReceiveNotificationDto {
  @ApiProperty({ enum: NotificationType, example: 'STAT_ALERT' })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty({ example: '🚨 ALERTE STAT' })
  @IsString()
  title: string;

  @ApiProperty({ example: 'Examen extemporané urgent - délai 30 minutes' })
  @IsString()
  message: string;

  @ApiProperty({ example: 'high', enum: ['high', 'medium', 'low'], required: false })
  @IsString()
  @IsOptional()
  priority?: 'high' | 'medium' | 'low';

  @ApiProperty({ example: 'service-notification', required: false })
  @IsString()
  @IsOptional()
  source?: string;

  @ApiProperty({ example: { anapathId: 'ANP-2026-12345' }, required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @ApiProperty({ example: '2026-06-01T19:02:21.027Z', required: false })
  @IsString()
  @IsOptional()
  timestamp?: string;
}