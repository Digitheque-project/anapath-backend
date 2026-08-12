import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { NotificationEntity } from './notification.entity';
import { NotificationService } from './notification.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { AuthClient } from '../auth/clients/auth.client';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationEntity]), JwtModule.register({})],
  controllers: [],
  providers: [NotificationService, NotificationsGateway, AuthClient],
  exports: [NotificationService, NotificationsGateway],
})
export class NotificationModule {}
