/** Minimal transport SDK. The gateway signs receipts; each client keeps its own guest session. */
export class ProoflaneClient {
  #sessionPromise;
  #cookie='';
  #origin;
  constructor(baseUrl='http://127.0.0.1:3000') {
    const url=new URL(baseUrl);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash) throw new Error('Use a Prooflane HTTP(S) URL without credentials, query parameters, or a fragment.');
    this.baseUrl=url.href.replace(/\/$/,'');
    this.#origin=url.origin;
  }
  async #send(path, data) {
    if(!/^\/[a-zA-Z0-9/_-]+$/.test(path)) throw new Error('Invalid Prooflane API path.');
    const url=new URL(`${this.baseUrl}/api${path}`);
    if(url.origin!==this.#origin) throw new Error('The Prooflane client cannot send its session to a different origin.');
    const headers={'X-Prooflane-Client':'prooflane-v1'};
    if(data!==undefined) headers['Content-Type']='application/json';
    // Browsers manage HttpOnly cookies. Node fetch needs an explicit cookie jar.
    if(this.#cookie&&typeof window==='undefined') headers.Cookie=this.#cookie;
    const response=await fetch(url,{
      method:data===undefined?'GET':'POST',headers,credentials:'same-origin',redirect:'error',
      ...(data===undefined?{}:{body:JSON.stringify(data)}),
    });
    const cookies=response.headers.getSetCookie?.()??[];
    for(const cookie of cookies) {
      const value=cookie.split(';',1)[0];
      if(value.startsWith('prooflane_session=')) this.#cookie=value;
    }
    let result;
    try { result=await response.json(); }
    catch { const error=new Error('Prooflane returned an unavailable or incomplete response. Check its state before retrying an operation.'); error.status=response.status; throw error; }
    if(!response.ok) {
      const error=new Error(result.error?.message??'Prooflane request failed');
      error.code=result.error?.code; error.status=response.status;
      error.retryAfter=response.headers.get('retry-after');
      throw error;
    }
    return result;
  }
  async session() {
    if(!this.#sessionPromise) this.#sessionPromise=this.#send('/session').catch(error=>{this.#sessionPromise=undefined;throw error;});
    return this.#sessionPromise;
  }
  async request(path,data) { await this.session(); return this.#send(path,data); }
  state(){return this.request('/state');}
  createMandate(policy){return this.request('/mandates',policy);}
  execute(mandateId,tool,input,requestId=crypto.randomUUID()){return this.request('/execute',{mandateId,tool,input,requestId});}
  anchor(mandateId){return this.request('/anchor',{mandateId});}
  revoke(mandateId){return this.request('/revoke',{mandateId});}
  exportReceipt(id){if(!/^[\w-]+$/.test(id))throw new Error('Invalid receipt ID.');return this.request(`/receipts/${id}/bundle`);}
  verify(bundle){return this.request('/verify',bundle);}
}
