import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentToken } from '../auth/decorators/current-token.decorator';
import { UploadClient } from '../common/clients/upload.client';

/**
 * Proxy de lecture des fichiers du service d'upload. Le service exige un token ;
 * comme un <img> ne peut pas envoyer d'en-tête, le front pointe vers cette route
 * same-origin, et le backend ajoute l'auth (token de l'utilisateur connecté).
 */
@ApiTags('profile')
@Controller('anapath/files')
export class FilesController {
  constructor(private readonly upload: UploadClient) {}

  @Get(':filename')
  @ApiOperation({ summary: 'Lire un fichier du service d\'upload (proxy authentifié)' })
  async getFile(
    @Param('filename') filename: string,
    @CurrentToken() token: string | undefined,
    @Res() res: Response,
  ) {
    const file = await this.upload.getFile(filename, token);
    if (!file) {
      res.status(404).json({ error: 'Fichier introuvable' });
      return;
    }
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(file.data);
  }
}
