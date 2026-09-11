import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir,cpus } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { id } from 'ethers';
import { startChain } from '../src/chain.mjs';
import { RECEIPT_TYPES,domainFor,contentHash,actionHash,receiptHash,merkleTree,verifyBundle } from '../src/protocol.mjs';

const directory=await mkdtemp(join(tmpdir(),'prooflane-benchmark-'));
let chain;
try{
  chain=await startChain({dataDir:directory,port:0});
  const domain=domainFor('31337',chain.deployment.address);
  const tool='document.digest',actions=merkleTree([actionHash(tool)]);
  const measurements=[];
  for(const size of [1,2,8,16,32]){
    const samples=[];
    for(let repeat=0;repeat<3;repeat++){
      const mandateId=id(`benchmark:${size}:${repeat}:${randomUUID()}`);
      const expiry=BigInt((await chain.provider.getBlock('latest')).timestamp)+3600n;
      await(await chain.contract.createMandate(mandateId,chain.agent.address,actions.root,1000,100,expiry)).wait();
      const inputs=Array.from({length:size},(_,i)=>({text:`Synthetic evidence ${i}; batch size ${size}; no external tool calls.`}));
      const outputs=inputs.map((_,i)=>({result:`Artifact ${i}`}));
      const receipts=inputs.map((value,i)=>({mandateId,actionHash:actionHash(tool),inputHash:contentHash(value),outputHash:contentHash(outputs[i]),cost:'1',nonce:String(i)}));
      const signatures=await Promise.all(receipts.map(r=>chain.agent.signTypedData(domain,RECEIPT_TYPES,r)));
      const tree=merkleTree(receipts.map(r=>receiptHash(domain,r)));
      const started=performance.now();
      const mined=await(await chain.contract.settleBatch(mandateId,receipts,signatures,receipts.map(()=>[]))).wait();
      const settlementMs=performance.now()-started;
      const bundle={schema:'prooflane.receipt.v1',domain,receipt:receipts[0],signature:signatures[0],agent:chain.agent.address,
        policy:{id:mandateId,owner:await chain.owner.getAddress(),agent:chain.agent.address,actionRoot:actions.root,budget:'1000',maxPerReceipt:'100',expiresAt:String(expiry)},
        action:{name:tool,proof:[]},input:inputs[0],output:outputs[0],anchor:{root:tree.root,proof:tree.proofs[0],transactionHash:mined.hash,blockNumber:mined.blockNumber,chainId:'31337',contractAddress:chain.deployment.address}};
      verifyBundle(bundle); // Warm-up is excluded from timed repetitions.
      const verifyStart=performance.now();
      for(let j=0;j<25;j++)if(!verifyBundle(bundle).valid)throw new Error('Benchmark generated invalid evidence');
      const offlineVerifyMs=(performance.now()-verifyStart)/25;
      samples.push({gas:Number(mined.gasUsed),gasPerReceipt:Number(mined.gasUsed)/size,settlementMs,offlineVerifyMs,proofBytes:tree.proofs[0].length*32,bundleBytes:Buffer.byteLength(JSON.stringify(bundle)),transactionHash:mined.hash});
    }
    const mean=key=>Number((samples.reduce((sum,s)=>sum+s[key],0)/samples.length).toFixed(3));
    measurements.push({batchSize:size,repetitions:3,meanGas:mean('gas'),meanGasPerReceipt:mean('gasPerReceipt'),meanSettlementMs:mean('settlementMs'),meanOfflineVerifyMs:mean('offlineVerifyMs'),proofBytes:samples[0].proofBytes,meanBundleBytes:mean('bundleBytes'),samples});
    console.log(`Batch ${size}: ${mean('gasPerReceipt')} gas/receipt, ${mean('offlineVerifyMs')} ms offline verify.`);
  }
  const reduction=Number((100*(1-measurements.at(-1).meanGasPerReceipt/measurements[0].meanGasPerReceipt)).toFixed(2));
  const report={generatedAt:new Date().toISOString(),node:process.version,platform:process.platform,architecture:process.arch,cpu:cpus()[0]?.model,chain:'Local EVM 31337 / Shanghai',solidity:'0.8.28',optimizerRuns:200,viaIR:true,method:'3 fresh mandates per batch size; one allowed tool; cost=1; warm-up then 25 offline verifications per sample; no external services. Contract deployment and mandate creation gas excluded.',warning:'Local measurements only. Settlement wall time includes local RPC behavior and is not public-chain latency. No throughput or finality claim.',gasReductionPercent32vs1:reduction,measurements};
  await writeFile('docs/benchmark-results.json',JSON.stringify(report,null,2)+'\n');
  const table=measurements.map(r=>`| ${r.batchSize} | ${r.meanGas.toLocaleString('en-US')} | ${r.meanGasPerReceipt.toLocaleString('en-US')} | ${r.proofBytes} | ${r.meanOfflineVerifyMs} |`).join('\n');
  await writeFile('docs/benchmarks.md',`# Reproducible local measurements\n\nGenerated ${report.generatedAt}. Run \`npm run benchmark\` to reproduce.\n\n${report.method}\n\nEnvironment: ${report.node}, ${report.platform}/${report.architecture}, ${report.cpu}; ${report.chain}; Solidity ${report.solidity}, optimizer 200, viaIR.\n\n| Receipts per batch | Mean batch gas | Mean gas / receipt | Inclusion proof bytes | Mean offline verification ms |\n| ---: | ---: | ---: | ---: | ---: |\n${table}\n\nA 32-receipt batch used **${reduction}% less gas per receipt** than a singleton under this specific workload. This compares separate fresh mandates and excludes creation/deployment gas. Every receipt still requires signature and policy validation; total batch gas grows with batch size.\n\n${report.warning}\n\nProof bytes count only Merkle siblings; full JSON bundle sizes and all raw samples are in [benchmark-results.json](benchmark-results.json). Synthetic transactions use a temporary local chain, removed after measurement. Hardware load affects timing. These are measurements, not service-level objectives or production scalability claims.\n`);
}finally{if(chain)await chain.close();await rm(directory,{recursive:true,force:true});}
