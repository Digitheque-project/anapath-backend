import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { UserProfile } from './user-profile.entity';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { FilesController } from './files.controller';
import { UploadClient } from '../common/clients/upload.client';
import { UserServiceClient } from '../common/clients/user-service.client';

@Module({
  imports: [TypeOrmModule.forFeature([UserProfile]), JwtModule.register({})],
  controllers: [ProfileController, FilesController],
  providers: [ProfileService, UploadClient, UserServiceClient],
})
export class ProfileModule {}
