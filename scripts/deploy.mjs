import { ContractFactory, Transaction, getCreateAddress, keccak256 } from 'ethers';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { compileProoflane } from '../src/compile.mjs';
import { rpcProvider, publicWallet, confirmedReceipt, validatePublicDeployment } from '../src/chain.mjs';

// Explicit operator command only. npm start never creates a public contract.
const provider=rpcProvider(process.env.RPC_URL || 'https://sepolia.base.org',{chainId:84532n});
try {
  const wallet=publicWallet(process.env.DEPLOYER_PRIVATE_KEY || process.env.OWNER_PRIVATE_KEY,provider,'Deployer key');
  if((await provider.getNetwork()).chainId!==84532n)throw new Error('Deployment permits Base Sepolia only.');
  const artifact=compileProoflane();
  const directory=resolve(process.env.DATA_DIR || 'data');await mkdir(directory,{recursive:true});
  const intentPath=join(directory,'base-sepolia-deployment-intent.json');
  let intent;
  try {intent=JSON.parse(await readFile(intentPath,'utf8'));} catch(error) {if(error.code!=='ENOENT')throw error;}
  if(!intent) {
    const call=await new ContractFactory(artifact.abi,artifact.bytecode,wallet).getDeployTransaction();
    const populated=await wallet.populateTransaction({...call,nonce:await provider.getTransactionCount(wallet.address,'pending')});
    if(BigInt(populated.chainId)!==84532n)throw new Error('Unexpected transaction chain.');
    const rawTransaction=await wallet.signTransaction(populated);
    intent={deployer:wallet.address,contractAddress:getCreateAddress({from:wallet.address,nonce:populated.nonce}),transactionHash:keccak256(rawTransaction),rawTransaction};
    // Signed deployment bytes contain no private key. Retaining the exact intent
    // prevents a retry after a lost response from deploying a second contract.
    await writeFile(intentPath,JSON.stringify(intent,null,2),{flag:'wx'});
  }
  const signed=Transaction.from(intent.rawTransaction);
  if(signed.from!==wallet.address || signed.chainId!==84532n || signed.to!==null || signed.data!==artifact.bytecode || signed.hash!==intent.transactionHash || getCreateAddress({from:wallet.address,nonce:signed.nonce})!==intent.contractAddress)throw new Error('Saved deployment intent does not match this wallet and build.');
  const existing=await provider.getTransactionReceipt(intent.transactionHash);
  if(!existing) {
    try {await provider.broadcastTransaction(intent.rawTransaction);} catch { /* Resume by the exact recorded hash. */ }
  }
  const receipt=await confirmedReceipt(provider,intent.transactionHash,3);
  await validatePublicDeployment(provider,artifact,intent.contractAddress,receipt.blockNumber);
  const manifest={network:'Base Sepolia',chainId:'84532',contractAddress:intent.contractAddress,transactionHash:receipt.hash,blockNumber:receipt.blockNumber,deployer:wallet.address,compilerVersion:artifact.compilerVersion,sourceHash:artifact.sourceHash,confirmations:3,explorerUrl:`https://sepolia.basescan.org/address/${intent.contractAddress}`,deployedAt:new Date().toISOString()};
  await mkdir('deployments',{recursive:true});
  await writeFile('deployments/base-sepolia.json',JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify(manifest,null,2));
  console.log('Set CONTRACT_ADDRESS and DEPLOYMENT_BLOCK in Render from this verified manifest.');
} catch {
  console.error('Base Sepolia deployment did not complete. Check the fresh testnet key, faucet balance and HTTPS RPC. A saved deployment intent is safe to retry; do not delete it while its transaction is unresolved.');
  process.exitCode=1;
} finally {provider.destroy();}
