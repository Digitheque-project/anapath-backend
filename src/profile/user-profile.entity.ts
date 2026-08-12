import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/** Profil local anapath d'un utilisateur (bio + réf. photo). Une ligne par userId. */
@Entity('user_profiles')
export class UserProfile {
  @PrimaryColumn()
  userId: string;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  /** Nom du fichier de la photo dans le service d'upload (pas le binaire). */
  @Column({ type: 'varchar', nullable: true })
  avatarFilename: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
