import { config } from './config.ts';
import { migrate } from './db/db.ts';
import { buildApp } from './http/app.ts';
import { registerJobs } from './jobs/kinds.ts';
import { startRunner, stopRunner } from './jobs/runner.ts';
import { sweepUploads } from './services/inputs.ts';
import { seedRules } from './services/rules.ts';

migrate();
seedRules();
registerJobs();

const app = await buildApp();
await app.listen({ host: config.host, port: config.port });
startRunner();
setInterval(() => void sweepUploads(), 6 * 3600_000).unref();
console.log(`Content Studio ${config.version} on http://${config.host}:${config.port} (data in ${config.dataDir})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await stopRunner();
    await app.close();
    process.exit(0);
  });
}
