import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnapathService } from './anapath.service';
import { AnapathRequest } from './entities/anapath-request.entity';
import { ReportSettings } from './entities/report-settings.entity';
import { PrescriptionClient } from '../common/clients/prescription.client';
import { NotificationService } from '../notification/notification.service';
import { AuthServiceTokenService } from '../common/clients/auth-service-token.service';
import { ChuClient } from '../common/clients/chu.client';
import { ServiceServiceClient } from '../common/clients/service.client';
import { AccueilClient } from '../common/clients/accueil.client';

describe('AnapathService', () => {
  let service: AnapathService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnapathService,
        { provide: getRepositoryToken(AnapathRequest), useValue: {} },
        { provide: getRepositoryToken(ReportSettings), useValue: {} },
        { provide: PrescriptionClient, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: AuthServiceTokenService, useValue: {} },
        { provide: ChuClient, useValue: {} },
        { provide: ServiceServiceClient, useValue: {} },
        { provide: AccueilClient, useValue: {} },
      ],
    }).compile();

    service = module.get<AnapathService>(AnapathService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
