import { Contract, ContractFactory, HDNodeWallet, getAddress } from 'ethers';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileProoflane } from './compile.mjs';
import { startEvm, DEV_MNEMONIC } from './local-evm.mjs';

// Standard publicly known development mnemonic. NEVER fund these accounts.
export { DEV_MNEMONIC };

export async function startChain({ dataDir, port = 8545, quiet = true }) {
  await mkdir(dataDir, { recursive: true });
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
    return { rpc, provider, owner, agent, contract, deployment, artifact, snapshot: () => rpc.snapshot(),
      async close() { await rpc.close(); } };
  } catch (error) { await rpc.close(); throw error; }
}
