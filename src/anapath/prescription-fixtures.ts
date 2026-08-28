/**
 * Fixtures issues des payloads RÉELS renvoyés par GET /prescriptions/anapath
 * (service Prescription de production, pull du 2026-08-14) — utilisées pour
 * verrouiller la fidélité de la réception (aucun champ perdu ni mal mappé).
 */
export type AnyObj = Record<string, any>;

export interface Fixture {
  prescription: AnyObj;
  demande: AnyObj;
  /** Site anatomique attendu pour ce type après mapping. */
  expectedSite: string;
  /** Suspicions attendues (bio*). */
  expectedSuspicion: string;
}

export const FCV_PAP_FIXTURE: Fixture = {
  prescription: {
    id: 'a67896c4-8d89-4e62-b36a-7471da51a5e0',
    patientId: '6794e265-9232-42f2-896c-1ac62e851084',
    prescripteurId: 'onm',
    urgence: 'NORMAL',
    alertes: '',
    renseignements: '',
    nomMedecinPrescripteur: 'doc',
    numeroONM: 'onm',
    chuId: '1e5bbbb7-fa10-4d59-8848-2d0ce96a9394',
    serviceIdSource: '9e73904c-71e5-4477-9280-513e4112a468',
    serviceIdDest: '9e73904c-71e5-4477-9280-513e4112a468',
  },
  demande: {
    id: 'af55f6fc-adb4-471c-a4ca-5899a17f1e1b',
    typeExamen: 'FCV_PAP',
    data: {
      ddr: '',
      gpa: '',
      note: '',
      details: {},
      service: '',
      etat_col: '',
      papResultat: '',
      renseignementsCliniques: 'teste',
    },
  },
  expectedSite: '',
  expectedSuspicion: '',
};

export const CYT0PONCTION_FIXTURE: Fixture = {
  prescription: {
    id: '44b9b117-3c3e-4b39-8a0f-4d7723643790',
    patientId: 'd972de29-e7eb-4da5-a66f-a35340f5b570',
    prescripteurId: '4d70d437-2d59-4c9c-be15-7d91004fd600',
    urgence: 'TRES_URGENT',
    alertes: '',
    renseignements: null,
    nomMedecinPrescripteur: 'Chef Chirurgie',
    numeroONM: '',
    chuId: '1e5bbbb7-fa10-4d59-8848-2d0ce96a9394',
    serviceIdSource: '7ca23205-820f-4f66-abec-59c8d2a6e878',
    serviceIdDest: '9e73904c-71e5-4477-9280-513e4112a468',
  },
  demande: {
    id: '0c9e31e8-0a33-48b8-ae3c-e83a2299b294',
    typeExamen: 'CYT0PONCTION',
    data: {
      details: {
        bioFaitLe: '2026-08-12',
        cytoNotes: 'Note',
        cytoSiege: 'Test siège',
        cytoOrgane: 'Test organe',
        fcvMenarche: '26',
        bioDatePrelev: '2026-08-12',
        extDatePrevue: '2026-08-12',
      },
      renseignementsCliniques: 'RC',
    },
  },
  expectedSite: 'Test siège',
  expectedSuspicion: '',
};

export const LIQUIDE_FIXTURE: Fixture = {
  prescription: {
    id: '44b9b117-3c3e-4b39-8a0f-4d7723643790',
    patientId: 'd972de29-e7eb-4da5-a66f-a35340f5b570',
    prescripteurId: '4d70d437-2d59-4c9c-be15-7d91004fd600',
    urgence: 'TRES_URGENT',
    alertes: '',
    renseignements: null,
    nomMedecinPrescripteur: 'Chef Chirurgie',
    numeroONM: '',
    chuId: '1e5bbbb7-fa10-4d59-8848-2d0ce96a9394',
    serviceIdSource: '7ca23205-820f-4f66-abec-59c8d2a6e878',
    serviceIdDest: '9e73904c-71e5-4477-9280-513e4112a468',
  },
  demande: {
    id: '1189e3ad-19db-41a9-8230-1f693418d18e',
    typeExamen: 'LIQUIDE',
    data: {
      details: {
        liqNat: 'Ascite',
        liqNotes: '5cc',
        bioFaitLe: '2026-08-12',
        fcvMenarche: '26',
        bioDatePrelev: '2026-08-12',
        extDatePrevue: '2026-08-12',
      },
      renseignementsCliniques: 'RC',
    },
  },
  // Le prélèvement d'un LIQUIDE est sa nature (liqNat).
  expectedSite: 'Ascite',
  expectedSuspicion: '',
};

export const BIOPSIE_FIXTURE: Fixture = {
  prescription: {
    id: '44b9b117-3c3e-4b39-8a0f-4d7723643790',
    patientId: 'd972de29-e7eb-4da5-a66f-a35340f5b570',
    prescripteurId: '4d70d437-2d59-4c9c-be15-7d91004fd600',
    urgence: 'TRES_URGENT',
    alertes: '',
    renseignements: null,
    nomMedecinPrescripteur: 'Chef Chirurgie',
    numeroONM: '',
    chuId: '1e5bbbb7-fa10-4d59-8848-2d0ce96a9394',
    serviceIdSource: '7ca23205-820f-4f66-abec-59c8d2a6e878',
    serviceIdDest: '9e73904c-71e5-4477-9280-513e4112a468',
  },
  demande: {
    id: 'a5a8280a-0729-43e9-a133-ae822e5460b6',
    typeExamen: 'BIOPSIE',
    data: {
      details: {
        bioFaitLe: '2026-08-12',
        bioNature: 'Biopsie',
        bioOrgane: 'Test organe',
        bioFixateur: 'Formol 10%',
        fcvMenarche: '26',
        bioSuspicion: 'Suspicion',
        bioDatePrelev: '2026-08-11',
        extDatePrevue: '2026-08-12',
      },
      renseignementsCliniques: 'RC',
    },
  },
  expectedSite: 'Test organe',
  expectedSuspicion: 'Suspicion',
};

export const POS_FIXTURE: Fixture = {
  prescription: {
    id: '44b9b117-3c3e-4b39-8a0f-4d7723643790',
    patientId: 'd972de29-e7eb-4da5-a66f-a35340f5b570',
    prescripteurId: '4d70d437-2d59-4c9c-be15-7d91004fd600',
    urgence: 'TRES_URGENT',
    alertes: '',
    renseignements: null,
    nomMedecinPrescripteur: 'Chef Chirurgie',
    numeroONM: '',
    chuId: '1e5bbbb7-fa10-4d59-8848-2d0ce96a9394',
    serviceIdSource: '7ca23205-820f-4f66-abec-59c8d2a6e878',
    serviceIdDest: '9e73904c-71e5-4477-9280-513e4112a468',
  },
  demande: {
    id: 'd96b9e2d-3d8c-4c6f-9925-3d9288b93059',
    typeExamen: 'POS',
    data: {
      details: {
        bioFaitLe: '2026-08-12',
        bioNature: 'Exérèse',
        bioOrgane: 'Test organe',
        bioFixateur: 'Autre',
        fcvMenarche: '26',
        bioSuspicion: 'Suspicion',
        bioDatePrelev: '2026-08-11',
        extDatePrevue: '2026-08-12',
      },
      renseignementsCliniques: 'RC',
    },
  },
  expectedSite: 'Test organe',
  expectedSuspicion: 'Suspicion',
};

export const POC_FIXTURE: Fixture = {
  prescription: {
    id: '28afd86b-a3f7-41a6-82df-bf3ce568d526',
    patientId: '827ba074-39f1-4402-aab0-f9b78fde2c09',
    prescripteurId: '4d70d437-2d59-4c9c-be15-7d91004fd600',
    urgence: 'TRES_URGENT',
    alertes: '',
    renseignements: null,
    nomMedecinPrescripteur: 'Chef Chirurgie',
    numeroONM: '',
    chuId: '1e5bbbb7-fa10-4d59-8848-2d0ce96a9394',
    serviceIdSource: '7ca23205-820f-4f66-abec-59c8d2a6e878',
    serviceIdDest: '9e73904c-71e5-4477-9280-513e4112a468',
  },
  demande: {
    id: '2d6215e7-a241-494e-a276-cceffa1fa5bb',
    typeExamen: 'POC',
    data: {
      details: {
        bioFaitLe: '2026-08-09',
        bioNature: 'Biopsie',
        bioOrgane: 'test',
        fcvMenarche: '61',
        bioDatePrelev: '2026-08-09',
        extDatePrevue: '2026-08-09',
      },
      renseignementsCliniques: 'test',
    },
  },
  expectedSite: 'test',
  expectedSuspicion: '',
};

export const EXTEMPORANE_FIXTURE: Fixture = {
  prescription: {
    id: '44b9b117-3c3e-4b39-8a0f-4d7723643790',
    patientId: 'd972de29-e7eb-4da5-a66f-a35340f5b570',
    prescripteurId: '4d70d437-2d59-4c9c-be15-7d91004fd600',
    urgence: 'TRES_URGENT',
    alertes: '',
    renseignements: null,
    nomMedecinPrescripteur: 'Chef Chirurgie',
    numeroONM: '',
    chuId: '1e5bbbb7-fa10-4d59-8848-2d0ce96a9394',
    serviceIdSource: '7ca23205-820f-4f66-abec-59c8d2a6e878',
    serviceIdDest: '9e73904c-71e5-4477-9280-513e4112a468',
  },
  demande: {
    id: 'e2e89534-482a-4f87-84bf-1978ae02176f',
    typeExamen: 'EXTEMPORANE_STAT',
    data: {
      details: {
        extHeure: '22:18',
        bioFaitLe: '2026-08-12',
        extNature: 'test',
        extOrgane: 'test',
        extQuestion: 'test',
        fcvMenarche: '26',
        bioDatePrelev: '2026-08-12',
        extChirurgien: 'Dr Test',
        extDatePrevue: '2026-08-12',
        extIntervention: 'Test',
      },
      renseignementsCliniques: 'RC',
    },
  },
  expectedSite: 'test',
  expectedSuspicion: '',
};

/** Demande réelle sans payload data (présente en production) : ne doit pas casser la chaîne. */
export const DATA_ABSENT_FIXTURE: Fixture = {
  prescription: {
    id: '940f430a-ce97-49f0-ae72-39e3404cfd20',
    patientId: 'd972de29-e7eb-4da5-a66f-a35340f5b570',
    prescripteurId: '4d70d437-2d59-4c9c-be15-7d91004fd600',
    urgence: 'NORMAL',
    alertes: '',
    renseignements: null,
    nomMedecinPrescripteur: null,
    numeroONM: null,
    chuId: '1e5bbbb7-fa10-4d59-8848-2d0ce96a9394',
    serviceIdSource: '7ca23205-820f-4f66-abec-59c8d2a6e878',
    serviceIdDest: '9e73904c-71e5-4477-9280-513e4112a468',
  },
  demande: {
    id: '0db3b872-7590-4920-ac8f-707d902b1fb9',
    typeExamen: 'POC',
    data: null,
  },
  expectedSite: '',
  expectedSuspicion: '',
};

/** Tous les types d'examen, clés du payload réellement reçues. */
export const ALL_TYPES_FIXTURES: { type: string; fixture: Fixture }[] = [
  { type: 'FCV_PAP', fixture: FCV_PAP_FIXTURE },
  { type: 'CYT0PONCTION', fixture: CYT0PONCTION_FIXTURE },
  { type: 'LIQUIDE', fixture: LIQUIDE_FIXTURE },
  { type: 'BIOPSIE', fixture: BIOPSIE_FIXTURE },
  { type: 'POS', fixture: POS_FIXTURE },
  { type: 'POC', fixture: POC_FIXTURE },
  { type: 'EXTEMPORANE_STAT', fixture: EXTEMPORANE_FIXTURE },
];
