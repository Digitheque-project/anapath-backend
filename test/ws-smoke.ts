import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { io } from 'socket.io-client';
import { NotificationsGateway } from '../src/notifications/notifications.gateway';
import { AuthClient } from '../src/auth/clients/auth.client';

const fakeAuth = {
  validateToken: async (token: string) =>
    token === 'ok-token'
      ? {
          userId: 'u1',
          name: 'Test',
          firstname: 'Major',
          email: 't@t.t',
          roleName: 'Major',
          permissions: ['anapath:read'],
        }
      : null,
};

@Module({
  providers: [
    { provide: AuthClient, useValue: fakeAuth },
    NotificationsGateway,
  ],
})
class TestModule {}

const PORT = 3999;
const NS = `http://localhost:${PORT}/anapath`;

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const app = await NestFactory.create(TestModule, { logger: false });
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(PORT);
  await delay(500);

  const gateway = app.get(NotificationsGateway);

  // 1. Connexion avec un token INVALIDE → doit être rejetée (disconnect).
  const bad = io(NS, {
    transports: ['websocket'],
    auth: { token: 'bad-token' },
    reconnection: false,
    timeout: 3000,
  });
  await new Promise<void>((resolve) => {
    bad.on('connect', () => resolve());
    bad.on('disconnect', () => resolve());
    bad.on('connect_error', () => resolve());
  });
  await delay(300);
  console.log('bad-token connected?', bad.connected, '(attendu: false)');
  bad.close();

  // 2. Connexion avec un token VALIDE → doit rester connecté et recevoir le broadcast.
  const good = io(NS, {
    transports: ['websocket'],
    auth: { token: 'ok-token' },
    reconnection: false,
    timeout: 3000,
  });
  const received: string[] = [];
  good.on('notification:new', (payload) => {
    received.push(payload?.id);
  });

  const goodConnected = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 5000);
    good.on('connect', () => {
      clearTimeout(t);
      resolve(true);
    });
    good.on('connect_error', () => {
      clearTimeout(t);
      resolve(false);
    });
  });
  console.log('ok-token connected?', goodConnected, '(attendu: true)');

  // 3. Broadcast via emitNotificationCreated → doit être reçu par le client valide.
  await delay(300);
  gateway.emitNotificationCreated({ id: 'n-1', type: 'NOUVELLE_PRESCRIPTION' });
  await delay(500);
  console.log('broadcast reçu?', JSON.stringify(received), '(attendu: ["n-1"])');

  good.close();
  await app.close();

  const ok =
    bad.connected === false &&
    goodConnected === true &&
    received.includes('n-1');
  console.log(ok ? 'SMOKE TEST PASSED' : 'SMOKE TEST FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
