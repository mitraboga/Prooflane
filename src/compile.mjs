import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { createHash } from 'node:crypto';

/** Compile the pinned Solidity source for a broadly supported local EVM. */
export function compileProoflane({ normalizeSource = false } = {}) {
  if (!solc.version().startsWith('0.8.28+')) {
    throw new Error(`Expected solc 0.8.28; got ${solc.version()}`);
  }
  const contractPath = fileURLToPath(new URL('../contracts/Prooflane.sol', import.meta.url));
  const source = fs.readFileSync(contractPath, 'utf8');
  const input = {
    language: 'Solidity',
    // Public builds must produce identical Solidity metadata on Windows/Render.
    // Preserve original local compilation so existing Anvil deployments still open.
    sources: { 'Prooflane.sol': { content: normalizeSource ? source.replace(/\r\n?/g, '\n') : source } },
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
    sourceNormalization: normalizeSource ? 'lf' : 'original',
    sourceHash: createHash('sha256').update(input.sources['Prooflane.sol'].content).digest('hex'),
    compilerVersion: solc.version(),
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
    deployedBytecode: `0x${artifact.evm.deployedBytecode.object}`,
  };
}
