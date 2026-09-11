/** Minimal transport SDK. The local gateway signs receipts, not the SDK caller. */
export class ProoflaneClient {
  constructor(baseUrl='http://127.0.0.1:3000') { this.baseUrl=baseUrl.replace(/\/$/,''); }
  async request(path, data) {
    const response=await fetch(`${this.baseUrl}/api${path}`, data === undefined ? {} : {
      method:'POST',headers:{'Content-Type':'application/json','X-Prooflane-Client':'local-demo'},body:JSON.stringify(data),
    });
    const result=await response.json();
    if(!response.ok) { const error=new Error(result.error?.message ?? 'Prooflane request failed'); error.code=result.error?.code; error.status=response.status; throw error; }
    return result;
  }
  state(){return this.request('/state');}
  createMandate(policy){return this.request('/mandates',policy);}
  execute(mandateId,tool,input,requestId=crypto.randomUUID()){return this.request('/execute',{mandateId,tool,input,requestId});}
  anchor(mandateId){return this.request('/anchor',{mandateId});}
  revoke(mandateId){return this.request('/revoke',{mandateId});}
  exportReceipt(id){return this.request(`/receipts/${id}/bundle`);}
  verify(bundle){return this.request('/verify',bundle);}
}
