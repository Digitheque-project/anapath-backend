import { NotificationType } from '../notification/dto/receive-notification.dto';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';

/**
 * Ciblage des notifications par rôle. Une notification portant un groupe de
 * destinataire (metadata.recipientRole, ou déduit du type) n'est visible que
 * pour les utilisateurs de CE groupe — le major, le secrétaire, etc. (« autre »)
 * ne reçoivent jamais une notification destinée au technicien ou au pathologiste.
 */

export type RecipientGroup = 'technicien' | 'pathologiste' | 'major' | 'autre';

export function isTechnicienRole(
  roleName?: string,
  permissions?: string[],
): boolean {
  if (roleName) {
    if (/technicien/i.test(roleName)) return true;
    if (/major|chef|patholog|secretair/i.test(roleName)) return false;
  }
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

export function isChefRole(roleName?: string): boolean {
  return !!roleName && /chef/i.test(roleName);
}

export function isPathologisteRole(
  roleName?: string,
  permissions?: string[],
): boolean {
  if (roleName) {
    if (/patholog/i.test(roleName)) return true;
    if (/major|chef|technicien|secretair/i.test(roleName)) return false;
  }
  if (!permissions) return false;
  return (
    permissions.includes('anapath:validate') &&
    permissions.includes('anapath:observation:write')
  );
}

/** Groupe de destinataires effectif d'un utilisateur. Le major a son propre groupe. */
export function userRecipientGroup(
  user?: AuthenticatedUser | null,
): RecipientGroup {
  if (!user) return 'autre';
  if (isMajorRole(user.roleName)) return 'major';
  if (isTechnicienRole(user.roleName, user.permissions)) return 'technicien';
  if (isPathologisteRole(user.roleName, user.permissions)) return 'pathologiste';
  return 'autre';
}

/**
 * Groupes de destinataires d'une notification (undefined = notification
 * générique destinée à tout le monde, hors major).
 */
export function notificationRecipientGroups(
  notification: any,
): RecipientGroup[] | undefined {
  const metadata = notification?.metadata ?? {};
  const rt = metadata.recipientRole;
  if (rt === 'technicien') return ['technicien'];
  if (rt === 'pathologiste') return ['pathologiste'];
  if (rt === 'major') return ['major'];
  const type = notification?.type ?? metadata.type;
  if (
    type === NotificationType.NOUVELLE_PRESCRIPTION ||
    type === NotificationType.PATIENT_PRET_EXAMEN_TECHNIQUE
  ) {
    return ['technicien'];
  }
  if (type === NotificationType.EXAMEN_TECHNIQUE_TERMINE) {
    return ['pathologiste'];
  }
  if (type === NotificationType.STAT_ALERT) {
    return ['technicien', 'pathologiste'];
  }
  if (type === NotificationType.RAPPORT_HEBDOMADAIRE || type === 'RAPPORT') {
    return ['major'];
  }
  return undefined;
}

/** La notification doit-elle être visible / poussée pour cet utilisateur ? */
export function shouldNotifyUser(
  notification: any,
  user?: AuthenticatedUser | null,
): boolean {
  if (!user) return false;
  const type = notification?.type ?? notification?.metadata?.type;
  const isReport =
    type === NotificationType.RAPPORT_HEBDOMADAIRE || type === 'RAPPORT';
  // Le major et le chef de service (« consultation ») reçoivent les
  // notifications du rapport hebdomadaire : le major télécharge, le chef
  // consulte. Ils ne reçoivent JAMAIS les alertes STAT ni les notifications
  // destinées au technicien/pathologiste.
  if (isMajorRole(user.roleName) || isChefRole(user.roleName)) {
    return isReport;
  }
  const groups = notificationRecipientGroups(notification);
  if (!groups) return true;
  return groups.includes(userRecipientGroup(user));
}