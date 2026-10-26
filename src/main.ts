import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { resolveAnapathIdentity } from './config/identity';
import { Utf8Interceptor } from './common/interceptors/utf8.interceptor';
import { Utf8Pipe } from './common/pipes/utf8.pipe';
import { getCorsOrigins } from './common/cors-origins';

async function bootstrap() {
  // Identité Anapath lue dans le registre AVANT de charger les modules : plusieurs
  // fichiers lisent ANAPATH_SERVICE_ID dès leur chargement.
  await resolveAnapathIdentity();
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Relève la limite du body (défaut 100 Ko) : les photos de profil envoyées en
  // base64 dépassent facilement cette limite.
  app.useBodyParser('json', { limit: '15mb' });
  app.useBodyParser('urlencoded', { limit: '15mb', extended: true });

  // Gateway WebSocket temps réel (socket.io) sur le même serveur HTTP que l'API.
  app.useWebSocketAdapter(new IoAdapter(app));

  const corsOrigins = getCorsOrigins();

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });
  
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  
  app.useGlobalPipes(new Utf8Pipe());
  app.useGlobalInterceptors(new Utf8Interceptor());
  
  // Même préfixe que la passerelle (/anapath/...) : le dossier patient et le front
  // joignent le service par GATEWAY_URL/anapath/api/... (avant : /api seul,
  // injoignable par la passerelle).
  app.setGlobalPrefix('anapath/api');
  
  const config = new DocumentBuilder()
    .setTitle('API Anapath')
    .setDescription('API pour la gestion des examens d\'anatomie pathologique')
    .setVersion('1.0')
    .addTag('anapath', 'Endpoints pour les demandes d\'examen')
    .addTag('notifications', 'Endpoints pour recevoir des notifications')
    .addBearerAuth()
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('anapath/api/docs', app, document);
  
  const port = process.env.PORT || 3334;
  await app.listen(port);

  console.log(`✅ Passerelle du CHU : ${process.env.GATEWAY_URL}`);

  console.log(`🚀 Backend Anapath démarré sur http://localhost:${port}`);
  console.log(`📚 Documentation Swagger disponible sur http://localhost:${port}/anapath/api/docs`);
}
bootstrap();
