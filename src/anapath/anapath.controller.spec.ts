import { Test, TestingModule } from '@nestjs/testing';
import { AnapathController } from './anapath.controller';
import { AnapathService } from './anapath.service';
import { ChuClient } from '../common/clients/chu.client';
import { AccueilClient } from '../common/clients/accueil.client';
import { NotificationClient } from '../common/clients/notification.client';
import { NotificationService } from '../notification/notification.service';
import { PrescriptionTokenMonitorService } from '../common/clients/prescription-token-monitor.service';

describe('AnapathController', () => {
  let controller: AnapathController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnapathController],
      providers: [
        { provide: AnapathService, useValue: {} },
        { provide: ChuClient, useValue: {} },
        { provide: AccueilClient, useValue: {} },
        { provide: NotificationClient, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: PrescriptionTokenMonitorService, useValue: {} },
      ],
    }).compile();

    controller = module.get<AnapathController>(AnapathController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
