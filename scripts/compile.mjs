import { mkdir,writeFile } from 'node:fs/promises';
import { compileProoflane } from '../src/compile.mjs';
import { keccak256 } from 'ethers';
const artifact=compileProoflane({normalizeSource:true});
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/Prooflane.json',JSON.stringify(artifact,null,2));
console.log(`Compiled Prooflane with ${artifact.compilerVersion}; runtime ${(artifact.deployedBytecode.length-2)/2} bytes.`);
console.log(`Public source SHA-256: ${artifact.sourceHash}`);
console.log(`Public runtime Keccak-256: ${keccak256(artifact.deployedBytecode)}`);
