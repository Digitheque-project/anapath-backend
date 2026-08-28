import { Controller, Get, Patch, Param, Post, Put, Body, Query, HttpCode, Header, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { AnapathService } from './anapath.service';
import { UpdateAnapathDto } from './dto/update-anapath.dto';
import { ValidateAnapathDto } from './dto/validate-anapath.dto';
import { UpdateResultatDto } from './dto/update-resultat.dto';
import { UpdateExamenSpeculumDto } from './dto/update-examen-speculum.dto';
import { UpdateExamenTechniqueDto } from './dto/update-examen-technique.dto';
import { UpdateDiagnosticCytoponctionDto } from './dto/update-diagnostic-cytoponction.dto';
import { AnapathRequest, Statut } from './entities/anapath-request.entity';
import { ChuClient } from '../common/clients/chu.client';
import { AccueilClient } from '../common/clients/accueil.client';
import { NotificationClient } from '../common/clients/notification.client';
import { PrescriptionTokenMonitorService } from '../common/clients/prescription-token-monitor.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/dto/receive-notification.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentToken } from '../auth/decorators/current-token.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import { shouldNotifyUser } from '../common/notification-recipients';

function sortNotifications(notifs: any[]): any[] {
  const urgencePriority: Record<string, number> = { STAT: 1, URGENTE: 2, NORMALE: 3 };
  return [...notifs].sort((a, b) => {
    const pa = urgencePriority[a.urgence ?? a.metadata?.urgence ?? a.priority ?? 'NORMALE'] ?? 3;
    const pb = urgencePriority[b.urgence ?? b.metadata?.urgence ?? b.priority ?? 'NORMALE'] ?? 3;
    if (pa !== pb) return pa - pb;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/**
 * Vrai pour un technicien / histotechnicien : soit le rôle du token le dit
 * explicitement (chef de service, histotechnicien…), soit les permissions le
 * déduisent (met à jour les demandes mais ne les valide pas et ne rédige pas
 * les observations — c'est-à-dire ni pathologiste ni secrétaire).
 * Seul le technicien a accès aux « nouvelles demandes », à l'acceptation/refus
 * des prescriptions et à l'examen au spéculum.
 */
function isTechnicienUser(user?: AuthenticatedUser): boolean {
  if (!user) return false;
  if (user.roleName && /technicien/i.test(user.roleName)) return true;
  const perms = user.permissions ?? [];
  return (
    perms.includes('anapath:update') &&
    !perms.includes('anapath:validate') &&
    !perms.includes('anapath:observation:write')
  );
}

@ApiTags('anapath')
@Controller('anapath')
export class AnapathController {
  constructor(
    private readonly anapathService: AnapathService,
    private readonly chuClient: ChuClient,
    private readonly accueilClient: AccueilClient,
    private readonly notificationClient: NotificationClient,
    private readonly notificationService: NotificationService,
    private readonly prescriptionTokenMonitor: PrescriptionTokenMonitorService,
  ) {}

  @Permissions('anapath:read')
  @Get()
  @ApiOperation({ summary: 'Lister toutes les demandes (optionnellement filtrées par patientId)' })
  @ApiResponse({ status: 200, description: 'Liste des demandes', type: [AnapathRequest] })
  @Header('Content-Type', 'application/json; charset=utf-8')
  async findAll(
    @Query('patientId') patientId?: string,
    @CurrentToken() token?: string,
  ) {
    const rows = await this.anapathService.findAll(patientId);
    return this.enrichExamensPatient(rows, this.decodeAnapathContext(token), token);
  }

  @Permissions('anapath:update')
  @Post('prescriptions/sync')
  @ApiOperation({
    summary: 'Déclencher manuellement le pull des prescriptions anapath depuis le service Prescription externe',
  })
  @Header('Content-Type', 'application/json; charset=utf-8')
  synchroniserPrescriptions(@CurrentToken() token: string) {
    return this.anapathService.synchroniserPrescriptions(token);
  }

  @Permissions('anapath:read')
  @Get('prescriptions/externes/:prescriptionId/demandes/:demandeId')
  @ApiOperation({
    summary:
      "Détails à jour d'une demande de prescription externe (service Prescription) — utilisé par la cloche pour afficher toutes les informations saisies",
  })
  @Header('Content-Type', 'application/json; charset=utf-8')
  getPrescriptionExterneDetails(
    @Param('prescriptionId') prescriptionId: string,
    @Param('demandeId') demandeId: string,
    @CurrentToken() token: string,
  ) {
    return this.anapathService.getPrescriptionDemandeDetails(
      token,
      prescriptionId,
      demandeId,
    );
  }

  @Permissions('anapath:read')
  @Get('patients/:patientId/dossier-patient')
  @ApiOperation({
    summary:
      "Dossier patient : tous les examens complémentaires du patient enregistrés par l'ensemble des services du CHU (dossier-patient)",
  })
  @ApiParam({ name: 'patientId', description: 'UUID du patient (service Accueil)' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  getDossierPatient(
    @Param('patientId') patientId: string,
    @Query('chuId') chuId?: string,
  ) {
    return this.anapathService.getDossierPatient(patientId, chuId);
  }

  // Alias du contrat « Résultats paracliniques » (agrégateur dossier-patient) :
  // même handler, chemins préfixés /anapath au cas où l'agrégateur appelle
  // {baseUrl}/anapath/… — volontairement SANS @Permissions pour accepter le
  // compte de service de n'importe quel service du CHU.
  @Get(['resultats/patient/:patientId', 'patients/:patientId/resultats'])
  @ApiOperation({ summary: 'Résultats paracliniques anapath d’un patient (alias contrat agrégateur)' })
  @ApiParam({ name: 'patientId', description: 'UUID du patient (service Accueil)' })
  getResultatsParacliniques(
    @Param('patientId') patientId: string,
    @Query('chuId') chuId?: string,
  ) {
    return this.anapathService.getResultatsParacliniquesPatient(patientId, chuId);
  }

  @Permissions('anapath:read')
  @Get('prescriptions/sync-status')
  @ApiOperation({
    summary: "Statut du token utilisé par le cron/WebSocket Prescription (expiration, etc.) — PRESCRIPTION_CRON_JWT n'est pas un token de service durable",
  })
  @Header('Content-Type', 'application/json; charset=utf-8')
  getPrescriptionSyncStatus() {
    return this.prescriptionTokenMonitor.getStatus();
  }

  @Permissions('anapath:read')
  @Get('chu')
  @ApiOperation({ summary: 'Lister tous les CHU (service CHU externe)' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  getChus(@CurrentToken() token?: string) {
    return this.chuClient.getCmsChus(token ?? '');
  }

  @Permissions('anapath:read')
  @Get('chu/:id')
  @ApiOperation({ summary: "Détail d'un CHU (nouveau service chu-service) par id" })
  @ApiParam({ name: 'id', description: 'UUID du CHU' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  getChuById(@Param('id') id: string, @CurrentToken() token: string) {
    return this.chuClient.getCmsChuById(token, id);
  }

  @Permissions('anapath:read')
  @Get('prise-en-charge/:id')
  @ApiOperation({ summary: 'Détail d\'une prise en charge (entreprise) par id' })
  @ApiParam({ name: 'id', description: 'UUID de la prise en charge' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  getPriseEnChargeById(@Param('id') id: string, @CurrentToken() token: string) {
    return this.chuClient.getCmsPriseEnChargeById(token, id);
  }

  @Permissions('anapath:read')
  @Get('service/anapath')
  @ApiOperation({ summary: 'Infos du service Anatomie Pathologique (contexte du token connecté)' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  getAnapathService(@CurrentToken() token?: string) {
    return this.decodeAnapathContext(token);
  }

  @Permissions('anapath:read')
  @Get('report-settings')
  @ApiOperation({ summary: 'Préférences des rapports (ex: envoi automatique hebdomadaire)' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  getReportSettings() {
    return this.anapathService.getReportSettings();
  }

  @Permissions('anapath:update', 'anapath:report:export')
  @Patch('report-settings')
  @ApiOperation({ summary: 'Activer/désactiver le rapport hebdomadaire automatique' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  updateReportSettings(@Body() dto: { autoWeeklyReportEnabled: boolean }) {
    return this.anapathService.updateReportSettings(dto.autoWeeklyReportEnabled);
  }

  @Permissions('anapath:read')
  @Get('notifications')
  @ApiOperation({ summary: 'Notifications du service Anapath (nouvelles demandes + notifications internes)' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  async getNotifications(
    @CurrentToken() token: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const ctx = this.decodeAnapathContext(token);
    // Uniquement les notifications LOCALES du service (nouvelles prescriptions,
    // alertes extemporanées, rapports…) : les notifications poussées par le
    // service Prescription externe ne sont plus affichées (source du spam).
    let locales = await this.notificationService.findAll();
    // Les prescriptions (nouvelles demandes) ne concernent que le technicien :
    // un pathologiste/secrétaire garde les notifications internes mais ne voit
    // plus les nouvelles demandes (ni la cloche d'acceptation/refus).
    locales = this.filterNotificationsForUser(locales, user);
    const enriched = await Promise.all(
      locales.map(async (n: any) => this.enrichNotification(n, ctx, token)),
    );
    return sortNotifications(enriched);
  }

  @Permissions('anapath:read')
  @Get('notifications/non-lues')
  @ApiOperation({ summary: 'Notifications non lues' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  async getUnread(
    @CurrentToken() token: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const ctx = this.decodeAnapathContext(token);
    let locales = await this.notificationService.findUnread();
    locales = this.filterNotificationsForUser(locales, user);
    const enriched = await Promise.all(
      locales.map(async (n: any) => this.enrichNotification(n, ctx, token)),
    );
    return sortNotifications(enriched);
  }

  /**
   * Nouvelles demandes en attente d'acceptation/refus — indépendant de l'état
   * « lu » : la page « Nouvelles demandes » doit continuer à les afficher même
   * après « tout marquer lu » dans la cloche.
   */
  @Permissions('anapath:read')
  @Get('notifications/en-attente')
  @ApiOperation({ summary: 'Nouvelles demandes en attente d\'acceptation ou de refus (quel que soit l\'état lu)' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  async getEnAttente(
    @CurrentToken() token: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const ctx = this.decodeAnapathContext(token);
    let locales = await this.notificationService.findPending();
    // Ciblage par rôle : les nouvelles prescriptions ne concernent que le
    // technicien/histotechnicien — sans ça, un pathologiste ou un major verrait
    // des demandes qu'il ne peut ni accepter ni refuser.
    locales = locales.filter((n: any) => shouldNotifyUser(n, user));
    const enriched = await Promise.all(
      locales.map(async (n: any) => this.enrichNotification(n, ctx, token)),
    );
    return sortNotifications(enriched);
  }

  /**
   * Masque les notifications par rôle (groupe de destinataire : technicien,
   * pathologiste) : un major/secrétaire ne reçoit aucune notification destinée
   * au technicien ou au pathologiste. Les notifications sans groupe restent
   * visibles pour tous (alertes STAT, rapport hebdomadaire…).
   */
  private filterNotificationsForUser(
    notifs: any[],
    user?: AuthenticatedUser,
  ): any[] {
    return notifs.filter((n: any) => shouldNotifyUser(n, user));
  }

  /**
   * Contexte du service Anapath connecté (décodé du JWT de la session) : le CHU de
   * l'utilisateur — source du champ affiché « CHU ». Le « Service demandeur » (le
   * service émetteur de la prescription, serviceIdSource) est résolu via le
   * service-service dédié (via le gateway central, GET /services/{id})
   * dans anapathService.getServiceNom (cf. enrichChuServiceExamen).
   */
  private decodeAnapathContext(token?: string): { serviceName?: string; chuName?: string } {
    if (!token) return {};
    try {
      const payloadB64 = token.split('.')[1];
      if (!payloadB64) return {};
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      );
      const entry = (payload?.services ?? []).find(
        (s: any) => s.serviceId === this.notificationClient.getAnapathServiceId(),
      );
      return {
        serviceName:
          typeof entry?.serviceName === 'string' ? entry.serviceName : undefined,
        chuName: typeof entry?.chu?.name === 'string' ? entry.chu.name : undefined,
      };
    } catch {
      return {};
    }
  }

  /** Complète (affichage uniquement) le nom de CHU vide d'un objet par le contexte connecté. */
  private appliquerContexteAffichage(
    obj: any,
    ctx?: { serviceName?: string; chuName?: string },
  ): any {
    if (!obj || typeof obj !== 'object') return obj;
    if (!ctx?.chuName) return obj;
    const metadata =
      obj.metadata && typeof obj.metadata === 'object' ? { ...obj.metadata } : {};
    if (!metadata.chuNom && ctx.chuName) metadata.chuNom = ctx.chuName;
    return { ...obj, metadata };
  }

  /**
   * Enrichit une notification avec les champs de l'examen (si connu) et le nom
   * complet du patient (résolu via Accueil). Pour les prescriptions encore en
   * attente (aucun examen matérialisé), on résout le nom depuis les métadonnées
   * (patientId + chuId) ; en dernier recours le patientId sert de libellé.
   */
  private async enrichNotification(
    n: any,
    ctx?: { serviceName?: string; chuName?: string },
    token?: string,
  ): Promise<any> {
    if (!n || typeof n !== 'object') return n;
    n = this.appliquerContexteAffichage(n, ctx);

    const anapathId = n.metadata?.anapathId ?? n.referenceId ?? n.examId;
    let examen: any = null;
    if (anapathId) {
      try {
        examen = await this.anapathService.findByAnapathId(anapathId);
        if (examen) examen = this.appliquerContexteAffichage(examen, ctx);
      } catch {
        examen = null;
      }
    }

    const base = examen
      ? {
          ...n,
          enriched: {
            id: examen.id,
            anapathId: examen.anapathId,
            typeExamen: examen.typeExamen,
            statut: examen.statut,
            urgence:
              (examen.metadata?.urgence as string) ??
              (examen.isExtemporane ? 'STAT' : 'NORMALE'),
            serviceNom:
              (examen.metadata?.serviceNom as string) ??
              (examen.metadata?.serviceId as string) ??
              '—',
            patientId: examen.patientId,
            createdAt: examen.createdAt,
            lu:
              examen.notificationLue &&
              ['RESULTAT_DISPONIBLE', 'VALIDE', 'ARCHIVE'].includes(
                examen.statut,
              ),
          },
        }
      : n;

    const patientId =
      (examen?.patientId as string) ??
      (n.metadata?.patientId as string) ??
      (n.patientId as string) ??
      '';
    const chuId =
      ((examen?.metadata?.chuId as string) ??
        (n.metadata?.chuId as string)) ??
      '';

    // Nom du service demandeur / CHU : réutilise celui stocké, sinon le résout
    // best-effort (caches 5 min côté service) — jamais un UUID brut à l'écran.
    let serviceNom: string | null =
      (examen?.metadata?.serviceNom as string) ??
      (n.metadata?.serviceNom as string) ??
      null;
    if (!serviceNom) {
      const sid =
        (examen?.metadata?.serviceIdSource as string) ??
        (examen?.metadata?.serviceIdDest as string) ??
        (n.metadata?.serviceIdSource as string) ??
        (n.metadata?.serviceIdDest as string) ??
        '';
      serviceNom = await this.anapathService.getServiceNom(token, sid, chuId);
    }
    let chuNom: string | null =
      (examen?.metadata?.chuNom as string) ??
      (n.metadata?.chuNom as string) ??
      null;
    if (!chuNom && chuId) {
      chuNom = await this.anapathService.getChuNom(token, chuId);
    }

    const info = (examen?.patientInfo as any) ?? null;

    let patientName = patientId || '—';
    if (info?.nom) {
      patientName =
        this.accueilClient.buildNomComplet(info) || patientName;
    } else if (patientId && chuId) {
      try {
        const patient = await this.accueilClient.getPatient(patientId, chuId);
        if (patient) {
          patientName =
            this.accueilClient.buildNomComplet(patient) || patientName;
        }
      } catch {
        // Si Accueil est indisponible, on garde le patientId comme libellé.
      }
    }

    let allergies: string | null = null;
    if (typeof info?.allergie === 'string' && info.allergie.trim()) {
      allergies = info.allergie.trim();
    } else if (patientId && chuId) {
      try {
        const fetched = await this.accueilClient.getAllergie(patientId, chuId);
        if (fetched?.trim()) allergies = fetched.trim();
      } catch {
        // Non bloquant
      }
    }

    return {
      ...base,
      enriched: {
        ...(base.enriched ?? {}),
        patientId,
        patientName,
        allergies,
        serviceNom: serviceNom ?? undefined,
        chuNom: chuNom ?? undefined,
      },
      // Miroir dans metadata pour que le front (fallback metadata.serviceNom)
      // et les prochains rendus trouvent le nom sans nouvel appel externe.
      metadata:
        base.metadata && typeof base.metadata === 'object'
          ? {
              ...base.metadata,
              ...(serviceNom && !base.metadata.serviceNom
                ? { serviceNom }
                : {}),
              ...(chuNom && !base.metadata.chuNom ? { chuNom } : {}),
            }
          : base.metadata,
    };
  }

  /** Enrichit chuNom/serviceNom manquants (best-effort) depuis le service Prescription / service CHU. */
  private async enrichChuServiceExamen(examen: any, token?: string): Promise<any> {
    if (!examen || typeof examen !== 'object') return examen;
    const metadata =
      examen.metadata && typeof examen.metadata === 'object' ? { ...examen.metadata } : {};
    let changed = false;
    if (!metadata.serviceNom && (metadata.serviceIdSource ?? metadata.serviceIdDest)) {
      const serviceNom = await this.anapathService.getServiceNom(
        token,
        metadata.serviceIdSource ?? metadata.serviceIdDest,
        metadata.chuId,
      );
      if (serviceNom) {
        metadata.serviceNom = serviceNom;
        changed = true;
      }
    }
    if (!metadata.chuNom && metadata.chuId) {
      const chuNom = await this.anapathService.getChuNom(token, metadata.chuId);
      if (chuNom) {
        metadata.chuNom = chuNom;
        changed = true;
      }
    }
    return changed ? { ...examen, metadata } : examen;
  }

  /**
   * Enrichit une réponse d'examen (liste GET /anapath ou détail GET /anapath/:id)
   * avec le nom complet du patient : résolu depuis patientInfo stocké, sinon via
   * Accueil (mis en cache), sinon vide — jamais l'ID patient en guise de libellé.
   * Ajoute aussi chuNom/serviceNom manquants (métadonnées, best-effort).
   */
  private async enrichExamenPatient(examen: any, token?: string): Promise<any> {
    return this.enrichChuServiceExamen(
      await this.enrichPatientIdentite(examen),
      token,
    );
  }

  private async enrichPatientIdentite(examen: any): Promise<any> {
    if (!examen || typeof examen !== 'object') return examen;

    const info = (examen.patientInfo as any) ?? null;
    const nomStoque =
      typeof info?.nom === 'string' && info.nom
        ? this.accueilClient.buildNomComplet(info)
        : '';
    if (nomStoque) {
      return {
        ...examen,
        patientInfo: {
          ...info,
          nomComplet: nomStoque,
        age:
          this.accueilClient.calculateAge(info.dateNaissance as string) ??
          info.age ??
          null,
        },
        patientName: nomStoque,
      };
    }

    const patientId = (examen.patientId as string) ?? '';
    const chuId =
      ((examen.metadata?.chuId as string) ?? '') ||
      ((info?.chuId as string) ?? '');
    if (!patientId || !chuId) {
      return { ...examen, patientName: '' };
    }

    try {
      const patient = await this.accueilClient.getPatient(patientId, chuId);
      if (patient) {
        const nomComplet = this.accueilClient.buildNomComplet(patient);
        return {
          ...examen,
          patientInfo: {
            ...patient,
            nomComplet,
            age: this.accueilClient.calculateAge(patient.dateNaissance) ?? patient.age ?? null,
          },
          patientName: nomComplet,
        };
      }
    } catch {
      // Accueil indisponible : pas de nom, pas d'ID exposé.
    }
    return { ...examen, patientName: '' };
  }

  /** Enrichit toute une liste avec une concurrence bornée (pas d'appels Accueil en rafale). */
  private async enrichExamensPatient(
    rows: any[],
    ctx?: { serviceName?: string; chuName?: string },
    token?: string,
  ): Promise<any[]> {
    if (rows.length === 0) return rows;
    const results = new Array<any>(rows.length);
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const i = cursor++;
        if (i >= rows.length) return;
        results[i] = this.appliquerContexteAffichage(
          await this.enrichExamenPatient(rows[i], token),
          ctx,
        );
      }
    };
    // Concurrence volontairement faible : Accueil (Render free tier) applique un
    // rate limit (429) si on lui envoie des rafales — 3 workers bornent les appels.
    const CONCURRENCE = 3;
    const workers = Array.from(
      { length: Math.min(CONCURRENCE, rows.length) },
      () => worker(),
    );
    await Promise.all(workers);
    return results;
  }

  @Permissions('anapath:read')
  @Get('notifications/ws-ticket')
  @ApiOperation({
    summary: 'Ticket WebSocket temps réel : renvoie le JWT de la session pour s’authentifier sur la Gateway /anapath',
  })
  @Header('Content-Type', 'application/json; charset=utf-8')
  getWsTicket(@CurrentToken() token?: string) {
    // Le token vient d'être validé par JwtAuthGuard — on le renvoie au navigateur
    // pour qu'il puisse ouvrir le socket (le cookie httpOnly n'est pas lisible en JS).
    return { token };
  }

  @Permissions('anapath:read')
  @Get('notifications/refusees')
  @ApiOperation({ summary: 'Prescriptions refusées (pour affichage dans les rapports)' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  getPrescriptionsRefusees() {
    // Simple statistique de lecture (page Rapports) : pas d'action possible ici,
    // donc pas de restriction au technicien — l'acceptation/refus est elle bloquée.
    return this.notificationService.findRefused();
  }

  @Permissions('anapath:read')
  @Get('notifications/acceptees')
  @ApiOperation({ summary: 'Prescriptions acceptées (pour les statistiques de la page Nouvelles demandes)' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  getPrescriptionsAcceptees() {
    return this.notificationService.findAccepted();
  }

  @Permissions('anapath:read')
  @Post('notifications/stat-alert')
  @ApiOperation({ summary: 'Créer une alerte STAT locale (examen très urgent : arrivée ou 5 minutes restantes)' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  async creerAlerteStat(
    @Body() body: {
      anapathId?: string;
      patientId?: string;
      requestId?: string;
      phase?: 'arrival' | 'remaining';
    },
  ) {
    const phase = body.phase === 'arrival' ? 'arrival' : 'remaining';
    // Garde-fou : une alerte STAT sans examen rattaché (anapathId vide) est du
    // spam (ex. ancien onglet avec l'ancien code front qui postait en boucle).
    // On l'ignore car la dédup ci-dessous ne peut pas la bloquer (anapathId vide
    // ⇒ findActiveByAnapathId renvoie null).
    if (!body.anapathId) return { success: true, ignore: true };
    // Dédup : pas de nouvelle alerte STAT si une alerte non lue (même examen,
    // même phase) existe déjà — évite le spam quand le front poste en boucle.
    const existante =
      await this.notificationService.findActiveByAnapathId(
        body.anapathId,
        NotificationType.STAT_ALERT,
        { phase },
      );
    if (existante) return { success: true, dejaExistant: true };

    const title =
      phase === 'arrival' ? '🚨 NOUVEL EXAMEN STAT' : '🚨 ALERTE STAT';
    const message =
      phase === 'arrival'
        ? `Nouvel examen STAT (TRES URGENT) arrivé - Patient ${body.patientId ?? ''} — délai de 30 min`
        : `Il reste 5 minutes pour l'examen STAT ${body.anapathId ?? ''} - Patient ${body.patientId ?? ''}`;
    await this.notificationService.createNotification({
      type: 'STAT_ALERT',
      title,
      message,
      priority: 'high',
      source: 'Anapath',
      metadata: {
        anapathId: body.anapathId,
        patientId: body.patientId,
        requestId: body.requestId,
        phase,
        timestamp: new Date().toISOString(),
      },
    });
    return { success: true };
  }

  @Permissions('anapath:read')
  @Put('notifications/:id/lire')
  @ApiOperation({ summary: 'Marquer une notification comme lue' })
  @ApiParam({ name: 'id', description: 'UUID de la notification' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  async markAsRead(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const markedLocally = await this.notificationService.markRead(id);
    if (markedLocally) return { success: true };
    const success = await this.notificationClient.markAsRead(id, user.userId);
    return { success };
  }

  @Permissions('anapath:update')
  @Post('notifications/:id/accepter')
  @ApiOperation({ summary: 'Accepter une prescription en attente — la fait entrer dans le fil de travail (réservé au technicien)' })
  @ApiParam({ name: 'id', description: 'UUID de la notification "nouvelle prescription"' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  accepterPrescription(
    @Param('id') id: string,
    @CurrentToken() token: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!isTechnicienUser(user)) throw new ForbiddenException('Réservé au technicien / histotechnicien');
    const ctx = this.decodeAnapathContext(token);
    return this.anapathService
      .accepterPrescription(id, token)
      .then((r) => this.appliquerContexteAffichage(r, ctx));
  }

  @Permissions('anapath:update')
  @Post('notifications/:id/refuser')
  @ApiOperation({ summary: 'Refuser une prescription en attente — motif obligatoire (réservé au technicien)' })
  @ApiParam({ name: 'id', description: 'UUID de la notification "nouvelle prescription"' })
  @ApiBody({ schema: { type: 'object', properties: { motif: { type: 'string' } }, required: ['motif'] } })
  @Header('Content-Type', 'application/json; charset=utf-8')
  async refuserPrescription(
    @Param('id') id: string,
    @Body() body: { motif?: string },
    @CurrentToken() token: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!isTechnicienUser(user)) throw new ForbiddenException('Réservé au technicien / histotechnicien');
    if (!body?.motif?.trim()) {
      throw new BadRequestException('Motif de refus requis');
    }
    await this.anapathService.refuserPrescription(id, body.motif, token);
    return { success: true };
  }

  @Permissions('anapath:read')
  @Get(':id/patient')
  @ApiOperation({
    summary: 'Récupérer les infos patient depuis Accueil',
  })
  @ApiParam({ name: 'id', description: 'UUID de la demande' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  async getPatientForExamen(@Param('id') id: string) {
    const examen = await this.anapathService.findOne(id);
    if (!examen) {
      throw new NotFoundException('Examen non trouvé');
    }

    if (examen.patientInfo?.nom) {
      const info = examen.patientInfo;
      return {
        ...info,
        nomComplet: this.accueilClient.buildNomComplet(info),
        age:
          this.accueilClient.calculateAge(info.dateNaissance as string) ??
          info.age ??
          null,
      };
    }

    const chuId = (examen.metadata?.chuId as string) ?? '';
    if (!chuId) {
      console.warn(`Examen ${id} sans chuId, impossible d'interroger Accueil`);
      return this.fallbackPatient(examen);
    }

    const patient = await this.accueilClient.getPatient(
      examen.patientId,
      chuId,
    );
    if (!patient) {
      return this.fallbackPatient(examen);
    }

    return {
      ...patient,
      nomComplet: this.accueilClient.buildNomComplet(patient),
      age: this.accueilClient.calculateAge(patient.dateNaissance),
    };
  }

  private fallbackPatient(examen: any) {
    return {
      nom: examen.patientId,
      prenom: '',
      nomComplet: examen.patientId,
      age: null,
      sexe: null,
      dateNaissance: null,
      telephone: null,
      adresse: null,
      cin: null,
      _source: 'fallback',
    };
  }

  @Permissions('anapath:read')
  @Get(':id')
  @ApiOperation({ summary: 'Obtenir une demande par son ID' })
  @ApiParam({ name: 'id', description: 'UUID de la demande' })
  @ApiResponse({ status: 200, description: 'Demande trouvée', type: AnapathRequest })
  @ApiResponse({ status: 404, description: 'Demande non trouvée' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  async findOne(@Param('id') id: string, @CurrentToken() token?: string) {
    const examen = await this.anapathService.findOne(id);
    const ctx = this.decodeAnapathContext(token);
    return this.appliquerContexteAffichage(
      await this.enrichExamenPatient(examen, token),
      ctx,
    );
  }

  @Permissions('anapath:update')
  @Patch(':id/notification-lue')
  @ApiOperation({ summary: 'Marquer notif comme lue pour cet examen' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  async marquerNotifLue(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    let examen = await this.anapathService.findByAnapathId(id);
    if (!examen) {
      try {
        examen = await this.anapathService.findOneEntity(id);
      } catch {
        throw new NotFoundException();
      }
    }
    examen.notificationLue = true;
    examen.notificationLueAt = new Date();
    await this.anapathService.save(examen);

    const notifs = await this.notificationClient.getNotificationsForUser(
      user.userId,
      user.roleName,
      this.notificationClient.getAnapathServiceId(),
    );
    const matching = notifs.filter(
      (n: any) =>
        n.metadata?.anapathId === examen.anapathId ||
        n.referenceId === examen.anapathId ||
        n.examId === examen.anapathId,
    );
    await Promise.all(
      matching.map((n: any) => this.notificationClient.markAsRead(n.id ?? n._id, user.userId)),
    );

    return { success: true };
  }

  @Permissions('anapath:update')
  @Patch(':id')
  @ApiOperation({ summary: 'Mettre à jour une demande (résultat, statut)' })
  @ApiParam({ name: 'id', description: 'UUID de la demande' })
  @ApiResponse({ status: 200, description: 'Demande mise à jour', type: AnapathRequest })
  @ApiResponse({ status: 404, description: 'Demande non trouvée' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAnapathDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentToken() token: string,
  ) {
    if (dto.statut === Statut.ANNULEE && !user.permissions.includes('anapath:cancel')) {
      throw new ForbiddenException('Permission refusée');
    }
    // Seul le pathologiste valide un examen (statut VALIDE) : contrôle par
    // nom de rôle ou permission dédiée — le front masque déjà le bouton.
    if (dto.statut === Statut.VALIDE) {
      const isPathologiste =
        /patholog/i.test(user.roleName ?? '') ||
        user.permissions.includes('anapath:validate');
      if (!isPathologiste) {
        throw new ForbiddenException('Validation réservée au pathologiste');
      }
    }
    return this.anapathService.update(id, dto, token);
  }

  // Saisie/auto-save du résultat : réservée aux SECRÉTAIRES et au PATHOLOGISTE
  // (nom de rôle ou permission anapath:observation:write). Le technicien et le
  // major sont refusés — la saisie ne leur est même pas affichée côté front.
  @Patch(':id/resultat')
  @ApiOperation({ summary: "Enregistrer (auto-save) le résultat et la conclusion d'examen — transcription" })
  @ApiParam({ name: 'id', description: 'UUID de la demande' })
  @ApiBody({ type: UpdateResultatDto })
  @ApiResponse({ status: 200, description: 'Résultat mis à jour', type: AnapathRequest })
  @ApiResponse({ status: 404, description: 'Demande non trouvée' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  updateResultat(
    @Param('id') id: string,
    @Body() dto: UpdateResultatDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentToken() token: string,
  ) {
    const autorise =
      /secretair|patholog/i.test(user.roleName ?? '') ||
      user.permissions.includes('anapath:observation:write');
    if (!autorise) {
      throw new ForbiddenException('Saisie du résultat réservée aux secrétaires et au pathologiste');
    }
    return this.anapathService.updateResultat(id, dto, token);
  }

  @Permissions('anapath:update')
  @Patch(':id/examen-speculum')
  @ApiOperation({ summary: "Enregistrer l'examen au spéculum (préalable au résultat pour un FCV/Pap test) — réservé au technicien, prescripteur et préleveur automatiques" })
  @ApiParam({ name: 'id', description: 'UUID de la demande' })
  @ApiBody({ type: UpdateExamenSpeculumDto })
  @ApiResponse({ status: 200, description: 'Examen spéculum enregistré', type: AnapathRequest })
  @ApiResponse({ status: 404, description: 'Demande non trouvée' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  async updateExamenSpeculum(
    @Param('id') id: string,
    @Body() dto: UpdateExamenSpeculumDto,
    @CurrentToken() token: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!isTechnicienUser(user)) throw new ForbiddenException('Réservé au technicien / histotechnicien');
    return this.anapathService.updateExamenSpeculum(id, dto, token);
  }

  @Permissions('anapath:update')
  @Patch(':id/examen-technique')
  @ApiOperation({ summary: "Valider l'examen technique — enregistre le compte rendu libre, bascule la demande en EN_ATTENTE_PATHOLOGUE et notifie le pathologiste (fin du travail du technicien)" })
  @ApiParam({ name: 'id', description: 'UUID de la demande' })
  @ApiBody({ type: UpdateExamenTechniqueDto })
  @ApiResponse({ status: 200, description: 'Examen technique validé', type: AnapathRequest })
  @ApiResponse({ status: 400, description: 'Compte rendu requis ou examen technique déjà validé' })
  @ApiResponse({ status: 404, description: 'Demande non trouvée' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  validerExamenTechnique(
    @Param('id') id: string,
    @Body() dto: UpdateExamenTechniqueDto,
    @CurrentToken() token: string,
  ) {
    return this.anapathService.validerExamenTechnique(id, dto, token);
  }

  @Permissions('anapath:validate')
  @Patch(':id/diagnostic-cytoponction')
  @ApiOperation({ summary: "Valider le diagnostic cytoponction (pathologiste) — site prélevé, organe, fixation ; bascule la demande en EN_COURS et notifie le technicien que le patient est prêt pour un examen technique" })
  @ApiParam({ name: 'id', description: 'UUID de la demande' })
  @ApiBody({ type: UpdateDiagnosticCytoponctionDto })
  @ApiResponse({ status: 200, description: 'Diagnostic cytoponction validé', type: AnapathRequest })
  @ApiResponse({ status: 400, description: 'Site/organe/fixation requis ou diagnostic déjà validé' })
  @ApiResponse({ status: 404, description: 'Demande non trouvée' })
  @Header('Content-Type', 'application/json; charset=utf-8')
  validerDiagnosticCytoponction(
    @Param('id') id: string,
    @Body() dto: UpdateDiagnosticCytoponctionDto,
    @CurrentToken() token: string,
  ) {
    return this.anapathService.validerDiagnosticCytoponction(id, dto, token);
  }

  @Permissions('anapath:validate')
  @Post(':id/validate')
  @ApiOperation({ summary: 'Valider une demande avec signature numérique' })
  @ApiParam({ name: 'id', description: 'UUID de la demande' })
  @ApiBody({ type: ValidateAnapathDto })
  @ApiResponse({ status: 200, description: 'Demande validée avec succès', type: AnapathRequest })
  @ApiResponse({ status: 400, description: 'Validation impossible (déjà validée ou résultat non disponible)' })
  @ApiResponse({ status: 404, description: 'Demande non trouvée' })
  @HttpCode(200)
  @Header('Content-Type', 'application/json; charset=utf-8')
  validate(
    @Param('id') id: string,
    @Body() dto: ValidateAnapathDto,
    @CurrentToken() token: string,
  ) {
    return this.anapathService.validate(id, dto, token);
  }
}
