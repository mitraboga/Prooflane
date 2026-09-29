// Vercel captures server.listen() when it imports this entry point.
// npm start keeps the standalone/local entry point in src/server.mjs.
import { attachDatabasePool } from '@vercel/functions';
import { runApplication } from './src/server.mjs';

let pool;
await runApplication({ attachPool: value => { pool = value; }, poolOptions: { idleTimeoutMillis: 5000 } });
// Startup migrations run before Vercel creates a request scope. Register after
// startup so connection releases can use the actual request's lifecycle.
if (pool) attachDatabasePool(pool);
