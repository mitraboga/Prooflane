import { resolve } from 'node:path';

const integer = (value, fallback, min, max, label) => {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  return n;
};

export function readConfig(options = {}, env = process.env) {
  const mode = options.mode ?? env.PROOFLANE_MODE ?? 'local';
  if (!['local', 'base-sepolia'].includes(mode)) throw new Error('PROOFLANE_MODE must be local or base-sepolia.');
  const publicMode = mode === 'base-sepolia';
  const publicOrigin = options.publicOrigin ?? env.PUBLIC_ORIGIN ?? env.RENDER_EXTERNAL_URL ?? '';
  const databaseUrl = options.databaseUrl ?? env.DATABASE_URL;
  const sessionSecret = options.sessionSecret ?? env.SESSION_SECRET;
  if (publicMode) {
    let origin;
    try { origin = new URL(publicOrigin); } catch { throw new Error('PUBLIC_ORIGIN must be an HTTPS origin.'); }
    if (origin.protocol !== 'https:' || origin.origin !== publicOrigin || origin.username || origin.password) throw new Error('PUBLIC_ORIGIN must be the exact HTTPS origin without a trailing slash.');
    if (!databaseUrl) throw new Error('Public mode requires DATABASE_URL for persistent PostgreSQL storage.');
    // Render generates 32 random bytes as base64 (44 characters with padding).
    if (typeof sessionSecret !== 'string' || sessionSecret.length < 43) throw new Error('Public mode requires SESSION_SECRET with at least 43 random characters; use a 256-bit generated secret.');
  }
  return {
    mode, publicMode, publicOrigin, databaseUrl, sessionSecret,
    port: integer(options.port ?? env.PORT, 3000, 0, 65535, 'PORT'),
    chainPort: integer(options.chainPort ?? env.CHAIN_PORT, 8545, 0, 65535, 'CHAIN_PORT'),
    dataDir: resolve(options.dataDir ?? env.DATA_DIR ?? 'data'),
    host: publicMode ? '0.0.0.0' : '127.0.0.1',
    rpcUrl: options.rpcUrl ?? env.RPC_URL,
    contractAddress: options.contractAddress ?? env.CONTRACT_ADDRESS,
    deploymentBlock: integer(options.deploymentBlock ?? env.DEPLOYMENT_BLOCK, 0, 0, Number.MAX_SAFE_INTEGER, 'DEPLOYMENT_BLOCK'),
    ownerPrivateKey: options.ownerPrivateKey ?? env.OWNER_PRIVATE_KEY,
    agentPrivateKey: options.agentPrivateKey ?? env.AGENT_PRIVATE_KEY,
    confirmations: integer(options.confirmations ?? env.CONFIRMATIONS, publicMode ? 3 : 1, 1, 64, 'CONFIRMATIONS'),
  };
}
