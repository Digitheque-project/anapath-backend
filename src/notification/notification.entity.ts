import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { NotificationType } from './dto/receive-notification.dto';

@Entity('notifications')
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column()
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ default: 'medium' })
  priority: string;

  @Column({ nullable: true })
  source: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ default: false })
  read: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
