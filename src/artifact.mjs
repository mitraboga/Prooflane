import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Render builds this artifact once; waking an idle service does not run solc.
export async function readCompiledArtifact() {
  const source = (await readFile(new URL('../contracts/Prooflane.sol', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
  const artifact = JSON.parse(await readFile(new URL('../artifacts/Prooflane.json', import.meta.url), 'utf8'));
  if (artifact.sourceNormalization !== 'lf' || artifact.sourceHash !== createHash('sha256').update(source).digest('hex') || !artifact.compilerVersion?.startsWith('0.8.28+') || !Array.isArray(artifact.abi) || !/^0x[\da-f]+$/i.test(artifact.deployedBytecode)) throw new Error('Build artifact does not match this source. Run npm run compile.');
  return artifact;
}
