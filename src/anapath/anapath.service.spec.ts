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
import { UserServiceClient } from '../common/clients/user-service.client';
import { DossierPatientClient } from '../common/clients/dossier-patient.client';
import {
  ALL_TYPES_FIXTURES,
  DATA_ABSENT_FIXTURE,
  type Fixture,
} from './prescription-fixtures';

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
        { provide: DossierPatientClient, useValue: {} },
        { provide: UserServiceClient, useValue: {} },
      ],
    }).compile();

    service = module.get<AnapathService>(AnapathService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('réception fidèle des prescriptions (payloads réels)', () => {
    for (const { type, fixture } of ALL_TYPES_FIXTURES) {
      describe(type, () => {
        let metadata: Record<string, any>;
        let request: Partial<AnapathRequest>;

        beforeEach(() => {
          metadata = (service as any).buildPendingMetadata(
            fixture.prescription,
            fixture.demande,
            null,
            null,
            null,
          );
          request = (service as any).buildRequestFromPendingMetadata(metadata);
        });

        it('conserve le typeExamen et l’identité externe', () => {
          expect(request.typeExamen).toBe(type);
          expect(request.prescriptionId).toBe(fixture.prescription.id);
          expect(request.demandeId).toBe(fixture.demande.id);
          expect(request.patientId).toBe(fixture.prescription.patientId);
        });

        it('conserve le payload data tel quel (aucun champ perdu)', () => {
          expect(metadata.data).toEqual(fixture.demande.data ?? {});
          expect((request.metadata as any).rawData).toEqual(fixture.demande.data ?? {});
          const raw = (request.metadata as any).rawData;
          const details = raw?.details ?? {};
          const expectedKeys = Object.keys(fixture.demande.data?.details ?? {});
          for (const key of expectedKeys) {
            expect(details).toHaveProperty(key);
          }
          if (fixture.demande.data?.renseignementsCliniques) {
            expect(raw.renseignementsCliniques).toBe(
              fixture.demande.data.renseignementsCliniques,
            );
          }
        });

        it('conserve les champs de niveau prescription', () => {
          expect(metadata.renseignements).toBe(fixture.prescription.renseignements ?? null);
          expect(metadata.nomMedecinPrescripteur).toBe(
            fixture.prescription.nomMedecinPrescripteur ?? null,
          );
          expect(metadata.numeroONM).toBe(fixture.prescription.numeroONM ?? null);
          expect((request.metadata as any).nomMedecinPrescripteur).toBe(
            fixture.prescription.nomMedecinPrescripteur ?? null,
          );
        });

        it('dérive le site anatomique avec les bonnes clés', () => {
          expect((request.prelevement as any)?.site).toBe(fixture.expectedSite);
        });

        it('dérive le motif depuis les renseignements cliniques', () => {
          const expectedMotif =
            fixture.demande.data?.renseignementsCliniques ??
            fixture.prescription.renseignements ??
            '';
          expect((request.prelevement as any)?.description).toBe(expectedMotif);
        });

        it('dérive la suspicion avec les bonnes clés', () => {
          expect((request.prelevement as any)?.clinicalData?.suspicion ?? '').toBe(
            fixture.expectedSuspicion,
          );
        });

        it('marque correctement l’extemporané', () => {
          expect(request.isExtemporane).toBe(type === 'EXTEMPORANE_STAT');
        });
      });
    }

    describe('demande sans payload data (cas réel)', () => {
      it('ne casse pas et produit des valeurs vides', () => {
        const metadata = (service as any).buildPendingMetadata(
          DATA_ABSENT_FIXTURE.prescription,
          DATA_ABSENT_FIXTURE.demande,
          null,
          null,
          null,
        );
        const request = (service as any).buildRequestFromPendingMetadata(metadata);
        expect((request.metadata as any).rawData).toEqual({});
        expect((request.prelevement as any).site).toBe('');
        expect((request.prelevement as any).description).toBe('');
        expect(request.typeExamen).toBe('POC');
      });
    });
  });
});
