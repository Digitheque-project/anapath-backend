import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import axios from 'axios';
import { AuthenticatedUser } from '../types/authenticated-user.interface';

interface AnapathServiceClaim {
  serviceId: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

interface JwtPayload {
  userId: string;
  name: string;
  firstname: string;
  email: string;
  services?: AnapathServiceClaim[];
  exp?: number;
}

interface CacheEntry {
  user: AuthenticatedUser;
  expiresAtMs: number;
}

@Injectable()
export class AuthClient {
  private readonly userServicesUrl: string;
  private readonly anapathServiceId: string;
  private readonly cacheTtlMs: number;
  private readonly timeout: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly jwtService: JwtService,
    configService?: ConfigService,
  ) {
    this.userServicesUrl = (
      configService?.get<string>('USER_SERVICES_URL') ??
      process.env.USER_SERVICES_URL ??
      'https://user-services-0sze.onrender.com'
    ).replace(/\/$/, '');
    this.anapathServiceId =
      configService?.get<string>('AUTH_ANAPATH_SERVICE_ID') ??
      process.env.AUTH_ANAPATH_SERVICE_ID ??
      '9e73904c-71e5-4477-9280-513e4112a468';
    this.cacheTtlMs = Number(
      configService?.get<string>('AUTH_TOKEN_CACHE_TTL_MS') ??
        process.env.AUTH_TOKEN_CACHE_TTL_MS ??
        60000,
    );
    // user-services (Render free tier) peut mettre plusieurs secondes à répondre après
    // une période d'inactivité (cold start) — un timeout trop court ici rejette à tort
    // des tokens valides en 401. 5s d'origine était trop court, cause de 401 intermittents.
    this.timeout = Number(
      configService?.get<string>('AUTH_VALIDATE_TIMEOUT_MS') ??
        process.env.AUTH_VALIDATE_TIMEOUT_MS ??
        20000,
    );
  }

  async validateToken(token: string): Promise<AuthenticatedUser | null> {
    const cacheKey = createHash('sha256').update(token).digest('hex');
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.user;
    }

    const payload = this.jwtService.decode(token) as JwtPayload | null;
    if (!payload?.userId || !Array.isArray(payload.services)) {
      return null;
    }
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return null;
    }

    const matched = payload.services.find(
      (s) => s.serviceId === this.anapathServiceId,
    );
    if (!matched) {
      return null;
    }

    let userRecord: any;
    try {
      const { data } = await axios.get(
        `${this.userServicesUrl}/users/${payload.userId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout,
        },
      );
      userRecord = data;
    } catch (e) {
      console.warn(
        `AuthClient.validateToken: échec de vérification live auprès de user-services (${(e as Error)?.message ?? e})`,
      );
      return null;
    }

    const stillAssigned = (userRecord?.serviceRoles ?? []).some(
      (sr: any) =>
        sr.serviceId === this.anapathServiceId && sr.roleId === matched.roleId,
    );
    if (!stillAssigned) {
      return null;
    }

    const user: AuthenticatedUser = {
      userId: payload.userId,
      name: payload.name,
      firstname: payload.firstname,
      email: payload.email,
      roleName: matched.roleName,
      permissions: matched.permissions ?? [],
    };

    this.cache.set(cacheKey, {
      user,
      expiresAtMs: Date.now() + this.cacheTtlMs,
    });

    return user;
  }
}
