import { mkdir,writeFile } from 'node:fs/promises';
import { compileProoflane } from '../src/compile.mjs';
const artifact=compileProoflane();
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/Prooflane.json',JSON.stringify(artifact,null,2));
console.log(`Compiled Prooflane with ${artifact.compilerVersion}; runtime ${(artifact.deployedBytecode.length-2)/2} bytes.`);
