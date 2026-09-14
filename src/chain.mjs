import { Contract, ContractFactory, FetchRequest, HDNodeWallet, JsonRpcProvider, Wallet, getAddress, keccak256 } from 'ethers';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readCompiledArtifact } from './artifact.mjs';
import { startEvm, DEV_MNEMONIC } from './local-evm.mjs';

// Standard publicly known development mnemonic. NEVER fund these accounts.
export { DEV_MNEMONIC };

export const BASE_SEPOLIA_CHAIN_ID = 84532n;
export const TRANSACTION_TIMEOUT_MS = 120_000;
const PUBLIC_RPC_TIMEOUT_MS = 15_000;
const PUBLIC_POLLING_MS = 2_000;

const integer = (value, min, max, label) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  return value;
};

let developmentAddresses;
function knownDevelopmentAddresses() {
  if (!developmentAddresses) {
    developmentAddresses = new Set();
    // Reject common Hardhat/Anvil and legacy Ganache accounts, plus trivial keys.
    for (const phrase of [DEV_MNEMONIC, 'candy maple cake sugar pudding cream honey rich smooth crumble sweet treat']) {
      const root = HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/60'/0'/0");
      for (let i = 0; i < 20; i++) developmentAddresses.add(root.deriveChild(i).address.toLowerCase());
    }
    for (let i = 1; i <= 32; i++) developmentAddresses.add(new Wallet(`0x${i.toString(16).padStart(64, '0')}`).address.toLowerCase());
  }
  return developmentAddresses;
}

/** Never allow an error to echo key material from ethers argument validation. */
export function publicWallet(privateKey, provider, label = 'Signing key') {
  let wallet;
  try {
    if (typeof privateKey !== 'string' || !/^0x[0-9a-f]{64}$/i.test(privateKey)) throw new Error();
    wallet = new Wallet(privateKey, provider);
  } catch { throw new Error(`${label} must be a valid 32-byte private key supplied through the environment.`); }
  if (knownDevelopmentAddresses().has(wallet.address.toLowerCase())) throw new Error(`${label} is a publicly known development key. Generate a fresh testnet-only key.`);
  return wallet;
}

/** Bounded requests; no static-network shortcut or cached account nonce. */
export function rpcProvider(rpcUrl, { chainId, requireHttps = true } = {}) {
  let url;
  try { url = new URL(rpcUrl); } catch { throw new Error('A valid RPC_URL is required.'); }
  if (requireHttps ? url.protocol !== 'https:' : !['http:', 'https:'].includes(url.protocol)) throw new Error('Public RPC_URL must use HTTPS.');
  const request = new FetchRequest(url.href);
  request.timeout = PUBLIC_RPC_TIMEOUT_MS;
  request.setThrottleParams({ maxAttempts: 2, slotInterval: 250 });
  return new JsonRpcProvider(request, chainId, { batchMaxCount: 1, cacheTimeout: -1, polling: true, pollingInterval: PUBLIC_POLLING_MS });
}

/** A confirmation count is L2 depth, not Ethereum settlement finality. */
export async function confirmedReceipt(provider, txOrHash, confirmations = 1, timeoutMs = TRANSACTION_TIMEOUT_MS) {
  integer(confirmations, 1, 100, 'Confirmations');
  integer(timeoutMs, 1, 600_000, 'Transaction timeout');
  const hash = typeof txOrHash === 'string' ? txOrHash : txOrHash?.hash;
  if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('A valid transaction hash is required.');
  const receipt = await provider.waitForTransaction(hash, confirmations, timeoutMs);
  if (!receipt || receipt.status !== 1) throw new Error('Transaction failed or was not confirmed within the wait limit. Its persisted hash must be reconciled before retrying.');
  const block = await provider.getBlock(receipt.blockNumber);
  if (!block || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new Error('Transaction block is no longer canonical. Reconcile before retrying.');
  return receipt;
}

/** Read-only startup checks against independently configured deployment values. */
export async function validatePublicDeployment(provider, artifact, contractAddress, deploymentBlock) {
  let address;
  try { address = getAddress(contractAddress); } catch { throw new Error('CONTRACT_ADDRESS must be a valid deployment address.'); }
  integer(deploymentBlock, 1, Number.MAX_SAFE_INTEGER, 'Deployment block');
  const network = await provider.getNetwork();
  if (network.chainId !== BASE_SEPOLIA_CHAIN_ID) throw new Error('Public runtime permits Base Sepolia (chain 84532) only.');
  const code = await provider.getCode(address);
  if (code.toLowerCase() !== artifact.deployedBytecode.toLowerCase()) throw new Error('Configured contract runtime does not exactly match this Prooflane Solidity source.');
  const latest = await provider.getBlockNumber();
  if (deploymentBlock > latest) throw new Error('Deployment block is ahead of the configured chain.');
  // An incorrect late scan start would silently omit historical policy events.
  const atDeployment = await provider.getCode(address, deploymentBlock);
  const beforeDeployment = await provider.getCode(address, deploymentBlock - 1);
  if (atDeployment.toLowerCase() !== code.toLowerCase() || beforeDeployment !== '0x') throw new Error('Deployment block does not identify this contract creation.');
  return { address, chainId: String(network.chainId), blockNumber: deploymentBlock };
}

/** The service must commit the exact signed transaction before any broadcast. */
export async function sendPublicTransaction({ provider, owner, contract }, method, args, beforeBroadcast) {
  if (!['createMandate', 'settleBatch', 'revokeMandate'].includes(method)) throw new Error('Unsupported contract mutation.');
  if (typeof beforeBroadcast !== 'function') throw new Error('A durable pre-broadcast transaction callback is required.');
  const call = await contract.getFunction(method).populateTransaction(...args);
  const nonce = await provider.getTransactionCount(owner.address, 'pending');
  const populated = await owner.populateTransaction({ ...call, nonce });
  if (BigInt(populated.chainId) !== BASE_SEPOLIA_CHAIN_ID) throw new Error('Refusing to sign a transaction for an unexpected network.');
  const rawTransaction = await owner.signTransaction(populated);
  await beforeBroadcast({ hash: keccak256(rawTransaction), rawTransaction });
  return provider.broadcastTransaction(rawTransaction);
}

async function startPublicChain({ rpcUrl, contractAddress, deploymentBlock, ownerPrivateKey, agentPrivateKey, confirmations = 2 }) {
  integer(confirmations, 1, 100, 'Confirmations');
  const ownerKey = publicWallet(ownerPrivateKey, undefined, 'Owner key');
  const agent = publicWallet(agentPrivateKey, undefined, 'Agent key');
  if (ownerKey.address === agent.address) throw new Error('Owner and agent must use distinct testnet keys.');
  const artifact = await readCompiledArtifact();
  const provider = rpcProvider(rpcUrl, { chainId: BASE_SEPOLIA_CHAIN_ID });
  try {
    const deployment = await validatePublicDeployment(provider, artifact, contractAddress, deploymentBlock);
    const owner = ownerKey.connect(provider);
    const contract = new Contract(deployment.address, artifact.abi, owner);
    const network = { mode: 'base-sepolia', name: 'Base Sepolia', explorerUrl: 'https://sepolia.basescan.org', confirmations,
      finality: `${confirmations} L2 block confirmation${confirmations === 1 ? '' : 's'}; not Ethereum settlement finality` };
    return { provider, owner, agent, contract, deployment, artifact, network, transactionTimeoutMs: TRANSACTION_TIMEOUT_MS,
      snapshot: async () => ({ persisted: false, reason: 'Public chain state is maintained by Base Sepolia.' }),
      waitForTransaction: tx => confirmedReceipt(provider, tx, confirmations),
      sendTransaction: (method, args, beforeBroadcast) => sendPublicTransaction({ provider, owner, contract }, method, args, beforeBroadcast),
      async close() { provider.destroy(); } };
  } catch (error) { provider.destroy(); throw error; }
}

export async function startChain(options = {}) {
  const { mode = 'local', dataDir, port = 8545 } = options;
  if (mode === 'base-sepolia') return startPublicChain(options);
  if (mode !== 'local') throw new Error('Chain mode must be local or base-sepolia.');
  await mkdir(dataDir, { recursive: true });
  const { compileProoflane } = await import('./compile.mjs');
  const artifact = compileProoflane();
  const rpc = await startEvm({ port, dataDir });
  const provider = rpc.provider;
  try {
    const owner = await provider.getSigner(0);
    const agent = HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, "m/44'/60'/0'/0/1");
    let deployment;
    try { deployment = JSON.parse(await readFile(join(dataDir, 'deployment.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    let contract;
    if (deployment) {
      if (deployment.chainId !== '31337') throw new Error('Stored deployment chain mismatch');
      const code = await provider.getCode(deployment.address);
      if (code.toLowerCase() !== artifact.deployedBytecode.toLowerCase()) throw new Error('Stored contract differs from this source. Use a new DATA_DIR to deploy this version.');
      contract = new Contract(deployment.address, artifact.abi, owner);
    } else {
      contract = await new ContractFactory(artifact.abi, artifact.bytecode, owner).deploy();
      const tx = await contract.deploymentTransaction().wait();
      deployment = { address: getAddress(await contract.getAddress()), chainId: '31337', blockNumber: tx.blockNumber, transactionHash: tx.hash };
      await rpc.snapshot();
      await writeFile(join(dataDir, 'deployment.json'), JSON.stringify(deployment, null, 2));
    }
    return { rpc, provider, owner, agent, contract, deployment, artifact,
      network: { mode: 'local-evm', name: 'Local Anvil', explorerUrl: null, confirmations: 1, finality: 'local inclusion only' },
      transactionTimeoutMs: TRANSACTION_TIMEOUT_MS, waitForTransaction: tx => confirmedReceipt(provider, tx), snapshot: () => rpc.snapshot(),
      async close() { await rpc.close(); } };
  } catch (error) { await rpc.close(); throw error; }
}
