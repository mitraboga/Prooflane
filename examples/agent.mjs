import { ProoflaneClient } from '../sdk/client.mjs';
import { mkdir,writeFile } from 'node:fs/promises';
const client=new ProoflaneClient(process.env.PROOFLANE_URL);
const mandate=await client.createMandate({label:'Research copilot · SDK demo',budget:'100',maxPerReceipt:'40',ttlMinutes:60,tools:['document.digest','text.redact']});
console.log('Created mandate:',mandate.id);
const input={text:'Agent audit report. Contact alex@example.com. Every accepted operation should leave evidence.'};
const first=await client.execute(mandate.id,'document.digest',input);
await client.execute(mandate.id,'text.redact',input);
try { await client.execute(mandate.id,'text.summarize',input);throw new Error('Expected policy denial'); }
catch(error) { if(error.code!=='TOOL_NOT_ALLOWED')throw error; console.log('Correctly denied unauthorized tool:',error.code); }
const batch=await client.anchor(mandate.id);
console.log('Anchored:',batch.transactionHash,'gas:',batch.gas_used);
const bundle=await client.exportReceipt(first.id);
await mkdir('data/exports',{recursive:true});
await writeFile('data/exports/demo-receipt.json',JSON.stringify(bundle,null,2));
const verified=await client.verify(bundle);
if(!verified.valid)throw new Error('Valid evidence failed verification');
const changed=structuredClone(bundle);changed.output.tampered=true;
const tampered=await client.verify(changed);
if(tampered.valid)throw new Error('Tampering went undetected');
console.log('Original: VERIFIED. Tampered copy: REJECTED.');
console.log('Export: data/exports/demo-receipt.json');
