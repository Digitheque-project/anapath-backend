import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/** Ligne unique (id='default') de préférences liées aux rapports du service. */
@Entity('report_settings')
export class ReportSettings {
  @PrimaryColumn({ default: 'default' })
  id: string;

  @Column({ default: false })
  autoWeeklyReportEnabled: boolean;

  @UpdateDateColumn()
  updatedAt: Date;
}
