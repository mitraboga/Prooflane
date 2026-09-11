import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, mkdir, mkdtemp, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonRpcProvider } from 'ethers';

// Standard public development mnemonic. NEVER fund these accounts on public chains.
export const DEV_MNEMONIC = 'test test test test test test test test test test test junk';
const require = createRequire(import.meta.url);
const STATE_SCHEMA = 'prooflane.anvil-state.v1';

/** Resolve the native binary installed by the pinned official npm distribution. */
async function binaryPath() {
  const architecture = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!architecture || !['win32', 'linux', 'darwin'].includes(process.platform)) {
    throw new Error(`Unsupported Anvil platform ${process.platform}/${process.arch}`);
  }
  const packageName = `@foundry-rs/anvil-${process.platform}-${architecture}`;
  const filename = process.platform === 'win32' ? 'anvil.exe' : 'anvil';
  try {
    const manifestPath = require.resolve(`${packageName}/package.json`);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.version !== '1.7.1') throw new Error(`Expected Anvil 1.7.1; installed ${manifest.version}`);
    const executable = join(dirname(manifestPath), 'bin', filename);
    await access(executable);
    return executable;
  } catch (error) {
    throw new Error(`Cannot load ${packageName} 1.7.1. Install the project's pinned native Anvil optional dependencies. ${error.message}`);
  }
}

/**
 * Start a loopback-only development EVM. Port 0 delegates port selection to Anvil.
 * snapshot() persists complete Anvil state, blocks, transactions, receipts and
 * historical states; call it after confirmed application mutations for durability.
 * close() snapshots before termination because Windows kill cannot deliver a
 * graceful Unix SIGINT. Development snapshots are not a production database.
 */
export async function startEvm({ port = 0, dataDir } = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError('port must be an integer from 0 to 65535');
  if (dataDir !== undefined && (typeof dataDir !== 'string' || dataDir.length === 0)) throw new TypeError('dataDir must be a nonempty path');
  const executable = await binaryPath();
  const stateFile = dataDir ? join(resolve(dataDir), 'anvil-state.json') : null;
  let savedState;
  if (stateFile) {
    await mkdir(dirname(stateFile), { recursive: true });
    try {
      savedState = JSON.parse(await readFile(stateFile, 'utf8'));
      if (savedState.schema !== STATE_SCHEMA || savedState.anvilVersion !== '1.7.1' || savedState.chainId !== '31337'
        || typeof savedState.state !== 'string' || !/^0x(?:[0-9a-f]{2})+$/.test(savedState.state)) {
        throw new Error('Unsupported or malformed saved Anvil state');
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  // Never let Anvil place its historical-state cache in the user's home folder.
  const cachePath = stateFile ? join(dirname(stateFile), 'anvil-cache') : await mkdtemp(join(tmpdir(), 'prooflane-anvil-cache-'));
  await mkdir(cachePath, { recursive: true });
  const args = [
    '--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337',
    '--hardfork', 'shanghai', '--mnemonic', DEV_MNEMONIC, '--accounts', '4',
    '--gas-limit', '30000000', '--preserve-historical-states', '--color', 'never',
    '--cache-path', cachePath, '--no-cors',
  ];
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = false;
  let stderr = '';
  let provider;
  let closing;
  let snapshotQueue = Promise.resolve();
  const exitedPromise = new Promise(resolveExit => child.once('exit', (code, signal) => {
    exited = true;
    resolveExit({ code, signal });
  }));
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4096); });
  const onParentExit = () => { if (!exited) child.kill(); };
  process.once('exit', onParentExit);
  async function stopProcess() {
    process.removeListener('exit', onParentExit);
    if (!exited && child.pid) child.kill();
    if (child.pid) await exitedPromise;
  }
  try {
    const actualPort = await new Promise((resolvePort, rejectPort) => {
      let output = '';
      const timer = setTimeout(() => rejectPort(new Error(`Anvil did not start within 30 seconds. ${stderr}`)), 30_000);
      const onError = error => { clearTimeout(timer); rejectPort(error); };
      child.once('error', onError);
      child.once('exit', (code) => { clearTimeout(timer); rejectPort(new Error(`Anvil exited before startup (${code}). ${stderr}`)); });
      child.stdout.on('data', chunk => {
        output = (output + chunk.toString()).slice(-16_384);
        const match = output.match(/Listening on\s+127\.0\.0\.1:(\d+)/i);
        if (match) {
          clearTimeout(timer);
          const boundPort = Number(match[1]);
          if (boundPort < 1 || boundPort > 65535) rejectPort(new Error('Anvil reported an invalid listening port'));
          else resolvePort(boundPort);
        }
      });
    });
    const url = `http://127.0.0.1:${actualPort}`;
    provider = new JsonRpcProvider(url, 31337, { staticNetwork: true, cacheTimeout: -1, pollingInterval: 50, batchMaxCount: 1 });
    if (BigInt(await provider.send('eth_chainId', [])) !== 31337n) throw new Error('Unexpected local chain ID');
    if (savedState && await provider.send('anvil_loadState', [savedState.state]) !== true) throw new Error('Anvil did not load the saved state');
    const info = await provider.send('anvil_nodeInfo', []);
    if (info.hardFork !== 'Shanghai' && String(info.hardFork).toLowerCase() !== 'shanghai') {
      throw new Error(`Unexpected local hardfork: ${info.hardFork}`);
    }

    function snapshot() {
      const work = snapshotQueue.then(async () => {
        if (exited) throw new Error('Cannot snapshot a stopped Anvil process');
        const state = await provider.send('anvil_dumpState', [true]);
        if (typeof state !== 'string' || !/^0x(?:[0-9a-f]{2})+$/.test(state)) throw new Error('Anvil returned malformed state');
        if (!stateFile) return { persisted: false, state };
        const temporary = `${stateFile}.${process.pid}.tmp`;
        const file = await open(temporary, 'w');
        try {
          await file.writeFile(JSON.stringify({ schema: STATE_SCHEMA, anvilVersion: '1.7.1', chainId: '31337', state }));
          await file.sync();
        } finally { await file.close(); }
        try { await rename(temporary, stateFile); }
        catch (error) { await unlink(temporary).catch(() => {}); throw error; }
        return { persisted: true, path: stateFile };
      });
      snapshotQueue = work.catch(() => {});
      return work;
    }
    return {
      provider, url, port: actualPort,
      request({ method, params = [] }) { return provider.send(method, params); },
      snapshot,
      close() {
        closing ??= (async () => {
          try { if (stateFile && !exited) await snapshot(); }
          finally { provider.destroy(); await stopProcess(); }
        })();
        return closing;
      },
    };
  } catch (error) {
    provider?.destroy();
    await stopProcess();
    throw error;
  }
}
