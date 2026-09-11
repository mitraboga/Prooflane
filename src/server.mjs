import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startChain } from './chain.mjs';
import { ProoflaneService, AppError } from './service.mjs';

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

export async function startApplication({ port = Number(process.env.PORT || 3000), chainPort = Number(process.env.CHAIN_PORT || 8545), dataDir = resolve(root, process.env.DATA_DIR || 'data') } = {}) {
  const chain = await startChain({ dataDir, port: chainPort });
  const service = new ProoflaneService(chain, dataDir);
  await service.reconcile();
  let actualPort = port;
  const server = createServer(async (req, res) => {
    const send = (status, value, type='application/json; charset=utf-8') => { res.writeHead(status, { ...headers, 'Content-Type':type }); res.end(type.startsWith('application/json') ? JSON.stringify(value) : value); };
    try {
      const hosts = new Set([`127.0.0.1:${actualPort}`,`localhost:${actualPort}`]);
      if (!hosts.has(req.headers.host)) throw new AppError(403,'HOST','Unrecognized local host.');
      if (req.headers.origin && ![...hosts].map(h => `http://${h}`).includes(req.headers.origin)) throw new AppError(403,'ORIGIN','Cross-origin requests are not allowed.');
      const url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
      if (req.method === 'GET' && files[url.pathname]) { const [file,type] = files[url.pathname]; return send(200, await readFile(join(root,'web','dist',file)),type); }
      if (req.method === 'GET' && url.pathname === '/api/health') return send(200,{status:'ok',mode:'local-evm'});
      if (req.method === 'GET' && url.pathname === '/api/state') return send(200,await service.state());
      if (req.method === 'GET' && /^\/api\/receipts\/[\w-]+\/bundle$/.test(url.pathname)) return send(200,await service.bundle(url.pathname.split('/')[3]));
      const mutations = { '/api/mandates': d => service.createMandate(d), '/api/execute':d => service.execute(d), '/api/anchor':d => service.anchor(d), '/api/revoke':d => service.revoke(d), '/api/verify':d => service.verify(d) };
      if (req.method === 'POST' && mutations[url.pathname]) {
        if (req.headers['x-prooflane-client'] !== 'local-demo') throw new AppError(403,'CLIENT_HEADER','X-Prooflane-Client: local-demo is required.');
        return send(200,await mutations[url.pathname](await readJson(req)));
      }
      send(404,{error:{code:'NOT_FOUND',message:'Route not found.'}});
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      if (status === 500) console.error('Request failed:', error.shortMessage || error.message);
      send(status,{error:{code:error instanceof AppError ? error.code : 'INTERNAL',message:error instanceof AppError ? error.message : 'Operation failed. Check server logs and chain state before retrying.'}});
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  try { await new Promise((res,rej) => { server.once('error',rej); server.listen(port,'127.0.0.1',res); }); }
  catch (error) { await service.close(); await chain.close(); throw error; }
  actualPort = server.address().port;
  return { server, service, chain, url:`http://127.0.0.1:${actualPort}`, async close() { await new Promise(resolveClose => server.close(resolveClose)); await service.close(); await chain.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startApplication();
  console.log(`Prooflane ready: ${app.url}`);
  console.log(`Ethereum RPC: http://127.0.0.1:${process.env.CHAIN_PORT || 8545} (publicly known DEVELOPMENT accounts)`);
  console.log(`Contract: ${app.chain.deployment.address}`);
  const stop = async () => { await app.close(); process.exit(0); };
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
}
