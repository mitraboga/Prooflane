const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short = value => value ? `${value.slice(0,10)}…${value.slice(-6)}` : '—';
let state = null;
let selectedMandate = '';
let selectedReceipt = '';

async function api(path, data) {
  const response = await fetch(`/api${path}`, data === undefined ? {} : {
    method:'POST', headers:{'Content-Type':'application/json','X-Prooflane-Client':'local-demo'}, body:JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || 'Request failed.');
  return result;
}
function notice(message, error=false) { $('#notice').hidden=false; $('#notice').className=error?'error':''; $('#notice').textContent=message; }
async function action(fn) {
  document.querySelectorAll('button').forEach(button => button.disabled=true);
  try { await fn(); }
  catch(error) { notice(error.message,true); }
  finally { document.querySelectorAll('button').forEach(button => button.disabled=false); try { await refresh(); } catch(error) { notice(`Cannot reach Prooflane: ${error.message}`,true); } }
}
function view(name) {
  document.querySelectorAll('.view').forEach(section => section.hidden = section.id !== `${name}-view`);
  document.querySelectorAll('.nav').forEach(button => button.classList.toggle('active',button.dataset.view===name));
  $('#page-name').textContent = {console:'Evidence console',verifier:'Independent verification',architecture:'System design'}[name];
}
document.querySelectorAll('.nav').forEach(button => button.addEventListener('click',() => view(button.dataset.view)));

async function refresh() {
  state=await api('/state');
  if (!state.mandates.some(p => p.id===selectedMandate)) selectedMandate=state.mandates[0]?.id || '';
  $('#network').textContent=`Ethereum local · ${state.network.chainId} · Block ${state.network.blockNumber}`;
  $('#network').classList.add('ready');
  $('#metric-receipts').textContent=state.metrics.receipts;
  $('#metric-anchored').textContent=state.metrics.anchored;
  $('#metric-denied').textContent=state.metrics.denied;
  const batch=state.batches[0];
  $('#metric-gas').textContent=batch ? Math.round(Number(batch.gas_used)/batch.count).toLocaleString() : '—';
  $('#mandate-select').innerHTML=state.mandates.length ? state.mandates.map(p => `<option value="${escape(p.id)}">${escape(p.label)} · ${escape(p.status)}</option>`).join('') : '<option value="">Create a mandate to begin</option>';
  $('#mandate-select').value=selectedMandate;
  const selectedTool=$('#tool-select').value;
  $('#tool-select').innerHTML=state.tools.map(t => `<option value="${escape(t.name)}">${escape(t.label)} · ${escape(t.cost)} credits</option>`).join('');
  if (state.tools.some(t => t.name===selectedTool)) $('#tool-select').value=selectedTool;
  if (!$('#allowed-tools').children.length) $('#allowed-tools').innerHTML=state.tools.map((t,i) => `<label><input type="checkbox" name="allowed-tool" value="${escape(t.name)}" ${i<2?'checked':''}> ${escape(t.label)}</label>`).join('');
  renderPolicy(); renderReceipts(); renderAttempts();
  $('#network-details').innerHTML=Object.entries({Chain:'31337 · local EVM',Contract:state.network.contractAddress,Owner:state.network.operator,Agent:state.network.agent,Finality:state.network.finality}).map(([k,v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('');
}
function renderPolicy() {
  const p=state.mandates.find(p => p.id===selectedMandate);
  if (!p) { $('#policy-summary').textContent='An on-chain mandate defines an agent’s tools, budget, and expiry.'; return; }
  $('#policy-summary').innerHTML=`<b>${escape(short(p.id))}</b> · ${escape(p.tools.length)} tools allowed<br>Agent ${escape(short(p.agent))} · ${escape(p.status)}<br>Expires ${escape(new Date(Number(p.expiresAt)*1000).toLocaleString())}`;
  const used=BigInt(p.spent)+BigInt(p.reserved);
  $('#budget-text').textContent=`${used} / ${p.budget} credits`;
  $('#budget-meter').max=Number(p.budget); $('#budget-meter').value=Number(used);
  const n=state.receipts.filter(r => r.mandateId===p.id && r.status==='pending').length;
  $('#anchor-button').textContent=`Anchor ${n ? n+' pending' : 'pending'} receipt${n===1?'':'s'}`;
  $('#execute-button').disabled=p.status!=='active'; $('#anchor-button').disabled=p.status!=='active'||!n; $('#revoke-button').disabled=p.revoked;
}
function renderReceipts() {
  const receipts=state.receipts.filter(r => !selectedMandate || r.mandateId===selectedMandate);
  $('#receipt-list').innerHTML=receipts.length ? receipts.map(r => `<button class="receipt-row ${r.id===selectedReceipt?'selected':''}" data-receipt="${escape(r.id)}"><span><strong>${escape(state.tools.find(t=>t.name===r.tool)?.label || r.tool)}</strong><small>SEQ ${String(r.nonce).padStart(3,'0')} &nbsp; ${escape(short(r.receipt.outputHash))}</small></span><span class="right"><span class="credits">${escape(r.cost)} credits</span><span class="status ${escape(r.status)}">${escape(r.status)}</span></span></button>`).join('') : '<div class="empty"><span class="empty-icon">▤</span><h3>Your agent’s paper trail starts here.</h3><p>Create a demo mandate and execute a tool.<br>Every successful call produces a signed receipt.</p></div>';
  document.querySelectorAll('[data-receipt]').forEach(button => button.addEventListener('click',() => { selectedReceipt=button.dataset.receipt; renderReceipts(); }));
  const r=receipts.find(r => r.id===selectedReceipt);
  $('#receipt-detail').hidden=!r;
  if (!r) return;
  $('#receipt-detail').innerHTML=`<h3>Receipt evidence <span class="muted">/ sequence ${escape(r.nonce)}</span></h3><dl><dt>Signer</dt><dd>${escape(short(state.network.agent))}</dd><dt>Input hash</dt><dd>${escape(short(r.receipt.inputHash))}</dd><dt>Output hash</dt><dd>${escape(short(r.receipt.outputHash))}</dd><dt>Anchor root</dt><dd>${escape(short(r.root))}</dd><dt>Transaction</dt><dd>${escape(short(r.transactionHash))}</dd></dl><label>Recorded tool output</label><pre>${escape(JSON.stringify(r.output,null,2))}</pre>${r.status==='anchored'?'<div class="secondary-actions"><button id="open-proof" class="primary">Open in verifier ↗</button><button id="export-proof" class="secondary">Export JSON</button></div>':'<p class="field-help">Anchor the pending batch to generate a portable inclusion proof.</p>'}`;
  if (r.status==='anchored') {
    $('#open-proof').addEventListener('click',() => action(async()=>{ const bundle=await api(`/receipts/${r.id}/bundle`); $('#bundle-json').value=JSON.stringify(bundle,null,2); view('verifier'); await verifyCurrent(); }));
    $('#export-proof').addEventListener('click',() => action(async()=>{ const bundle=await api(`/receipts/${r.id}/bundle`); const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download=`prooflane-${r.id}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); notice('Evidence bundle exported. Verify it with the independent command-line verifier.'); }));
  }
}
function renderAttempts() {
  const attempts=state.attempts.filter(a => !selectedMandate || a.mandate_id===selectedMandate);
  $('#attempt-list').innerHTML=attempts.length ? attempts.map(a => `<div class="attempt"><span class="status ${escape(a.decision)}">${escape(a.decision)}</span><p><b>${escape(a.tool)}</b><br>${escape(a.reason)}</p><time>${escape(new Date(a.created_at).toLocaleTimeString())}</time></div>`).join('') : 'No execution attempts yet.';
}
$('#mandate-select').addEventListener('change',event=>{selectedMandate=event.target.value;selectedReceipt='';renderPolicy();renderReceipts();renderAttempts();});
$('#seed-button').addEventListener('click',()=>action(async()=>{const p=await api('/mandates',{label:'Research copilot',budget:'160',maxPerReceipt:'75',ttlMinutes:60,tools:['document.digest','text.redact']});selectedMandate=p.id;notice('Demo mandate created on-chain: 160 credits, fingerprint and redaction tools. Try key-sentence extraction to see an allowlist denial.');}));
$('#mandate-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const p=await api('/mandates',{label:$('#mandate-label').value,budget:$('#mandate-budget').value,maxPerReceipt:$('#mandate-cap').value,ttlMinutes:$('#mandate-ttl').value,tools:[...document.querySelectorAll('input[name="allowed-tool"]:checked')].map(input=>input.value)});selectedMandate=p.id;notice('Mandate created and included on the local chain.');});});
$('#execute-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{if(!selectedMandate) throw new Error('Create a mandate first.');const r=await api('/execute',{mandateId:selectedMandate,tool:$('#tool-select').value,input:{text:$('#tool-input').value},requestId:crypto.randomUUID()});selectedReceipt=r.id;notice(`Tool completed. Receipt ${r.nonce} signed; ${r.cost} credits reserved until anchoring.`);});});
$('#anchor-button').addEventListener('click',()=>action(async()=>{const batch=await api('/anchor',{mandateId:selectedMandate});notice(`${batch.count} receipts anchored in block ${batch.block_number}. Observed gas: ${Number(batch.gas_used).toLocaleString()} (${batch.gasPerReceipt} per receipt).`);}));
$('#revoke-button').addEventListener('click',()=>action(async()=>{await api('/revoke',{mandateId:selectedMandate});notice('Mandate revoked on-chain. Pending receipts can no longer settle; previously anchored evidence remains verifiable.');}));
$('#refresh-button').addEventListener('click',()=>action(async()=>{await refresh();notice('Read the latest contract and receipt state.');}));

function showReport(result) {
  $('#verification-report').innerHTML=`<div class="result-banner ${result.valid?'':'fail'}"><h3>${result.valid?'Evidence verified':'Verification failed'}</h3><p>${result.valid?'Content, signature, policy, and local-chain inclusion checks passed.':'One or more checks failed. Do not treat this bundle as verified.'}</p></div>${result.checks.map(c=>`<div class="check ${c.valid?'':'fail'}"><span class="symbol">${c.valid?'✓':'✕'}</span><div><b>${escape(c.name)}</b><p>${escape(c.detail)}</p></div></div>`).join('')}<p class="field-help">${result.limitations.map(escape).join(' ')}</p>`;
}
async function verifyCurrent() {
  let bundle; try {bundle=JSON.parse($('#bundle-json').value);}catch{throw new Error('Paste or import valid JSON before verifying.');}
  const result=await api('/verify',bundle);showReport(result);return result;
}
$('#verify-button').addEventListener('click',()=>action(verifyCurrent));
$('#tamper-button').addEventListener('click',()=>action(async()=>{let bundle;try{bundle=JSON.parse($('#bundle-json').value);}catch{throw new Error('Load an evidence bundle first.');}bundle.output={...bundle.output,tampered:'A value added after signing'};$('#bundle-json').value=JSON.stringify(bundle,null,2);await verifyCurrent();notice('Modified this bundle’s output. Its content hash should now fail verification.');}));
$('#bundle-file').addEventListener('change',event=>action(async()=>{const file=event.target.files[0];if(!file)return;if(file.size>100000)throw new Error('Evidence file exceeds 100 KB.');const text=await file.text();JSON.parse(text);$('#bundle-json').value=text;await verifyCurrent();}));

// Progressive enhancement for browsers with the proposed WebMCP registry.
if (document.modelContext?.registerTool) {
  const lifecycle=new AbortController();
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  try { await document.modelContext.registerTool({name:'verify_loaded_receipt',title:'Verify loaded receipt',description:'Verify the evidence JSON currently loaded in the verifier and display all checks. Does not execute tools or settle a transaction.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},async execute(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('Expected an empty object.');view('verifier');const result=await verifyCurrent();return {valid:result.valid,checks:result.checks,anchoring:result.anchoring};}},{signal:lifecycle.signal}); }
  catch(error){console.info('Optional browser tool registration unavailable:',error.message);}
}
refresh().catch(error=>notice(`Start the local Prooflane server to connect this console. ${error.message}`,true));
