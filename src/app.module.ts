import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AnapathModule } from './anapath/anapath.module';
import { NotificationModule } from './notification/notification.module';
import { ProfileModule } from './profile/profile.module';
import { AnapathRequest } from './anapath/entities/anapath-request.entity';
import { NotificationEntity } from './notification/notification.entity';
import { AuthClient } from './auth/clients/auth.client';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    JwtModule.register({}),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.get<string>('DATABASE_URL');
        return {
          type: 'postgres',
          ...(databaseUrl
            ? { url: databaseUrl }
            : {
                host: config.get<string>('DB_HOST'),
                port: parseInt(config.get<string>('DB_PORT') ?? '5432', 10),
                username: config.get<string>('DB_USER'),
                password: config.get<string>('DB_PASSWORD'),
                database: config.get<string>('DB_NAME'),
              }),
          entities: [AnapathRequest, NotificationEntity],
          // Inclut aussi les entités enregistrées via forFeature (ReportSettings,
          // UserProfile…) — sinon « No metadata » / table non créée → 500.
          autoLoadEntities: true,
          synchronize: true,
          ssl: { rejectUnauthorized: false },
        };
      },
      inject: [ConfigService],
    }),
    // ProfileModule AVANT AnapathModule : sinon la route statique GET/PATCH
    // /anapath/profile est captée par @Get(':id')/@Patch(':id') de
    // l'AnapathController → id="profile" → "invalid input syntax for type
    // uuid" → 500. L'ordre d'import définit l'ordre d'enregistrement des routes.
    ProfileModule,
    AnapathModule,
    NotificationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AuthClient,
    JwtAuthGuard,
    PermissionsGuard,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}