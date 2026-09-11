import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

/** Compile the pinned Solidity source for a broadly supported local EVM. */
export function compileProoflane() {
  if (!solc.version().startsWith('0.8.28+')) {
    throw new Error(`Expected solc 0.8.28; got ${solc.version()}`);
  }
  const contractPath = fileURLToPath(new URL('../contracts/Prooflane.sol', import.meta.url));
  const input = {
    language: 'Solidity',
    sources: { 'Prooflane.sol': { content: fs.readFileSync(contractPath, 'utf8') } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'shanghai',
      viaIR: true,
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((error) => error.severity === 'error');
  if (errors.length) throw new Error(errors.map((error) => error.formattedMessage).join('\n'));
  const artifact = output.contracts['Prooflane.sol'].Prooflane;
  return {
    contractName: 'Prooflane',
    compilerVersion: solc.version(),
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
    deployedBytecode: `0x${artifact.evm.deployedBytecode.object}`,
  };
}
