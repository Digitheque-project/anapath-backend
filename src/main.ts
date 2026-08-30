import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { Utf8Interceptor } from './common/interceptors/utf8.interceptor';
import { Utf8Pipe } from './common/pipes/utf8.pipe';
import { getCorsOrigins } from './common/cors-origins';

async function bootstrap() {
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
  
  app.setGlobalPrefix('api');
  
  const config = new DocumentBuilder()
    .setTitle('API Anapath')
    .setDescription('API pour la gestion des examens d\'anatomie pathologique')
    .setVersion('1.0')
    .addTag('anapath', 'Endpoints pour les demandes d\'examen')
    .addTag('notifications', 'Endpoints pour recevoir des notifications')
    .addBearerAuth()
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
  
  const port = process.env.PORT || 3334;
  await app.listen(port);

  const cmsUrl = process.env.GATEWAY_URL ?? process.env.CHU_CMS_SERVICE_URL ?? 'https://gateway-bwm4.onrender.com';
  console.log(`✅ Service CHU configuré : ${cmsUrl}`);

  console.log(`🚀 Backend Anapath démarré sur http://localhost:${port}`);
  console.log(`📚 Documentation Swagger disponible sur http://localhost:${port}/api/docs`);
}
bootstrap();
