import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createOperatorVault, readOperatorVault, unlockOperator, verifyOperatorVault } from '../src/operator-vault.mjs';

const [action] = process.argv.slice(2);
const path = resolve('data/testnet-keys.portable.json');
try {
  if (action === 'Addresses') {
    const vault = await readOperatorVault(path);
    console.log(JSON.stringify({ Network: 'Base Sepolia', Owner: vault.owner.address, Agent: vault.agent.address, Storage: 'Password-encrypted Ethereum keystores; ignored by Git' }, null, 2));
  } else {
    let input = '';
    for await (const chunk of process.stdin) { input += chunk; if (input.length > 16000) throw new Error('Input too long.'); }
    const { password, confirmation } = JSON.parse(input.replace(/^\uFEFF/, ''));
    if (typeof password !== 'string') throw new Error('Password required.');
    if (action === 'InitializePortable') {
      if (password !== confirmation) throw new Error('Passwords do not match.');
      for (const file of [resolve(process.env.DATA_DIR || 'data', 'base-sepolia-deployment-intent.json'), resolve('deployments/base-sepolia.json')]) {
        try { await access(file); throw new Error('A deployment or saved transaction already exists. Do not change its wallet.'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const addresses = await createOperatorVault(path, password);
      console.log(JSON.stringify(addresses));
    } else if (action === 'Verify') {
      console.log(JSON.stringify({ verified: true, ...await verifyOperatorVault(path, password) }));
    } else if (['ReadOwner', 'ReadAgent'].includes(action)) {
      // Private output is consumed only by the PowerShell wrapper, never logged.
      const wallet = await unlockOperator(path, password, action === 'ReadOwner' ? 'owner' : 'agent');
      process.stdout.write(wallet.privateKey);
    } else { throw new Error('Unknown operator action.'); }
  }
} catch (error) {
  // Never echo stdin, encrypted content or library argument values.
  const safe = ['Choose a password', 'A portable wallet already', 'Passwords do not match', 'A deployment or saved transaction', 'Cannot unlock portable wallet', 'Portable wallet address', 'Owner and agent must'];
  console.error(safe.some(prefix => error.message.startsWith(prefix)) ? error.message : 'Portable wallet operation failed. Check the requested action and wallet file.');
  process.exitCode = 1;
}
