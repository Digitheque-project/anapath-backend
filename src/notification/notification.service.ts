import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity } from './notification.entity';
import { NotificationType } from './dto/receive-notification.dto';
import { NotificationsGateway } from '../notifications/notifications.gateway';

@Injectable()
export class NotificationService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(NotificationEntity)
    private notificationRepository: Repository<NotificationEntity>,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  /** Au démarrage, nettoie les notifications indésirables (relances de validation) et les doublons. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.nettoyerNotifications();
    } catch (e) {
      console.warn('Nettoyage des notifications échoué:', e);
    }
  }

  async createNotification(data: {
    type: NotificationType | string;
    title: string;
    message: string;
    priority?: string;
    source?: string;
    metadata?: Record<string, any>;
  }) {
    const notification = this.notificationRepository.create({
      type: data.type as NotificationType,
      title: data.title,
      message: data.message,
      priority: data.priority || 'medium',
      source: data.source || 'Anapath',
      metadata: data.metadata || {},
      read: false,
    });
    const saved = await this.notificationRepository.save(notification);
    // Push temps réel vers les navigateurs connectés (event `notification:new`).
    // Jamais bloquant : si la Gateway est indisponible, l'event est simplement perdu.
    try {
      await this.notificationsGateway.emitNotificationCreated(saved);
    } catch (e) {
      console.warn('Notification push temps réel échoué:', e);
    }
    return saved;
  }

  async findAll(): Promise<NotificationEntity[]> {
    return this.notificationRepository.find({ order: { createdAt: 'DESC' }, take: 50 });
  }

  async findUnread(): Promise<NotificationEntity[]> {
    return this.notificationRepository.find({
      where: { read: false },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Prescriptions encore en attente d'acceptation ou de refus — quel que soit
   * l'état « lu ». Indépendant de la lecture : « tout marquer lu » ne fait pas
   * disparaître une demande de la page « Nouvelles demandes ».
   */
  async findPending(): Promise<NotificationEntity[]> {
    const all = await this.notificationRepository.find({
      where: { type: NotificationType.NOUVELLE_PRESCRIPTION },
      order: { createdAt: 'DESC' },
    });
    return all.filter((n) => !n.metadata?.outcome);
  }

  async findOne(id: string): Promise<NotificationEntity | null> {
    return this.notificationRepository.findOne({ where: { id } });
  }

  /** Marque une notification locale générique (rapport hebdo, relance, ...) comme lue. */
  async markRead(id: string): Promise<boolean> {
    const notification = await this.findOne(id);
    if (!notification) return false;
    notification.read = true;
    await this.notificationRepository.save(notification);
    return true;
  }

  /**
   * Notification "nouvelle prescription" déjà créée pour cette demande, SI ELLE
   * EXISTE — quel que soit son état (lue ou non, acceptée ou refusée).
   *
   * C'est LE garde-fou anti-doublons du pull des prescriptions : une demande
   * déjà connue (y compris marquée « lue » ou refusée) ne doit JAMAIS générer une
   * nouvelle notification. Si on filtrait sur `read: false`, « tout marquer lu »
   * ferait ré-apparaître la demande au pull suivant (cron 15 min + re-pull socket).
   */
  async findPendingByDemandeId(demandeId: string): Promise<NotificationEntity | null> {
    const all = await this.notificationRepository.find({
      where: { type: NotificationType.NOUVELLE_PRESCRIPTION },
    });
    return all.find((n) => n.metadata?.demandeId === demandeId) ?? null;
  }

  /**
   * Existe-t-il déjà une notification non lue de ce type pour cet anapathId ?
   * Utilisé pour éviter les doublons (cron de relance, alertes STAT) : le rappel
   * n'est recréé que si aucune notification active existe déjà pour l'examen.
   * `metadataMatch` filtre en plus sur des champs du metadata (ex. phase).
   */
  async findActiveByAnapathId(
    anapathId: string | null | undefined,
    type?: string,
    metadataMatch?: Record<string, unknown>,
  ): Promise<NotificationEntity | null> {
    if (!anapathId) return null;
    const active = await this.notificationRepository.find({
      where: { read: false },
    });
    return (
      active.find(
        (n) =>
          n.metadata?.anapathId === anapathId &&
          (!type || n.type === type) &&
          Object.entries(metadataMatch ?? {}).every(
            ([k, v]) => n.metadata?.[k] === v,
          ),
      ) ?? null
    );
  }

  /**
   * Nettoyage au démarrage : les rappels de validation génériques
   * (RAPPEL_VALIDATION) sont supprimés en totalité — le service n'en génère
   * plus (seules les nouvelles demandes, les notifications internes et l'alerte
   * extemporané STAT restent). Les alertes STAT sont dédupliquées : pour un même
   * examen et une même phase (arrival/remaining), seule la plus récente est
   * conservée. Les notifications "nouvelle prescription" sont aussi dédupliquées
   * par demande (une seule notification conservée par demandeId, la plus récente) :
   * des doublons accumulés par d'anciennes versions faisaient échouer
   * l'acceptation (contrainte UNIQUE sur demandeId → 500).
   */
  async nettoyerNotifications(): Promise<number> {
    const all = await this.notificationRepository.find({
      order: { createdAt: 'DESC' },
    });
    const latestByDemande = new Map<string, NotificationEntity>();
    for (const n of all) {
      if (n.type !== NotificationType.NOUVELLE_PRESCRIPTION) continue;
      const demandeId = n.metadata?.demandeId as string | undefined;
      if (!demandeId) continue;
      const cur = latestByDemande.get(demandeId);
      const at = n.createdAt?.getTime() ?? 0;
      if (!cur || at > (cur.createdAt?.getTime() ?? 0)) {
        latestByDemande.set(demandeId, n);
      }
    }
    const keepIds = new Set(
      [...latestByDemande.values()].map((n) => n.id),
    );
    const seen = new Set<string>();
    let removed = 0;
    for (const n of all) {
      // Plus aucun rappel de validation générique : on supprime tout.
      if (n.type === NotificationType.RAPPEL_VALIDATION) {
        await this.notificationRepository.remove(n);
        removed++;
        continue;
      }
      if (n.type === NotificationType.NOUVELLE_PRESCRIPTION) {
        if (!n.metadata?.demandeId || !keepIds.has(n.id)) {
          await this.notificationRepository.remove(n);
          removed++;
        }
        continue;
      }
      if (n.type !== NotificationType.STAT_ALERT) continue;

      const aid = n.metadata?.anapathId;
      // Alerte STAT sans examen rattaché = spam sans objet (ex. anciennes
      // alertes postées pour des prescriptions en attente) : on la supprime.
      if (!aid) {
        await this.notificationRepository.remove(n);
        removed++;
        continue;
      }
      const key = `STAT_ALERT|${aid}|${n.metadata?.phase ?? ''}`;
      if (seen.has(key)) {
        await this.notificationRepository.remove(n);
        removed++;
      } else {
        seen.add(key);
      }
    }
    if (removed > 0) {
      console.log(`🧹 Notifications nettoyées : ${removed} suppression(s)`);
    }
    return removed;
  }

  /** Marque une notification "nouvelle prescription" comme traitée (acceptée/refusée) — jamais supprimée, garde une trace. */
  async markResolved(
    id: string,
    outcome: 'ACCEPTEE' | 'REFUSEE',
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const notification = await this.findOne(id);
    if (!notification) return;
    notification.read = true;
    notification.metadata = {
      ...(notification.metadata ?? {}),
      outcome,
      resolvedAt: new Date().toISOString(),
      ...extra,
    };
    await this.notificationRepository.save(notification);
  }

  /** Prescriptions refusées (pour affichage dans les rapports) — traitées, outcome = REFUSEE. */
  async findRefused(): Promise<NotificationEntity[]> {
    return this.findByOutcome('REFUSEE');
  }

  /** Prescriptions acceptées — traitées, outcome = ACCEPTEE. */
  async findAccepted(): Promise<NotificationEntity[]> {
    return this.findByOutcome('ACCEPTEE');
  }

  private async findByOutcome(outcome: 'ACCEPTEE' | 'REFUSEE'): Promise<NotificationEntity[]> {
    const resolved = await this.notificationRepository.find({
      where: { type: NotificationType.NOUVELLE_PRESCRIPTION, read: true },
      order: { createdAt: 'DESC' },
    });
    return resolved.filter((n) => n.metadata?.outcome === outcome);
  }
}