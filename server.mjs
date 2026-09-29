// Vercel captures server.listen() when it imports this entry point.
// npm start keeps the standalone/local entry point in src/server.mjs.
import { attachDatabasePool } from '@vercel/functions';
import { runApplication } from './src/server.mjs';

await runApplication({ attachPool: attachDatabasePool, poolOptions: { idleTimeoutMillis: 5000 } });
