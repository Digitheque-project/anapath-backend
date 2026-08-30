import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ExamenType {
  FCV_PAP = 'FCV_PAP',
  CYT0PONCTION = 'CYT0PONCTION',
  LIQUIDE = 'LIQUIDE',
  BIOPSIE = 'BIOPSIE',
  EXTEMPORANE_STAT = 'EXTEMPORANE_STAT',
  POS = 'POS',
  POC = 'POC',
}

export enum Statut {
  CREEE = 'CREEE',
  EN_ATTENTE = 'EN_ATTENTE',
  EN_COURS = 'EN_COURS',
  // Cytoponction uniquement : après acceptation par le technicien, la demande
  // va directement chez le pathologiste (avant l'examen technique) pour le
  // diagnostic (site prélevé, organe, fixation). La validation du diagnostic
  // bascule en EN_COURS et notifie le technicien.
  EN_ATTENTE_DIAGNOSTIC = 'EN_ATTENTE_DIAGNOSTIC',
  // Examen technique validé par le technicien/histotechnicien — prêt pour le
  // pathologiste (onglet « Suivre l'examen » du fil de travail pathologiste).
  EN_ATTENTE_PATHOLOGUE = 'EN_ATTENTE_PATHOLOGUE',
  // Compte-rendu saisi (secrétaire/pathologiste) mais PAS encore validé —
  // distinct de VALIDE (validation finale avec signature).
  EN_ATTENTE_VALIDATION = 'EN_ATTENTE_VALIDATION',
  VALIDE = 'VALIDE',
  ARCHIVE = 'ARCHIVE',
  ANNULEE = 'ANNULEE',
}

@Entity('anapath_requests')
export class AnapathRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Index()
  anapathId: string;

  @Column()
  @Index()
  patientId: string;

  @Column({ nullable: true })
  episodeId: string;

  @Column({ nullable: true })
  @Index()
  prescriptionId: string;

  // ID de la demande individuelle côté service Prescription externe — nécessaire
  // pour propager un changement de statut local vers PATCH /prescriptions/anapath/{prescriptionId}/demandes/{demandeId}/statut.
  @Column({ nullable: true, unique: true })
  @Index()
  demandeId: string;

  @Column({ type: 'enum', enum: ExamenType })
  typeExamen: ExamenType;

  @Column({ default: false })
  isExtemporane: boolean;

  @Column({ type: 'timestamp', nullable: true })
  extemporaneDeadline: Date;

  @Column({ type: 'timestamp', nullable: true })
  extemporaneAlertSentAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  patientInfo: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  prelevement: object;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  resultat: object;

  // Examen au spéculum — préalable obligatoire au résultat pour un FCV/Pap test.
  @Column({ type: 'jsonb', nullable: true })
  examenSpeculum: Record<string, unknown> | null;

  // Compte rendu d'examen technique — rempli et validé par le technicien
  // (ou histotechnicien) ; la validation bascule la demande en EN_ATTENTE_PATHOLOGUE.
  @Column({ type: 'jsonb', nullable: true })
  examenTechnique: Record<string, unknown> | null;

  // Diagnostic cytoponction — rempli et validé par le pathologiste avant
  // l'examen technique (site prélevé, organe, fixation). Lecture seule ensuite.
  @Column({ type: 'jsonb', nullable: true })
  diagnosticCytoponction: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  resultatDetails: string;

  @Column({ type: 'text', nullable: true })
  resultatConclusion: string;

  @Column({ type: 'enum', enum: Statut, default: Statut.CREEE })
  statut: Statut;

  @Column({ nullable: true })
  validatedBySignature: string;

  @Column({ nullable: true })
  validatedByUserId: string;

  // Nom réel de l'utilisateur ayant validé (compte pathologiste) — l'ID
  // stocké dans validatedByUserId est en fait le numéro d'ordre saisi.
  @Column({ type: 'text', nullable: true })
  validatedByName: string | null;

  @Column({ type: 'timestamp', nullable: true })
  validatedAt: Date;

  @Column({ nullable: true })
  validationHash: string;

  @Column({ nullable: true })
  signedHash: string;

  @Column({ nullable: true })
  motifAnnulation: string;

  @Column({ default: false })
  notificationLue: boolean;

  @Column({ type: 'timestamp', nullable: true })
  notificationLueAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  derniereRelanceAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}