import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startChain } from './chain.mjs';
import { ProoflaneService, AppError } from './service.mjs';
import { readConfig } from './config.mjs';
import { createSession, readSession, RequestLimiter } from './session.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = { '/': ['index.html','text/html; charset=utf-8'], '/styles.css':['styles.css','text/css; charset=utf-8'], '/app.js':['app.js','text/javascript; charset=utf-8'] };
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };

async function readJson(req) {
  if (!String(req.headers['content-type']).startsWith('application/json')) throw new AppError(415,'CONTENT_TYPE','Use application/json.');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 100000) throw new AppError(413,'BODY_TOO_LARGE','Request exceeds 100 KB.'); chunks.push(chunk); }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError(400,'INVALID_JSON','Malformed JSON body.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(400,'VALIDATION','JSON object required.');
  return value;
}

export function createHttpServer(service, config) {
  const limiter = new RequestLimiter();
  const server = createServer(async (req, res) => {
    const extraHeaders = config.publicMode ? { 'Strict-Transport-Security': 'max-age=31536000' } : {};
    const send = (status, value, type='application/json; charset=utf-8') => { if (res.destroyed) return; res.writeHead(status, { ...headers, ...extraHeaders, 'Content-Type':type }); res.end(type.startsWith('application/json') ? JSON.stringify(value) : value); };
    try {
      const port = server.address()?.port ?? config.port;
      const hosts = new Set(config.publicMode ? [new URL(config.publicOrigin).host] : [`127.0.0.1:${port}`, `localhost:${port}`]);
      const url = new URL(req.url, config.publicOrigin || `http://127.0.0.1:${port}`);
      // Health checks are read-only and need neither a session nor a database/RPC round trip.
      if (req.method === 'GET' && url.pathname === '/api/health') return send(200,{status:'ok',mode:config.mode});
      if (!hosts.has(req.headers.host)) throw new AppError(403,'HOST','Unrecognized host.');
      const origins = config.publicMode ? [config.publicOrigin] : [...hosts].map(h => `http://${h}`);
      if ((req.headers.origin && !origins.includes(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site') throw new AppError(403,'ORIGIN','Cross-origin requests are not allowed.');
      if (req.method === 'GET' && files[url.pathname]) { const [file,type] = files[url.pathname]; return send(200, await readFile(join(root,'web','dist',file)),type); }
      let scope = config.publicMode ? readSession(req.headers.cookie, config.sessionSecret) : 'local';
      if (config.publicMode && url.pathname.startsWith('/api/') && !limiter.allow(scope || 'anonymous')) {
        extraHeaders['Retry-After'] = '60'; throw new AppError(429,'RATE_LIMIT','Too many demo requests. Please wait a minute.');
      }
      if (req.method === 'GET' && ['/api/session','/api/state'].includes(url.pathname)) {
        if (!scope) { const session = createSession(config.sessionSecret); scope = session.scope; extraHeaders['Set-Cookie'] = session.cookie; }
        if (url.pathname === '/api/session') return send(200,{mode:config.mode,session:config.publicMode ? 'guest' : 'local'});
        return send(200,await service.state(scope));
      }
      if (url.pathname.startsWith('/api/') && !scope) throw new AppError(401,'SESSION_REQUIRED','Start a visitor session with GET /api/session before continuing.');
      if (req.method === 'GET' && /^\/api\/receipts\/[\w-]+\/bundle$/.test(url.pathname)) return send(200,await service.bundle(url.pathname.split('/')[3],scope));
      const mutations = { '/api/mandates': d => service.createMandate(d,scope), '/api/execute':d => service.execute(d,scope), '/api/anchor':d => service.anchor(d,scope), '/api/revoke':d => service.revoke(d,scope), '/api/verify':d => service.verify(d) };
      if (req.method === 'POST' && mutations[url.pathname]) {
        if (!['prooflane-v1', ...(config.publicMode ? [] : ['local-demo'])].includes(req.headers['x-prooflane-client'])) throw new AppError(403,'CLIENT_HEADER','X-Prooflane-Client: prooflane-v1 is required.');
        return send(200,await mutations[url.pathname](await readJson(req)));
      }
      send(404,{error:{code:'NOT_FOUND',message:'Route not found.'}});
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      if (status === 500) console.error('Request failed:', config.publicMode ? 'Internal dependency failure; inspect database and RPC health.' : error.shortMessage || error.message);
      if (status === 429 && !extraHeaders['Retry-After']) extraHeaders['Retry-After'] = String(Math.ceil((86400000 - Date.now() % 86400000) / 1000));
      send(status,{error:{code:error instanceof AppError ? error.code : 'INTERNAL',message:error instanceof AppError ? error.message : 'Operation failed. Check server logs and chain state before retrying.'}});
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}

export async function startApplication(options = {}) {
  const config = readConfig({ dataDir: resolve(root, process.env.DATA_DIR || 'data'), ...options });
  const chain = await startChain({ ...config, port: config.chainPort });
  let service;
  try {
    service = new ProoflaneService(chain, config.dataDir, { databaseUrl:config.databaseUrl, publicMode:config.publicMode, poolOptions:options.poolOptions });
    await service.initialize();
    await service.reconcile();
  } catch (error) { if (service) await service.close(); await chain.close(); throw error; }
  const server = createHttpServer(service,config);
  try { await new Promise((res,rej) => { server.once('error',rej); server.listen(config.port,config.host,res); }); }
  catch (error) { await service.close(); await chain.close(); throw error; }
  return { server, service, chain, config, url:config.publicOrigin || `http://127.0.0.1:${server.address().port}`, async close() { await new Promise(resolveClose => server.close(resolveClose)); await service.close(); await chain.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let app;
  try { app = await startApplication(); }
  catch (error) { console.error(process.env.PROOFLANE_MODE === 'base-sepolia' ? 'Public startup failed. Check database, signing identities, RPC, deployment address and block settings.' : error); process.exit(1); }
  console.log(`Prooflane ready: ${app.url}`);
  console.log(`Network: ${app.chain.network.name}; database: ${app.service.store.kind}`);
  console.log(`Contract: ${app.chain.deployment.address}`);
  const stop = async () => { await app.close(); process.exit(0); };
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
}
