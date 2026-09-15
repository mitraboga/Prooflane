import { Wallet, verifyMessage } from 'ethers';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname } from 'node:path';

// Standard Ethereum V3 encrypted keystores; no Windows identity dependency.
export async function createOperatorVault(path, password) {
  if (typeof password !== 'string' || password.length < 16) throw new Error('Choose a password or passphrase of at least 16 characters.');
  try { await access(path); throw new Error('A portable wallet already exists; it will not be overwritten.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const owner = new Wallet(Wallet.createRandom().privateKey);
  const agent = new Wallet(Wallet.createRandom().privateKey);
  const vault = { version: 1, format: 'ethereum-keystore-v3',
    owner: { address: owner.address, keystore: JSON.parse(await owner.encrypt(password)) },
    agent: { address: agent.address, keystore: JSON.parse(await agent.encrypt(password)) } };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(vault, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { owner: owner.address, agent: agent.address };
}

export async function readOperatorVault(path) {
  const raw = await readFile(path, 'utf8');
  if (raw.length > 100000) throw new Error('Invalid portable wallet file.');
  const vault = JSON.parse(raw.replace(/^\uFEFF/, ''));
  if (vault.version !== 1 || vault.format !== 'ethereum-keystore-v3' || !vault.owner?.keystore || !vault.agent?.keystore) throw new Error('Invalid portable wallet format.');
  return vault;
}

export async function unlockOperator(path, password, role) {
  if (!['owner', 'agent'].includes(role)) throw new Error('Invalid wallet role.');
  const vault = await readOperatorVault(path);
  let wallet;
  try { wallet = await Wallet.fromEncryptedJson(JSON.stringify(vault[role].keystore), password); }
  catch { throw new Error('Cannot unlock portable wallet. Check the password and original wallet file.'); }
  if (wallet.address.toLowerCase() !== String(vault[role].address).toLowerCase()) throw new Error('Portable wallet address does not match its encrypted key.');
  return wallet;
}

export async function verifyOperatorVault(path, password) {
  const addresses = {};
  for (const role of ['owner', 'agent']) {
    const wallet = await unlockOperator(path, password, role);
    const message = 'Prooflane operator key access check; no transaction is authorized.';
    if (verifyMessage(message, await wallet.signMessage(message)) !== wallet.address) throw new Error('Wallet signing check failed.');
    addresses[role] = wallet.address;
  }
  if (addresses.owner === addresses.agent) throw new Error('Owner and agent must be distinct.');
  return addresses;
}
