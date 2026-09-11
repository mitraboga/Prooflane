import { JsonRpcProvider,Wallet,ContractFactory } from 'ethers';
import { compileProoflane } from '../src/compile.mjs';
// Deployment is opt-in and never runs as part of start, tests, or demo.
if(!process.env.RPC_URL||!process.env.DEPLOYER_PRIVATE_KEY)throw new Error('Set RPC_URL and DEPLOYER_PRIVATE_KEY for a testnet account first.');
const provider=new JsonRpcProvider(process.env.RPC_URL);
try{
  const {chainId}=await provider.getNetwork();
  if(![11155111n,84532n].includes(chainId))throw new Error('This script permits Ethereum Sepolia or Base Sepolia only.');
  const wallet=new Wallet(process.env.DEPLOYER_PRIVATE_KEY,provider);
  const artifact=compileProoflane();
  const contract=await new ContractFactory(artifact.abi,artifact.bytecode,wallet).deploy();
  const receipt=await contract.deploymentTransaction().wait();
  console.log(JSON.stringify({chainId:String(chainId),contractAddress:await contract.getAddress(),transactionHash:receipt.hash,blockNumber:receipt.blockNumber},null,2));
  console.log('Contract deployed only. The local application has not been migrated to this network.');
}finally{provider.destroy();}
