import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { registerRoutes } from './routes.js';
import { runDailyJob } from './vinmonopol.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, bodyLimit: 2 * 1024 * 1024 });
app.decorate('cfg', config);

await app.register(cookie);
await app.register(cors, { origin: config.corsOrigins, credentials: true });

registerRoutes(app);

// Serve built web app in production (SPA fallback)
if (config.serveWeb) {
  const webDist = path.join(config.root, 'web', 'dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.type('text/html').send(fs.createReadStream(path.join(webDist, 'index.html')));
      }
      return reply.code(404).send({ error: 'not_found' });
    });
  } else {
    app.log.warn(`web/dist not found — API only (run "npm run build" first).`);
  }
}

// Daily job: refresh stores + sales (populær badges)
setInterval(() => {
  runDailyJob().catch((e) => app.log.warn(`daily job: ${e.message}`));
}, 24 * 3600 * 1000);
runDailyJob().catch((e) => app.log.warn(`startup sync: ${e.message}`));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (e) {
  app.log.error(e);
  process.exit(1);
}
