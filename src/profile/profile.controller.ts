import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentToken } from '../auth/decorators/current-token.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import { ProfileService } from './profile.service';
import { UploadClient } from '../common/clients/upload.client';
import { UserServiceClient } from '../common/clients/user-service.client';
import { UserProfile } from './user-profile.entity';

// Gardes globales (JwtAuthGuard + PermissionsGuard) : token requis, pas de
// permission spéciale — chaque utilisateur gère SON propre profil.
@ApiTags('profile')
@Controller('anapath/profile')
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly upload: UploadClient,
    private readonly userService: UserServiceClient,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Profil (bio + photo) de l\'utilisateur connecté' })
  async getMine(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentToken() token?: string,
  ) {
    return this.toResponse(await this.profile.get(user.userId), token);
  }

  @Patch()
  @ApiOperation({ summary: 'Mettre à jour la bio' })
  async updateBio(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentToken() token: string | undefined,
    @Body()
    body: { bio?: string },
  ) {
    let p = await this.profile.get(user.userId);
    if (body?.bio !== undefined) {
      p = await this.profile.updateBio(user.userId, body.bio);
    }
    return this.toResponse(p, token);
  }

  @Post('avatar')
  @ApiOperation({ summary: 'Importer/modifier la photo de profil (base64)' })
  async uploadAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentToken() token: string | undefined,
    @Body() body: { filename?: string; contentType?: string; data?: string },
  ) {
    if (!body?.data) {
      return { error: 'Aucun fichier fourni' };
    }
    const buffer = Buffer.from(body.data, 'base64');
    const stored = await this.upload.uploadFile(
      buffer,
      body.filename ?? `avatar-${user.userId}.jpg`,
      body.contentType ?? 'image/jpeg',
      token,
    );
    if (!stored) {
      return { error: "Échec de l'envoi de la photo au service d'upload" };
    }
    return this.toResponse(await this.profile.setAvatar(user.userId, stored), token);
  }

  private async toResponse(p: UserProfile, token?: string) {
    // Données utilisateur générées par user-services (source officielle) :
    // `ordre` = n° d'ordre (ex. F26945) et `ordreProfessionnel` = n°
    // d'inscription à l'ordre professionnel (ex. ONM-12345). Plus rien à
    // saisir/stocker localement.
    const { ordre, ordreProfessionnel } = await this.userService.getOrdreInfos(
      token ?? '',
    );
    return {
      userId: p.userId,
      bio: p.bio ?? '',
      ordre,
      ordreProfessionnel,
      avatarFilename: p.avatarFilename ?? null,
      // URL same-origin : le proxy front + le backend ajoutent l'auth pour lire le fichier.
      avatarUrl: p.avatarFilename
        ? `/api/anapath/files/${encodeURIComponent(p.avatarFilename)}`
        : null,
    };
  }
}
