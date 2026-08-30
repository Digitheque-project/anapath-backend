import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';

/**
 * Client vers user-services, source officielle des infos utilisateur (nom,
 * prénom, matricule, numéro d'inscription à l'ordre professionnel…). Ces
 * données ne sont plus saisies/stockées localement : elles sont lues ici.
 */
@Injectable()
export class UserServiceClient {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(
    private readonly jwtService: JwtService,
    configService?: ConfigService,
  ) {
    // Passerelle unique du CHU (registre gateway : prefix 'users') au lieu
    // d'un appel direct à user-services.
    this.baseUrl = (
      configService?.get<string>('GATEWAY_URL') ??
      process.env.GATEWAY_URL ??
      configService?.get<string>('USER_SERVICES_URL') ??
      process.env.USER_SERVICES_URL ??
      'https://gateway-bwm4.onrender.com'
    ).replace(/\/$/, '');
    this.timeout = 20000;
  }

  private userIdFromToken(token: string): string | null {
    try {
      const payload = this.jwtService.decode(token) as { userId?: string } | null;
      return payload?.userId ?? null;
    } catch {
      return null;
    }
  }

  /** Fiche utilisateur complète (user-services GET /users/{id}). */
  async getUser(token: string): Promise<any | null> {
    const userId = this.userIdFromToken(token);
    if (!userId) return null;
    try {
      const { data } = await axios.get(`${this.baseUrl}/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout,
      });
      return data ?? null;
    } catch {
      return null;
    }
  }

  /** Fiche d'un utilisateur par ID (ex. le prescripteur d'une prescription),
   *  pas seulement l'utilisateur du token courant. Best-effort : null en échec. */
  async getUserById(token: string, userId?: string): Promise<any | null> {
    if (!userId) return null;
    try {
      const { data } = await axios.get(`${this.baseUrl}/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout,
      });
      return data ?? null;
    } catch {
      return null;
    }
  }

  /** Nom affichable de l'utilisateur du token courant : "prénom nom" (best-effort). */
  async getUserName(token: string): Promise<string | null> {
    return this.getUserNameById(token, this.userIdFromToken(token) ?? undefined);
  }

  /** Nom affichable d'un utilisateur par ID : "prénom nom" (best-effort). */
  async getUserNameById(token: string, userId?: string): Promise<string | null> {
    const user = await this.getUserById(token, userId);
    const firstname =
      typeof user?.firstname === 'string'
        ? user.firstname.trim()
        : typeof user?.firstName === 'string'
          ? user.firstName.trim()
          : '';
    const lastname =
      typeof user?.name === 'string'
        ? user.name.trim()
        : typeof user?.lastname === 'string'
          ? user.lastname.trim()
          : typeof user?.lastName === 'string'
            ? user.lastName.trim()
            : '';
    const full = [firstname, lastname].filter(Boolean).join(' ').trim();
    return full || null;
  }

  /** N° d'ordre (ex. F26945) et n° d'inscription à l'ordre professionnel (ex. ONM-12345),
   *  gérés par user-services. Un seul appel à /users/{id} pour les deux. */
  async getOrdreInfos(token: string): Promise<{
    ordre: string;
    ordreProfessionnel: string;
  }> {
    const user = await this.getUser(token);
    return {
      ordre:
        typeof user?.registration_number_professional_order === 'string'
          ? user.registration_number_professional_order
          : '',
      ordreProfessionnel:
        typeof user?.professional_order === 'string' ? user.professional_order : '',
    };
  }

  /** N° d'inscription à l'ordre professionnel (ONM), géré par user-services. */
  async getOrdreProfessionnel(token: string): Promise<string> {
    const user = await this.getUser(token);
    return typeof user?.professional_order === 'string'
      ? user.professional_order
      : '';
  }
}
