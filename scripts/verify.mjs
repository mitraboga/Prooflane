import { readFile } from 'node:fs/promises';
import { verifyBundle,receiptHash } from '../src/protocol.mjs';
import { JsonRpcProvider,Contract } from 'ethers';
const [file,...args]=process.argv.slice(2);
if(!file){console.error('Usage: npm run verify -- bundle.json [--rpc http://127.0.0.1:8545 --contract 0x... --chain-id 31337]');process.exit(2);}
const bundle=JSON.parse(await readFile(file,'utf8'));
const result=verifyBundle(bundle);
const get=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const rpc=get('--rpc'),address=get('--contract'),chainId=get('--chain-id');
const confirmations=Number(get('--confirmations') ?? (chainId==='84532'?3:1));
if(!Number.isSafeInteger(confirmations)||confirmations<1||confirmations>64)throw new Error('Confirmations must be an integer from 1 to 64.');
if(rpc||address||chainId){
  if(!rpc||!address||!chainId){console.error('Online checks require --rpc, --contract and --chain-id from a trusted source.');process.exit(2);}
  const provider=new JsonRpcProvider(rpc);
  try{
    const network=await provider.getNetwork();
    const match=String(network.chainId)===chainId && String(bundle.domain?.chainId)===chainId && bundle.domain?.verifyingContract?.toLowerCase()===address.toLowerCase();
    result.checks.push({name:'Trusted network and deployment',valid:match,detail:'RPC, chain and contract were supplied independently on the command line.'});
    if(result.valid&&match){
      const contract=new Contract(address,[
        'function mandates(bytes32) view returns(address owner,address agent,bytes32 actionRoot,uint256 budget,uint256 maxPerReceipt,uint256 spent,uint256 nextNonce,uint64 expiresAt,bool revoked,bytes32 latestRoot)',
        'function batches(bytes32) view returns(bytes32 mandateId,bytes32 previousRoot,uint256 totalCost,uint256 count,bool exists)',
        'function verifyReceipt(bytes32,bytes32,bytes32[]) view returns(bool)',
        'event BatchAnchored(bytes32 indexed mandateId,bytes32 indexed root,bytes32 previousRoot,uint256 totalCost,uint256 count,address relayer)',
      ],provider);
      const p=await contract.mandates(bundle.receipt.mandateId);
      const authentic=['owner','agent','actionRoot','budget','maxPerReceipt','expiresAt'].every(k=>String(p[k]).toLowerCase()===String(bundle.policy[k]).toLowerCase());
      result.checks.push({name:'On-chain policy',valid:authentic,detail:'Compared policy fields with the expected contract.'});
      const batch=await contract.batches(bundle.anchor.root);
      const included=batch.exists&&batch.mandateId.toLowerCase()===bundle.receipt.mandateId.toLowerCase()&&await contract.verifyReceipt(bundle.anchor.root,receiptHash(bundle.domain,bundle.receipt),bundle.anchor.proof);
      result.checks.push({name:'On-chain inclusion',valid:included,detail:'Root and inclusion checked against the trusted contract.'});
      const tx=await provider.getTransactionReceipt(bundle.anchor.transactionHash);
      const provenance=tx?.status===1&&String(tx.blockNumber)===String(bundle.anchor.blockNumber)&&tx.logs.some(log=>{
        if(log.address.toLowerCase()!==address.toLowerCase())return false;
        try{const event=contract.interface.parseLog(log);return event?.name==='BatchAnchored'&&event.args.root.toLowerCase()===bundle.anchor.root.toLowerCase()&&event.args.mandateId.toLowerCase()===bundle.receipt.mandateId.toLowerCase();}catch{return false;}
      });
      result.checks.push({name:'Transaction provenance',valid:Boolean(provenance),detail:'Expected event exists in the stated successful transaction and block.'});
      const block=tx?await provider.getBlock(tx.blockNumber):null;
      const depth=tx?await provider.getBlockNumber()-tx.blockNumber+1:0;
      result.checks.push({name:'Block confirmations',valid:Boolean(block&&block.hash.toLowerCase()===tx.blockHash.toLowerCase()&&depth>=confirmations),detail:`Requires ${confirmations} canonical block confirmations; L2 depth is not Ethereum settlement finality.`});
      result.anchoring=included?'included':'not_found';result.policyAuthenticity=authentic?'checked_onchain':'mismatch';
    }
  }catch(error){result.checks.push({name:'RPC verification',valid:false,detail:error.shortMessage||error.message});}
  finally{provider.destroy();}
}
result.valid=result.checks.every(c=>c.valid);
console.log(JSON.stringify(result,null,2));
if(!rpc)console.error('OFFLINE ONLY: validity means internal consistency, not an authenticated policy or blockchain anchor.');
process.exitCode=result.valid?0:1;
