import { NotificationType } from '../notification/dto/receive-notification.dto';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';

/**
 * Ciblage des notifications par rôle. Une notification portant un groupe de
 * destinataire (metadata.recipientRole, ou déduit du type) n'est visible que
 * pour les utilisateurs de CE groupe — le major, le secrétaire, etc. (« autre »)
 * ne reçoivent jamais une notification destinée au technicien ou au pathologiste.
 */

export type RecipientGroup = 'technicien' | 'pathologiste' | 'autre';

export function isTechnicienRole(
  roleName?: string,
  permissions?: string[],
): boolean {
  if (roleName && /technicien/i.test(roleName)) return true;
  if (!permissions) return false;
  return (
    permissions.includes('anapath:update') &&
    !permissions.includes('anapath:validate') &&
    !permissions.includes('anapath:observation:write')
  );
}

export function isMajorRole(roleName?: string): boolean {
  return !!roleName && /major/i.test(roleName);
}

export function isPathologisteRole(
  roleName?: string,
  permissions?: string[],
): boolean {
  if (roleName && /patholog/i.test(roleName)) return true;
  if (!permissions) return false;
  return (
    permissions.includes('anapath:validate') &&
    permissions.includes('anapath:observation:write')
  );
}

/** Groupe de destinataires effectif d'un utilisateur. Le major est « autre ». */
export function userRecipientGroup(
  user?: AuthenticatedUser | null,
): RecipientGroup {
  if (!user) return 'autre';
  if (isMajorRole(user.roleName)) return 'autre';
  if (isTechnicienRole(user.roleName, user.permissions)) return 'technicien';
  if (isPathologisteRole(user.roleName, user.permissions)) return 'pathologiste';
  return 'autre';
}

/** Groupe de destinataires d'une notification (undefined = destinée à tous). */
export function notificationRecipientGroup(
  notification: any,
): RecipientGroup | undefined {
  const metadata = notification?.metadata ?? {};
  if (metadata.recipientRole === 'technicien') return 'technicien';
  if (metadata.recipientRole === 'pathologiste') return 'pathologiste';
  if (metadata.recipientRole === 'major') return 'autre';
  const type = notification?.type ?? metadata.type;
  if (
    type === NotificationType.NOUVELLE_PRESCRIPTION ||
    type === NotificationType.PATIENT_PRET_EXAMEN_TECHNIQUE
  ) {
    return 'technicien';
  }
  if (type === NotificationType.EXAMEN_TECHNIQUE_TERMINE) {
    return 'pathologiste';
  }
  return undefined;
}

/** La notification doit-elle être visible / poussée pour cet utilisateur ? */
export function shouldNotifyUser(
  notification: any,
  user?: AuthenticatedUser | null,
): boolean {
  // Le major ne reçoit QUE la notification du rapport hebdomadaire : pas les
  // alertes STAT ni les notifications internes du service.
  if (isMajorRole(user?.roleName)) {
    const type = notification?.type ?? notification?.metadata?.type;
    return (
      type === NotificationType.RAPPORT_HEBDOMADAIRE || type === 'RAPPORT'
    );
  }
  // Ciblage EXCLUSIF vers le major : seuls les utilisateurs « major » voient la
  // notification (le groupe « autre » est partagé avec le secrétaire, il faut
  // donc filtrer explicitement pour que la secrétaire ne reçoive pas le rapport
  // qu'elle vient elle-même d'envoyer).
  if ((notification?.metadata?.recipientRole ?? '') === 'major') {
    return isMajorRole(user?.roleName);
  }
  const group = notificationRecipientGroup(notification);
  if (!group) return true;
  return userRecipientGroup(user) === group;
}
