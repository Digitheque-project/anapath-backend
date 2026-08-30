import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';

/**
 * Client vers le service d'upload (stockage de fichiers). Auth : soit le JWT de
 * l'utilisateur connecté (forwardé, même écosystème d'auth), soit une clé de
 * service `x-api-key` si `UPLOAD_API_KEY` est défini.
 */
@Injectable()
export class UploadClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeout = 15000;

  constructor(configService?: ConfigService) {
    // Passerelle unique du CHU (registre gateway : prefix 'upload') au lieu
    // d'un appel direct au service d'upload.
    this.baseUrl = (
      configService?.get<string>('GATEWAY_URL') ??
      process.env.GATEWAY_URL ??
      configService?.get<string>('UPLOAD_SERVICE_URL') ??
      process.env.UPLOAD_SERVICE_URL ??
      'https://gateway-bwm4.onrender.com'
    ).replace(/\/$/, '');
    this.apiKey =
      configService?.get<string>('UPLOAD_API_KEY') ??
      process.env.UPLOAD_API_KEY;
  }

  private authHeaders(token?: string): Record<string, string> {
    if (token) return { Authorization: `Bearer ${token}` };
    if (this.apiKey) return { 'x-api-key': this.apiKey };
    return {};
  }

  /** Envoie un fichier ; renvoie le nom/identifiant stocké par le service (ou null). */
  async uploadFile(
    file: Buffer,
    filename: string,
    contentType: string,
    token?: string,
  ): Promise<string | null> {
    try {
      const form = new FormData();
      form.append('file', file, { filename, contentType });
      const { data } = await axios.post(`${this.baseUrl}/files`, form, {
        headers: { ...form.getHeaders(), ...this.authHeaders(token) },
        timeout: this.timeout,
        maxBodyLength: Infinity,
      });
      // Forme de réponse non documentée : on tente les clés les plus courantes.
      return (
        data?.filename ??
        data?.name ??
        data?.file ??
        data?.id ??
        (typeof data === 'string' ? data : null)
      );
    } catch (e) {
      console.warn(
        'UploadClient.uploadFile échoué:',
        e instanceof Error ? e.message : e,
      );
      return null;
    }
  }

  /** Récupère le binaire d'un fichier (pour le proxy d'affichage). */
  async getFile(
    filename: string,
    token?: string,
  ): Promise<{ data: Buffer; contentType: string } | null> {
    try {
      const res = await axios.get(
        `${this.baseUrl}/files/${encodeURIComponent(filename)}`,
        {
          headers: this.authHeaders(token),
          responseType: 'arraybuffer',
          timeout: this.timeout,
        },
      );
      return {
        data: Buffer.from(res.data),
        contentType:
          (res.headers['content-type'] as string) ?? 'application/octet-stream',
      };
    } catch (e) {
      console.warn(
        'UploadClient.getFile échoué:',
        e instanceof Error ? e.message : e,
      );
      return null;
    }
  }
}
