import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { AnapathRequest, Statut, ExamenType } from './entities/anapath-request.entity';
import { ReportSettings } from './entities/report-settings.entity';
import { CreateAnapathDto } from './dto/create-anapath.dto';
import { UpdateAnapathDto } from './dto/update-anapath.dto';
import { ValidateAnapathDto } from './dto/validate-anapath.dto';
import { UpdateResultatDto } from './dto/update-resultat.dto';
import { UpdateExamenSpeculumDto } from './dto/update-examen-speculum.dto';
import { UpdateExamenTechniqueDto } from './dto/update-examen-technique.dto';
import { UpdateDiagnosticCytoponctionDto } from './dto/update-diagnostic-cytoponction.dto';
import { UserServiceClient } from '../common/clients/user-service.client';
import { PrescriptionClient, AnapathPrescription, PrescriptionDemande } from '../common/clients/prescription.client';
import { ChuClient } from '../common/clients/chu.client';
import { ServiceServiceClient } from '../common/clients/service.client';
import { AccueilClient } from '../common/clients/accueil.client';
import { DossierPatientClient } from '../common/clients/dossier-patient.client';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/dto/receive-notification.dto';
import { AuthServiceTokenService } from '../common/clients/auth-service-token.service';
import * as crypto from 'crypto';

const ANAPATH_SERVICE_ID =
  process.env.ANAPATH_SERVICE_ID ?? '9e73904c-71e5-4477-9280-513e4112a468';

const TYPE_EXAMEN_LABELS: Record<string, string> = {
  BIOPSIE: 'Biopsie',
  FCV_PAP: 'FCV / Pap test',
  CYT0PONCTION: 'Cytoponction',
  LIQUIDE: 'Liquide',
  EXTEMPORANE_STAT: 'Extemporané',
  POS: 'POS',
  POC: 'POC',
};

export type AnapathRequestResponse = AnapathRequest & {
  resultat: { details: string | null; conclusion: string | null };
  validationHash: string | null;
};

@Injectable()
export class AnapathService {
  /** Cache court (5 min) des services par CHU — évite un appel /services par prescription au pull. */
  private readonly servicesByChu = new Map<string, { at: number; list: any[] }>();
  /** Cache court (5 min) du nom de service par serviceId (résolution directe service-service). */
  private readonly servicesById = new Map<string, { at: number; nom: string | null }>();
  /** Cache court (5 min) du nom de CHU par chuId. */
  private readonly chuNomCache = new Map<string, { at: number; nom: string | null }>();

  constructor(
    @InjectRepository(AnapathRequest)
    private anapathRepository: Repository<AnapathRequest>,
    @InjectRepository(ReportSettings)
    private reportSettingsRepository: Repository<ReportSettings>,
    private readonly prescriptionClient: PrescriptionClient,
    private readonly notificationService: NotificationService,
    private readonly authServiceToken: AuthServiceTokenService,
    private readonly chuClient: ChuClient,
    private readonly serviceServiceClient: ServiceServiceClient,
    private readonly accueilClient: AccueilClient,
    private readonly dossierPatientClient: DossierPatientClient,
    private readonly userServiceClient: UserServiceClient,
  ) {}

  /**
   * Résultats paracliniques anapath d'un patient, au format de la vue unifiée
   * « Résultats paracliniques » du dossier-patient (celle que consomme l'onglet
   * du même nom dans les services du CHU, ex. ORL). Chaque item expose à la
   * fois les noms de champs de la vue unifiée (examen, dateResultat,
   * resultatTexte…) et des alias de compatibilité pour les adaptateurs
   * existants (compteRendu, conclusion, dateExamen…).
   */
  async getResultatsParacliniquesPatient(patientId: string, chuId?: string): Promise<any[]> {
    if (!patientId) return [];
    const examens = await this.anapathRepository.find({
      where: { patientId, statut: In([Statut.VALIDE, Statut.ARCHIVE]) },
    });
    const items = examens
      .filter((e) => !chuId || String((e.metadata as any)?.chuId ?? '') === chuId)
      .map((e) => {
        const meta = (e.metadata ?? {}) as Record<string, unknown>;
        const typeLabel = TYPE_EXAMEN_LABELS[e.typeExamen] ?? e.typeExamen;
        const titre = `Compte-rendu anapath – ${typeLabel}`;
        const dateDemande = (e.createdAt ?? new Date()).toISOString();
        const dateResultat = e.validatedAt ? new Date(e.validatedAt).toISOString() : null;
        const prescripteur =
          (meta.prescripteurNom as string) ?? (meta.nomMedecinPrescripteur as string) ?? '';
        return {
          id: e.id,
          prescriptionId: e.prescriptionId ?? '',
          demandeId: e.demandeId ?? '',
          patientId: e.patientId,
          chuId: (meta.chuId as string) ?? '',
          // Vue unifiée « Résultats paracliniques »
          type: 'anatomopathologie',
          examen: titre,
          dateDemande,
          dateResultat,
          resultatTexte: e.resultatDetails ?? '',
          resultatFichiers: [] as string[],
          prescripteur,
          statut: 'disponible',
          commentaire: e.resultatConclusion ?? '',
          serviceSource: 'Anapath',
          // Alias de compatibilité
          titre,
          examinationType: 'AUTRE',
          dateExamen: dateResultat ?? dateDemande,
          resultats: e.resultatDetails ?? '',
          compteRendu: e.resultatDetails ?? '',
          conclusion: e.resultatConclusion ?? '',
          interpretation: '',
          medecin: prescripteur,
          laboratoire: 'Anapath',
          pieceJointeUrls: [] as string[],
          fichierUrls: [] as string[],
          createdBy: (meta.prescripteurId as string) ?? ANAPATH_SERVICE_ID,
          createdAt: dateDemande,
          updatedAt: dateResultat ?? dateDemande,
        };
      });
    items.sort(
      (a, b) => new Date(b.dateDemande).getTime() - new Date(a.dateDemande).getTime(),
    );
    return items;
  }

  /**
   * Dossier patient complet : tous les examens/comptes-rendus du patient dans
   * le CHU, en fusionnant les DEUX sources du service dossier-patient :
   *  1. les résultats paracliniques agrégés (ECG, imagerie, kiné…)
   *  2. les examens complémentaires (dont les comptes-rendus anapath)
   * Lecture seule : les comptes-rendus anapath sont récupérés par le service
   * dossier-patient via GET /anapath/internal/resultats/patient/:patientId.
   */
  async getDossierPatient(patientId: string, chuId?: string): Promise<{ items: any[]; total: number }> {
    if (!patientId) throw new BadRequestException('patientId requis');
    if (!chuId) throw new BadRequestException('chuId requis');

    const [agreges, complementaires] = await Promise.all([
      this.dossierPatientClient.getPatientAggregatedResults(patientId, chuId),
      this.dossierPatientClient.getPatientExaminations(chuId, patientId),
    ]);

    // Normalisation des résultats agrégés vers la forme d'un examen complémentaire.
    const agregesNormalises = agreges.map((it: any) => ({
      id: it?.id,
      examinationType: String(it?.type ?? '').toUpperCase() || undefined,
      titre: it?.examen ?? 'Résultat paraclinique',
      dateExamen: it?.dateResultat ?? it?.dateDemande ?? null,
      resultats: it?.resultatTexte ?? '',
      conclusion: it?.commentaire ?? '',
      interpretation: '',
      prescripteur: it?.prescripteur ?? '',
      laboratoire: it?.serviceSource ?? '',
      isUrgent: false,
      statut: it?.statut,
    }));

    // Fusion dédupliquée (par id), triée par date décroissante.
    const vus = new Set<string>();
    const items = [...agregesNormalises, ...complementaires].filter((it) => {
      const key = String(it?.id ?? '');
      if (!key || vus.has(key)) return false;
      vus.add(key);
      return true;
    });
    items.sort(
      (a, b) =>
        new Date(b.dateExamen ?? 0).getTime() - new Date(a.dateExamen ?? 0).getTime(),
    );
    return { items, total: items.length };
  }

  /**
   * Propage un changement de statut local vers le service Prescription externe.
   * Jamais bloquant : appelée après un save() réussi, ignore silencieusement
   * (avec un warning) si les IDs externes ou le token sont absents, ou si l'appel échoue.
   * Hypothèse non vérifiée : le service externe accepte les mêmes libellés que l'enum Statut local.
   */
  private async propagerStatutVersPrescription(
    request: AnapathRequest,
    token?: string,
  ): Promise<void> {
    if (!token) {
      console.warn(
        `Propagation statut ignorée pour ${request.anapathId} : pas de token utilisateur disponible`,
      );
      return;
    }
    if (!request.prescriptionId || !request.demandeId) {
      console.warn(
        `Propagation statut ignorée pour ${request.anapathId} : prescriptionId/demandeId externe manquant`,
      );
      return;
    }
    await this.prescriptionClient.updateDemandeStatut(
      token,
      request.prescriptionId,
      request.demandeId,
      request.statut,
      request.statut === Statut.ANNULEE ? request.motifAnnulation : undefined,
    );
  }

  private generateAnapathId(): string {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
    return `ANP-${year}-${random}`;
  }

  private getResultatFromJson(entity: AnapathRequest): {
    details?: string;
    conclusion?: string;
  } | null {
    if (!entity.resultat || typeof entity.resultat !== 'object') return null;
    return entity.resultat as { details?: string; conclusion?: string };
  }

  toResponse(entity: AnapathRequest): AnapathRequestResponse {
    const jsonResultat = this.getResultatFromJson(entity);
    const details =
      entity.resultatDetails ?? jsonResultat?.details ?? null;
    const conclusion =
      entity.resultatConclusion ?? jsonResultat?.conclusion ?? null;

    return {
      ...entity,
      resultat: { details, conclusion },
      validatedBySignature: entity.validatedBySignature ?? null,
      validatedByUserId: entity.validatedByUserId ?? null,
      validatedByName: entity.validatedByName ?? null,
      validationHash: entity.validationHash ?? entity.signedHash ?? null,
      validatedAt: entity.validatedAt ?? null,
    } as AnapathRequestResponse;
  }

  private syncResultatFields(entity: AnapathRequest): void {
    entity.resultat = {
      details: entity.resultatDetails ?? null,
      conclusion: entity.resultatConclusion ?? null,
    };
  }

  /**
   * Notifie le pathologiste que le compte-rendu a été saisi (par la secrétaire)
   * et est prêt à valider. Appelée dès que le statut passe en EN_ATTENTE_VALIDATION
   * (auto-save OU bouton « Enregistrer »). Garde-fou anti-doublon : s'il existe
   * déjà une notification non lue de ce type pour ce même examen (même
   * « saisiPar »), on ne re-notifie pas — évite un spam à chaque auto-save.
   * La cloche affiche déjà le nom du patient, le type d'examen et le service
   * demandeur (enrichis côté controller) ; le message porte donc uniquement le
   * texte demandé + la ligne « Saisi par » pour éviter toute redondance.
   */
  private async notifierSaisieCompteRendu(
    request: AnapathRequest,
    token?: string,
  ): Promise<void> {
    try {
      const saisiPar = await this.userServiceClient.getUserName(token ?? '');
      const info = (request.patientInfo ?? {}) as Record<string, any>;
      const nomPatient =
        this.accueilClient.buildNomComplet(info) ||
        (typeof info.nom === 'string' ? info.nom : '') ||
        request.patientId;

      const existante = await this.notificationService.findActiveByAnapathId(
        request.anapathId,
        NotificationType.EN_ATTENTE_VALIDATION,
        { saisiPar: saisiPar ?? '' },
      );
      if (existante) return;

      await this.notificationService.createNotification({
        type: NotificationType.EN_ATTENTE_VALIDATION,
        title: 'Compte-rendu saisi et prêt à valider',
        message: saisiPar
          ? `Compte-rendu saisi et prêt à valider — Saisi par : ${saisiPar}`
          : 'Compte-rendu saisi et prêt à valider',
        priority: 'medium',
        source: 'Anapath',
        metadata: {
          anapathRequestId: request.id,
          anapathId: request.anapathId,
          patientName: nomPatient,
          typeExamen: request.typeExamen,
          serviceNom: (request.metadata?.serviceNom as string) ?? null,
          saisiPar: saisiPar ?? null,
          // Destinée au pathologiste (masquée pour la secrétaire qui a saisi).
          recipientRole: 'pathologiste',
        },
      });
    } catch (e) {
      console.warn(
        `Notification « compte-rendu saisi » ignorée pour ${request.anapathId}:`,
        e,
      );
    }
  }

  async create(createDto: CreateAnapathDto): Promise<AnapathRequestResponse> {
    const anapathId = this.generateAnapathId();
    const request = this.anapathRepository.create({
      ...createDto,
      anapathId,
      statut: Statut.CREEE,
    });

    if (createDto.isExtemporane) {
      const deadline = new Date();
      deadline.setMinutes(deadline.getMinutes() + 30);
      request.extemporaneDeadline = deadline;
    }

    const saved = await this.anapathRepository.save(request);
    return this.toResponse(saved);
  }

  async findAll(patientId?: string): Promise<AnapathRequestResponse[]> {
    const rows = await this.anapathRepository.find({
      where: patientId ? { patientId } : {},
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => this.toResponse(row));
  }

  async findOne(id: string): Promise<AnapathRequestResponse> {
    const request = await this.anapathRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Demande ${id} non trouvée`);
    return this.toResponse(request);
  }

  async findOneEntity(id: string): Promise<AnapathRequest> {
    const request = await this.anapathRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Demande ${id} non trouvée`);
    return request;
  }

  async findByAnapathId(anapathId: string): Promise<AnapathRequest | null> {
    return this.anapathRepository.findOne({ where: { anapathId } });
  }

  async save(entity: AnapathRequest): Promise<AnapathRequest> {
    return this.anapathRepository.save(entity);
  }

  async update(
    id: string,
    updateDto: UpdateAnapathDto,
    token?: string,
  ): Promise<AnapathRequestResponse> {
    const request = await this.findOneEntity(id);
    const statutAvant = request.statut;

    if (
      updateDto.resultatDetails !== undefined ||
      updateDto.resultat?.details !== undefined ||
      updateDto.description !== undefined
    ) {
      request.resultatDetails =
        updateDto.resultatDetails ??
        updateDto.resultat?.details ??
        updateDto.description ??
        request.resultatDetails;
    }

    if (
      updateDto.resultatConclusion !== undefined ||
      updateDto.resultat?.conclusion !== undefined ||
      updateDto.conclusion !== undefined
    ) {
      request.resultatConclusion =
        updateDto.resultatConclusion ??
        updateDto.resultat?.conclusion ??
        updateDto.conclusion ??
        request.resultatConclusion;
    }

    if (updateDto.statut !== undefined) request.statut = updateDto.statut;
    if (updateDto.prelevement !== undefined) request.prelevement = updateDto.prelevement;
    if (updateDto.motifAnnulation !== undefined) request.motifAnnulation = updateDto.motifAnnulation;

    if (updateDto.signature !== undefined) {
      request.validatedBySignature = updateDto.signature;
    }
    if (updateDto.numeroOrdre !== undefined) {
      request.validatedByUserId = updateDto.numeroOrdre;
    }
    if (updateDto.hash !== undefined) {
      request.validationHash = updateDto.hash;
      request.signedHash = updateDto.hash;
    }
    if (updateDto.statut === Statut.VALIDE) {
      request.validatedAt = new Date();
      // Résolution du nom du validateur (le pathologiste) auprès de
      // user-services. Le front passe par PATCH :id (update) pour la
      // validation finale, pas par POST :id/validate : sans cette résolution
      // validatedByName restait null et la colonne « Validé par » retombait
      // sur le numéro d'ordre (validatedByUserId).
      const validateurNom = await this.userServiceClient.getUserName(token ?? '');
      if (validateurNom) {
        request.validatedByName = validateurNom;
      }
    }

    this.syncResultatFields(request);

    const saved = await this.anapathRepository.save(request);
    if (updateDto.statut !== undefined && updateDto.statut !== statutAvant) {
      await this.propagerStatutVersPrescription(saved, token);
    }
    if (
      saved.statut === Statut.EN_ATTENTE_VALIDATION &&
      statutAvant !== Statut.EN_ATTENTE_VALIDATION &&
      updateDto.statut === Statut.EN_ATTENTE_VALIDATION
    ) {
      await this.notifierSaisieCompteRendu(saved, token);
    }
    return this.toResponse(saved);
  }

  /**
   * Sauvegarde (auto-save) du résultat/conclusion uniquement — permission plus
   * étroite que anapath:update, pour un rôle qui peut saisir un résultat
   * provisoire sans gérer tout le dossier (ex: Interne qualifiant, dont le
   * compte-rendu doit obligatoirement être contresigné par un senior). Ne
   * touche ni au statut de validation finale, ni à la signature, ni à
   * l'annulation : ces actions restent derrière anapath:update / anapath:validate.
   */
  async updateResultat(
    id: string,
    dto: UpdateResultatDto,
    token?: string,
  ): Promise<AnapathRequestResponse> {
    const request = await this.findOneEntity(id);
    const statutAvant = request.statut;

    if (dto.resultatDetails !== undefined) request.resultatDetails = dto.resultatDetails;
    if (dto.resultatConclusion !== undefined) request.resultatConclusion = dto.resultatConclusion;

    const hasContent =
      (request.resultatDetails ?? '').trim() !== '' || (request.resultatConclusion ?? '').trim() !== '';
    if (hasContent && request.statut !== Statut.VALIDE && request.statut !== Statut.ARCHIVE) {
      request.statut = Statut.EN_ATTENTE_VALIDATION;
    }

    this.syncResultatFields(request);

    const saved = await this.anapathRepository.save(request);
    if (saved.statut !== statutAvant) {
      await this.propagerStatutVersPrescription(saved, token);
    }
    if (saved.statut === Statut.EN_ATTENTE_VALIDATION && statutAvant !== Statut.EN_ATTENTE_VALIDATION) {
      await this.notifierSaisieCompteRendu(saved, token);
    }
    return this.toResponse(saved);
  }

  /**
   * Enregistre l'examen au spéculum (préalable obligatoire au résultat pour un FCV/Pap test).
   * Le prescripteur et le préleveur sont renseignés AUTOMATIQUEMENT : le prescripteur est
   * l'auteur de la prescription (résolu via UserService depuis les métadonnées), le préleveur
   * est l'utilisateur courant qui valide l'examen au spéculum (technicien/histotechnicien).
   */
  async updateExamenSpeculum(
    id: string,
    dto: UpdateExamenSpeculumDto,
    token?: string,
  ): Promise<AnapathRequestResponse> {
    const request = await this.findOneEntity(id);
    const metadata = (request.metadata ?? {}) as Record<string, unknown>;
    const prescripteurId =
      typeof metadata.prescripteurId === 'string' ? metadata.prescripteurId : undefined;

    const [prescripteurNom, preleveurNom, preleveurUser] = await Promise.all([
      typeof metadata.prescripteurNom === 'string' && metadata.prescripteurNom.trim()
        ? metadata.prescripteurNom
        : this.userServiceClient.getUserNameById(token ?? '', prescripteurId),
      this.userServiceClient.getUserName(token ?? ''),
      this.userServiceClient.getUser(token ?? ''),
    ]);

    request.examenSpeculum = {
      ...dto,
      prescripteurId: prescripteurId ?? null,
      prescripteurSignature:
        typeof prescripteurNom === 'string' && prescripteurNom.trim()
          ? prescripteurNom.trim()
          : (prescripteurId ?? ''),
      preleveurUserId: preleveurUser?.id ?? preleveurUser?.userId ?? null,
      preleveurSignature: typeof preleveurNom === 'string' ? preleveurNom : '',
      submittedAt: new Date().toISOString(),
    };

    const saved = await this.anapathRepository.save(request);
    return this.toResponse(saved);
  }

  /**
   * Valide l'examen technique (technicien/histotechnicien, ou le pathologiste qui
   * reprend le fil de travail technique) : enregistre le compte rendu libre, bascule
   * la demande en EN_ATTENTE_PATHOLOGUE (fin du travail du technicien) et notifie le
   * pathologiste qu'un examen est prêt pour l'examen demandé.
   */
  async validerExamenTechnique(
    id: string,
    dto: UpdateExamenTechniqueDto,
    token?: string,
  ): Promise<AnapathRequestResponse> {
    const request = await this.findOneEntity(id);
    if (
      request.statut === Statut.VALIDE ||
      request.statut === Statut.ARCHIVE ||
      request.statut === Statut.ANNULEE
    ) {
      throw new BadRequestException('Examen déjà clôturé');
    }
    if (request.statut === Statut.EN_ATTENTE_PATHOLOGUE) {
      throw new BadRequestException('Examen technique déjà validé');
    }
    const compteRendu = (dto.compteRendu ?? '').trim();
    if (!compteRendu) {
      throw new BadRequestException(
        "Compte rendu d'examen technique requis avant validation",
      );
    }
    // FCV / Pap test : l'examen au spéculum est un préalable OBLIGATOIRE avant
    // l'examen technique — le pathologiste ne doit jamais recevoir un prélèvement
    // dont le spéculum n'a pas été validé par le technicien.
    if (request.typeExamen === 'FCV_PAP' && !request.examenSpeculum) {
      throw new BadRequestException(
        "L'examen au spéculum doit être validé avant l'examen technique pour un FCV / Pap test",
      );
    }

    const [technicienNom, technicienUser] = await Promise.all([
      this.userServiceClient.getUserName(token ?? ''),
      this.userServiceClient.getUser(token ?? ''),
    ]);
    request.examenTechnique = {
      compteRendu,
      validatedByUserId: technicienUser?.id ?? technicienUser?.userId ?? null,
      validatedByName: technicienNom ?? null,
      validatedAt: new Date().toISOString(),
    };

    const statutAvant = request.statut;
    request.statut = Statut.EN_ATTENTE_PATHOLOGUE;

    const saved = await this.anapathRepository.save(request);
    if (saved.statut !== statutAvant) {
      await this.propagerStatutVersPrescription(saved, token);
    }
    // Notification destinée au pathologiste : nom du patient, type d'examen et
    // service demandeur, avec le message « Prêt pour passer l'examen ».
    const info = (request.patientInfo ?? {}) as Record<string, any>;
    const nomPatient =
      this.accueilClient.buildNomComplet(info) ||
      (typeof info.nom === 'string' ? info.nom : '') ||
      request.patientId;
    await this.notificationService.createNotification({
      type: NotificationType.EXAMEN_TECHNIQUE_TERMINE,
      title: `Prêt pour passer l'examen — ${nomPatient}`,
      message: 'Patient prêt pour l\'examen',
      priority: 'medium',
      source: 'Anapath',
      metadata: {
        anapathRequestId: saved.id,
        anapathId: saved.anapathId,
        // Destinée au pathologiste (masquée pour le technicien qui a validé).
        recipientRole: 'pathologiste',
      },
    });
    return this.toResponse(saved);
  }

  /**
   * Valide le diagnostic cytoponction (pathologiste) : enregistre le site
   * prélevé, l'organe concerné et le type de fixateur, bascule la demande en
   * EN_COURS (elle entre dans le fil de travail du technicien) et notifie le
   * technicien qu'un patient est prêt pour un examen technique.
   */
  async validerDiagnosticCytoponction(
    id: string,
    dto: UpdateDiagnosticCytoponctionDto,
    token?: string,
  ): Promise<AnapathRequestResponse> {
    const request = await this.findOneEntity(id);
    if (request.typeExamen !== ExamenType.CYT0PONCTION) {
      throw new BadRequestException('Le diagnostic anticipé est réservé aux cytoponctions');
    }
    if (
      request.statut === Statut.VALIDE ||
      request.statut === Statut.ARCHIVE ||
      request.statut === Statut.ANNULEE
    ) {
      throw new BadRequestException('Examen déjà clôturé');
    }
    if (request.statut !== Statut.EN_ATTENTE_DIAGNOSTIC) {
      throw new BadRequestException('Diagnostic déjà validé');
    }
    const sitePreleve = (dto.sitePreleve ?? '').trim();
    const organe = (dto.organe ?? '').trim();
    const fixation = (dto.fixation ?? '').trim();
    if (!sitePreleve || !organe || !fixation) {
      throw new BadRequestException(
        'Site prélevé, organe et type de fixation sont requis avant validation',
      );
    }

    const [pathologisteNom, pathologisteUser] = await Promise.all([
      this.userServiceClient.getUserName(token ?? ''),
      this.userServiceClient.getUser(token ?? ''),
    ]);
    request.diagnosticCytoponction = {
      sitePreleve,
      organe,
      fixation,
      validatedByUserId: pathologisteUser?.id ?? pathologisteUser?.userId ?? null,
      validatedByName: pathologisteNom ?? null,
      validatedAt: new Date().toISOString(),
    };

    const statutAvant = request.statut;
    request.statut = Statut.EN_COURS;

    const saved = await this.anapathRepository.save(request);
    if (saved.statut !== statutAvant) {
      await this.propagerStatutVersPrescription(saved, token);
    }
    await this.notificationService.createNotification({
      type: NotificationType.PATIENT_PRET_EXAMEN_TECHNIQUE,
      title: 'Patient prêt pour un examen technique',
      message: `Cytoponction ${request.anapathId} — diagnostic validé par le pathologiste, patient prêt pour un examen technique`,
      priority: 'medium',
      source: 'Anapath',
      metadata: {
        anapathRequestId: saved.id,
        anapathId: saved.anapathId,
        // Destinée au technicien/histotechnicien (filtrée pour les autres rôles).
        recipientRole: 'technicien',
      },
    });
    return this.toResponse(saved);
  }

  async validate(
    id: string,
    dto: ValidateAnapathDto,
    token?: string,
  ): Promise<AnapathRequestResponse> {
    const request = await this.findOneEntity(id);
    if (request.statut === Statut.VALIDE)
      throw new BadRequestException('Déjà validée');
    if (request.statut !== Statut.EN_ATTENTE_VALIDATION)
      throw new BadRequestException('Résultat non disponible');

    const numeroOrdre = dto.numeroOrdre ?? dto.ordreProfessionnelNumber;
    const [validateurNom] = await Promise.all([
      this.userServiceClient.getUserName(token ?? ''),
      Promise.resolve(null),
    ]);
    const hash =
      dto.hash ??
      crypto
        .createHash('sha256')
        .update(`${request.anapathId}-${dto.signature}-${numeroOrdre}`)
        .digest('hex');

    if (dto.resultatDetails !== undefined) {
      request.resultatDetails = dto.resultatDetails;
    }
    if (dto.resultatConclusion !== undefined) {
      request.resultatConclusion = dto.resultatConclusion;
    }

    request.statut = Statut.VALIDE;
    request.validatedBySignature = dto.signature;
    request.validatedByUserId = numeroOrdre;
    request.validatedByName = validateurNom ?? null;
    request.validatedAt = new Date();
    request.validationHash = hash;
    request.signedHash = hash;

    this.syncResultatFields(request);

    const saved = await this.anapathRepository.save(request);
    await this.propagerStatutVersPrescription(saved, token);

    return this.toResponse(saved);
  }

  /** Métadonnées stockées sur la notification "nouvelle prescription" — assez pour l'afficher ET la matérialiser à l'acceptation. */
  private buildPendingMetadata(
    prescription: AnapathPrescription,
    demande: PrescriptionDemande,
    chuNom?: string | null,
    serviceNom?: string | null,
    prescripteurNom?: string | null,
  ): Record<string, unknown> {
    return {
      prescriptionId: prescription.id,
      demandeId: demande.id,
      patientId: prescription.patientId,
      typeExamen: demande.typeExamen,
      data: demande.data ?? {},
      // Champs de niveau prescription — préservés tels quels (le GET externe les renvoie).
      renseignements: prescription.renseignements ?? null,
      nomMedecinPrescripteur: prescription.nomMedecinPrescripteur ?? null,
      numeroONM: prescription.numeroONM ?? null,
      prescriptionStatut: prescription.statut ?? null,
      // Renseignements cliniques éventuellement portés directement par la demande.
      demandeRenseignementsCliniques: demande.renseignementsCliniques ?? null,
      chuId: prescription.chuId,
      serviceIdSource: prescription.serviceIdSource,
      serviceIdDest: prescription.serviceIdDest,
      prescripteurId: prescription.prescripteurId,
      prescripteurNom: prescripteurNom ?? null,
      urgence: prescription.urgence,
      alertes: prescription.alertes,
      chuNom: prescription.chuNom ?? prescription.chu?.nom ?? chuNom ?? null,
      serviceNom: prescription.serviceNameSource ?? prescription.serviceNameDest ?? serviceNom ?? null,
    };
  }

  /**
   * Résout le nom du CHU via le service CHU (best-effort, jamais bloquant) :
   * la prescription externe ne fournit qu'un chuId. Cache 5 min.
   * Le token utilisateur est privilégié ; s'il est absent ou rejeté (401),
   * on retombe sur le token de service renouvelé automatiquement.
   */
  async getChuNom(token: string | undefined, chuId?: string): Promise<string | null> {
    if (!chuId) return null;
    for (const t of await this.resolveTokens(token)) {
      const nom = await this.resolveChuNom(t, chuId);
      if (nom) return nom;
    }
    return null;
  }

  private async resolveChuNom(token: string, chuId: string): Promise<string | null> {
    const cached = this.chuNomCache.get(String(chuId));
    if (cached && Date.now() - cached.at <= 5 * 60 * 1000) return cached.nom;
    let nom: string | null = null;
    try {
      const chu = await this.chuClient.getCmsChuById(token, String(chuId));
      nom = typeof chu?.name === 'string' ? chu.name : null;
    } catch {
      nom = null;
    }
    this.chuNomCache.set(String(chuId), { at: Date.now(), nom });
    return nom;
  }

  /**
   * Résout le nom du service demandeur (serviceIdSource) via le service-service
   * dédié (GET /services/{id}, puis repli GET /services?chuId=…, caches 5 min).
   * Best-effort : null si aucun token résolvable ou service introuvable.
   */
  async getServiceNom(
    token: string | undefined,
    serviceId?: string,
    chuId?: string,
  ): Promise<string | null> {
    if (!serviceId) return null;
    for (const t of await this.resolveTokens(token)) {
      const nom = await this.resolveServiceNom(t, serviceId, chuId);
      if (nom) return nom;
    }
    return null;
  }

  private async resolveServiceNom(
    token: string,
    serviceId: string,
    chuId?: string,
  ): Promise<string | null> {
    const idKey = String(serviceId);
    const idCached = this.servicesById.get(idKey);
    if (idCached && Date.now() - idCached.at <= 5 * 60 * 1000) {
      return idCached.nom;
    }

    let nom: string | null = null;
    const srv = await this.serviceServiceClient.getServiceById(token, serviceId);
    if (srv && typeof srv.name === 'string') {
      nom = srv.name;
    } else {
      const key = String(chuId ?? '');
      let cached = this.servicesByChu.get(key);
      if (!cached || Date.now() - cached.at > 5 * 60 * 1000) {
        const list = await this.serviceServiceClient.getServicesByChu(token, chuId);
        cached = { at: Date.now(), list };
        this.servicesByChu.set(key, cached);
      }
      const entry = (cached?.list ?? []).find(
        (s) =>
          String(s.id) === idKey || String(s.serviceId) === idKey,
      );
      nom = typeof entry?.name === 'string' ? entry.name : null;
    }

    this.servicesById.set(idKey, { at: Date.now(), nom });
    return nom;
  }

  /** Liste dédupliquée des tokens candidats : utilisateur puis jeton de service auto-signé. */
  private async resolveTokens(token?: string): Promise<string[]> {
    const candidates: string[] = [];
    if (token) candidates.push(token);
    const serviceToken = await this.authServiceToken.getToken();
    if (serviceToken && !candidates.includes(serviceToken)) {
      candidates.push(serviceToken);
    }
    return candidates;
  }

  /**
   * Détails À JOUR d'une demande de prescription externe, pour l'affichage du
   * détail depuis la cloche : GET /prescriptions/anapath/{id} du service
   * Prescription, la demande demandée est extraite avec sa prescription.
   */
  async getPrescriptionDemandeDetails(
    token: string | undefined,
    prescriptionId: string,
    demandeId: string,
  ): Promise<{ prescription: AnapathPrescription; demande: PrescriptionDemande | null }> {
    let prescription: AnapathPrescription | null = null;
    for (const t of await this.resolveTokens(token)) {
      prescription = await this.prescriptionClient.getPrescriptionById(t, prescriptionId);
      if (prescription) break;
    }
    if (!prescription) {
      throw new NotFoundException(
        `Prescription externe ${prescriptionId} introuvable ou indisponible`,
      );
    }
    const demande =
      (prescription.demandes ?? []).find(
        (d) => String(d.id) === String(demandeId),
      ) ?? null;
    return { prescription, demande };
  }

  /** Construit les champs AnapathRequest depuis les métadonnées d'une notification "nouvelle prescription" (acceptation). */
  private buildRequestFromPendingMetadata(metadata: Record<string, any>): Partial<AnapathRequest> {
    const data = (metadata.data ?? {}) as Record<string, unknown>;
    const details = (data.details ?? {}) as Record<string, unknown>;
    // Lecture d'une valeur dans data.details (clés préfixées du service Prescription) puis
    // data (champs plats) — sans transformation, repli booléen/nombre conservés.
    const pick = (...keys: string[]): string => {
      for (const key of keys) {
        const value = details[key] ?? data[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
        if (typeof value === 'number') return String(value);
      }
      return '';
    };

    const typeExamen = String(metadata.typeExamen ?? '');
    // Clés du site anatomique par type d'examen, alignées sur le payload réel du service
    // Prescription (clés préfixées dans data.details, puis champs plats du DTO).
    const SITE_KEYS: Record<string, string[]> = {
      FCV_PAP: [],
      CYT0PONCTION: ['cytoSiege', 'siege', 'cytoOrgane', 'organe'],
      LIQUIDE: ['liqNat'],
      BIOPSIE: ['bioOrgane', 'organe', 'bioLocalisation', 'localisation'],
      POS: ['bioOrgane', 'organe', 'bioLocalisation', 'localisation'],
      POC: ['bioOrgane', 'organe', 'bioLocalisation', 'localisation'],
      EXTEMPORANE_STAT: ['extOrgane', 'organe'],
    };
    let site = pick(...(SITE_KEYS[typeExamen] ?? ['organe', 'localisation', 'siege']));
    // Liquide « Autre » : la nature réelle est dans le champ de précision.
    if (typeExamen === 'LIQUIDE' && site.toLowerCase() === 'autre') {
      site = pick('liqNatAutre') || site;
    }

    const motif =
      pick('renseignementsCliniques') ||
      String(metadata.renseignements ?? '').trim() ||
      String(metadata.demandeRenseignementsCliniques ?? '').trim() ||
      // Anciens payloads sans renseignementsCliniques : composition sans perte des champs reçus.
      [
        pick('bioNature', 'nature'),
        pick('bioOrgane', 'organe', 'cytoOrgane'),
        pick('bioSuspicion', 'suspicion'),
        pick('bioAtcd', 'atcd'),
        pick('bioExamAnt', 'examAnt'),
        pick('bioResAnt', 'resAnt'),
      ]
        .filter(Boolean)
        .join(' — ');
    const suspicion = pick('suspicion', 'bioSuspicion');

    return {
      anapathId: this.generateAnapathId(),
      patientId: metadata.patientId,
      prescriptionId: metadata.prescriptionId,
      demandeId: metadata.demandeId,
      typeExamen: typeExamen as AnapathRequest['typeExamen'],
      isExtemporane: typeExamen === 'EXTEMPORANE_STAT',
      prelevement: {
        site,
        description: motif,
        clinicalData: {
          suspicion: suspicion || undefined,
          clinicalNotes: motif || undefined,
        },
      },
      metadata: {
        sourceService: 'prescription-pull',
        chuId: metadata.chuId,
        serviceIdSource: metadata.serviceIdSource,
        serviceIdDest: metadata.serviceIdDest,
        prescripteurId: metadata.prescripteurId,
        prescripteurNom: metadata.prescripteurNom ?? null,
        urgence: metadata.urgence,
        alertes: metadata.alertes,
        chuNom: metadata.chuNom ?? null,
        serviceNom: metadata.serviceNom ?? null,
        renseignements: metadata.renseignements ?? null,
        nomMedecinPrescripteur: metadata.nomMedecinPrescripteur ?? null,
        numeroONM: metadata.numeroONM ?? null,
        prescriptionStatut: metadata.prescriptionStatut ?? null,
        // Le payload complet de la demande est conservé tel quel — aucune perte de champ.
        rawData: data,
      },
      statut: Statut.CREEE,
    };
  }

  /**
   * Crée une notification locale "nouvelle prescription en attente" pour chaque demande
   * découverte via le pull externe et encore inconnue (ni AnapathRequest locale, ni notification
   * déjà en attente pour ce demandeId). Ne matérialise PAS de AnapathRequest directement —
   * c'est le rôle d'accepterPrescription(), déclenché par l'utilisateur depuis la cloche.
   */
  private async creerNotificationsPourNouvellesDemandes(prescription: AnapathPrescription, token?: string): Promise<number> {
    const [chuNom, serviceNom, prescripteurNom] = await Promise.all([
      this.getChuNom(token, prescription.chuId),
      this.getServiceNom(token, prescription.serviceIdSource, prescription.chuId),
      this.userServiceClient.getUserNameById(token ?? '', prescription.prescripteurId),
    ]);
    let created = 0;
    for (const demande of prescription.demandes ?? []) {
      if (!demande.id) continue;
      const existingRequest = await this.anapathRepository.findOne({ where: { demandeId: demande.id } });
      if (existingRequest) continue;
      const existingNotif = await this.notificationService.findPendingByDemandeId(demande.id);
      if (existingNotif) continue;

      const alertesTexte = (prescription.alertes ?? '').trim();
      await this.notificationService.createNotification({
        type: NotificationType.NOUVELLE_PRESCRIPTION,
        title: `Nouvelle prescription — ${demande.typeExamen}`,
        message: alertesTexte ? `Précautions & alertes : ${alertesTexte}` : '',
        priority: prescription.urgence === 'TRES_URGENT' ? 'high' : 'medium',
        source: 'prescription-pull',
        metadata: this.buildPendingMetadata(prescription, demande, chuNom, serviceNom, prescripteurNom),
      });
      created++;
    }
    return created;
  }

  /** Pull manuel (ou déclenché par le cron) des prescriptions anapath externes. */
  async synchroniserPrescriptions(token: string): Promise<{ prescriptions: number; notificationsCreees: number }> {
    const prescriptions = await this.prescriptionClient.getAnapathPrescriptions(token, {
      serviceIdDest: ANAPATH_SERVICE_ID,
    });
    let notificationsCreees = 0;
    for (const prescription of prescriptions) {
      notificationsCreees += await this.creerNotificationsPourNouvellesDemandes(prescription, token);
    }
    return { prescriptions: prescriptions.length, notificationsCreees };
  }

  /**
   * Accepte une prescription en attente : matérialise la demande en AnapathRequest locale
   * (elle entre dans le fil de travail), informe le service Prescription (statut EN_COURS),
   * puis marque la notification comme traitée.
   */
  async accepterPrescription(notificationId: string, token: string): Promise<AnapathRequestResponse> {
    const notification = await this.notificationService.findOne(notificationId);
    if (!notification || notification.type !== NotificationType.NOUVELLE_PRESCRIPTION) {
      throw new NotFoundException('Notification de prescription introuvable');
    }
    if (notification.metadata?.outcome) {
      throw new BadRequestException('Cette prescription a déjà été traitée');
    }

    const metadata = (notification.metadata ?? {}) as Record<string, any>;

    if (metadata.demandeId) {
      const existing = await this.anapathRepository.findOne({
        where: { demandeId: metadata.demandeId },
      });
      if (existing) {
        await this.notificationService.markResolved(notificationId, 'ACCEPTEE', {
          anapathRequestId: existing.id,
        });
        return this.toResponse(existing);
      }
    }

    const entity = this.anapathRepository.create(
      this.buildRequestFromPendingMetadata(metadata),
    );
    // Dès l'acceptation, la demande entre dans le fil de travail : EN_COURS
    // (phase examen technique) pour les examens courants, mais pour une
    // CYTOPONCTION elle va d'abord chez le pathologiste (EN_ATTENTE_DIAGNOSTIC)
    // qui remplit le diagnostic AVANT l'examen technique.
    entity.statut =
      entity.typeExamen === ExamenType.CYT0PONCTION
        ? Statut.EN_ATTENTE_DIAGNOSTIC
        : Statut.EN_COURS;
    let saved: AnapathRequest;
    try {
      saved = await this.anapathRepository.save(entity);
    } catch (err) {
      const code =
        (err as { code?: string } | null)?.code ??
        (err as { driverError?: { code?: string } } | null)?.driverError?.code;
      if (code === '23505' && metadata.demandeId) {
        const existing = await this.anapathRepository.findOne({
          where: { demandeId: metadata.demandeId },
        });
        if (existing) {
          await this.notificationService.markResolved(notificationId, 'ACCEPTEE', {
            anapathRequestId: existing.id,
          });
          return this.toResponse(existing);
        }
      }
      throw err;
    }

    // Stocke une fois pour toutes l'identité du patient (nom, prénom, dateNaissance…)
    // résolue depuis Accueil : les lectures ultérieures n'ont plus besoin d'appeler
    // Accueil (évite le martelage / rate limit 429) et le détail de prescription
    // peut afficher nom + âge sans dépendre de la disponibilité d'Accueil.
    if (saved.patientId && metadata.chuId) {
      const patient = await this.accueilClient.getPatient(
        saved.patientId,
        String(metadata.chuId),
      );
      if (patient) {
        saved.patientInfo = patient;
        await this.anapathRepository.save(saved);
      }
    }

    const nomPatient =
      (saved.patientInfo
        ? this.accueilClient.buildNomComplet(saved.patientInfo)
        : '') || saved.patientId;
    await this.prescriptionClient.updateDemandeStatut(
      token,
      notification.metadata?.prescriptionId,
      notification.metadata?.demandeId,
      'EN_COURS',
      `Votre demande pour l'examen du patient ${nomPatient} chez anapath est accepté`,
    );

    await this.notificationService.markResolved(notificationId, 'ACCEPTEE', {
      anapathRequestId: saved.id,
    });

    return this.toResponse(saved);
  }

  /**
   * Refuse une prescription en attente : n'entre JAMAIS dans le fil de travail, informe
   * le service Prescription (statut ANNULEE + motif obligatoire), marque la notification traitée.
   */
  async refuserPrescription(notificationId: string, motif: string, token: string): Promise<void> {
    const notification = await this.notificationService.findOne(notificationId);
    if (!notification || notification.type !== NotificationType.NOUVELLE_PRESCRIPTION) {
      throw new NotFoundException('Notification de prescription introuvable');
    }
    if (notification.metadata?.outcome) {
      throw new BadRequestException('Cette prescription a déjà été traitée');
    }
    if (!motif?.trim()) {
      throw new BadRequestException('Motif de refus requis');
    }

    await this.prescriptionClient.updateDemandeStatut(
      token,
      notification.metadata?.prescriptionId,
      notification.metadata?.demandeId,
      'ANNULEE',
      motif,
    );

    await this.notificationService.markResolved(notificationId, 'REFUSEE', { motif });
  }

  // Toutes les minutes : plus le pull est fréquent, plus la cloche sonne vite
  // après l'envoi d'une demande (le push socket.io lui-même est instantané).
  // Surchargable via PRESCRIPTION_SYNC_CRON.
  @Cron(process.env.PRESCRIPTION_SYNC_CRON ?? '* * * * *')
  async synchroniserPrescriptionsExternesCron(): Promise<void> {
    if ((process.env.PRESCRIPTION_SYNC_ENABLED ?? 'true') !== 'true') return;
    const token = await this.authServiceToken.getToken();
    if (!token) {
      console.warn(
        'Pull des prescriptions ignoré : aucun jeton de service disponible (JWT_SECRET manquant — impossible de signer un jeton auto-signé, voir AuthServiceTokenService)',
      );
      return;
    }
    try {
      const result = await this.synchroniserPrescriptions(token);
      if (result.notificationsCreees > 0) {
        console.log(
          `✅ Pull prescriptions : ${result.notificationsCreees} nouvelle(s) notification(s) créée(s) sur ${result.prescriptions} prescription(s)`,
        );
      }
    } catch (e) {
      console.warn('Pull des prescriptions échoué:', e);
    }
  }

  /** Récupère (et crée si absente) la ligne unique de préférences des rapports. */
  async getReportSettings(): Promise<ReportSettings> {
    const existing = await this.reportSettingsRepository.findOne({ where: { id: 'default' } });
    if (existing) return existing;
    return this.reportSettingsRepository.save(
      this.reportSettingsRepository.create({ id: 'default', autoWeeklyReportEnabled: false }),
    );
  }

  async updateReportSettings(autoWeeklyReportEnabled: boolean): Promise<ReportSettings> {
    const settings = await this.getReportSettings();
    settings.autoWeeklyReportEnabled = autoWeeklyReportEnabled;
    return this.reportSettingsRepository.save(settings);
  }

  /**
   * Chaque vendredi à 18h : si activé, notifie le service qu'un rapport
   * hebdomadaire est prêt à être consulté/exporté (la génération du PDF
   * elle-même reste côté navigateur, cf. page Rapports).
   */
  @Cron('0 18 * * 5')
  async notifierRapportHebdomadaireAutomatique() {
    const settings = await this.getReportSettings();
    if (!settings.autoWeeklyReportEnabled) return;

    try {
      await this.notificationService.createNotification({
        type: 'RAPPORT_HEBDOMADAIRE',
        title: 'Rapport hebdomadaire disponible',
        message:
          "Le rapport d'activité hebdomadaire du service est prêt, cliquer pour télécharger automatiquement le fichier Excel de la semaine en cours.",
        priority: 'medium',
        source: 'Anapath',
      });
      console.log('✅ Notification rapport hebdomadaire créée');
    } catch (e) {
      console.warn('Notification rapport hebdomadaire échouée:', e);
    }
  }

  /**
   * Envoi manuel du rapport hebdomadaire (modèle CHU) par la secrétaire au
   * major : crée une notification destinée UNIQUEMENT au major
   * (recipientRole: 'major'), avec le nom de la secrétaire qui a effectué
   * l'envoi dans le message.
   */
  async envoyerRapportHebdomadaireAuMajor(params: {
    du?: string;
    au?: string;
    secretaire?: { name?: string; firstname?: string } | null;
  }): Promise<{ success: boolean; id?: string }> {
    const { du, au, secretaire } = params;
    const nom = [secretaire?.firstname, secretaire?.name]
      .filter(Boolean)
      .join(' ')
      .trim();

    const intervalle =
      du && au
        ? ` (du ${du} au ${au})`
        : du
          ? ` (à partir du ${du})`
          : au
            ? ` (jusqu'au ${au})`
            : '';

    const created = await this.notificationService.createNotification({
      type: 'RAPPORT_HEBDOMADAIRE',
      title: 'Rapport hebdomadaire reçu',
      message: nom
        ? `Rapport hebdomadaire du service prêt à être téléchargé${intervalle} — Envoyé par : ${nom}`
        : `Rapport hebdomadaire du service prêt à être téléchargé${intervalle}`,
      priority: 'medium',
      source: 'Anapath',
      metadata: {
        recipientRole: 'major',
        rapportsDu: du ?? null,
        rapportsAu: au ?? null,
        envoyePar: nom || null,
      },
    });

    if (!created?.id) {
      return { success: false };
    }
    return { success: true, id: created.id };
  }
}

function formatTimeSince(date: Date): string {
  if (!date) return '—';
  const diff = Date.now() - new Date(date).getTime();
  const jours = Math.floor(diff / (1000 * 60 * 60 * 24));
  const heures = Math.floor(
    (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
  );
  if (jours > 0) return `${jours}j ${heures}h`;
  return `${heures}h`;
}
