// Vercel imports this handler immediately; dependency initialization happens
// inside the first request. npm start keeps the standalone/local entry point.
import { attachDatabasePool } from '@vercel/functions';
import { createApplicationHandler } from './src/server.mjs';

export default createApplicationHandler({ attachPool: attachDatabasePool, poolOptions: { idleTimeoutMillis: 5000 } });
