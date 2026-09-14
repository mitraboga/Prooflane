import { randomUUID } from 'node:crypto';
import { id, ZeroAddress } from 'ethers';
import { join } from 'node:path';
import { createStore, receiptView } from './store.mjs';
import { TOOLS, runTool } from './tools.mjs';
import { RECEIPT_TYPES, domainFor, canonicalJson, contentHash, actionHash, receiptHash, merkleTree, verifyBundle } from './protocol.mjs';

export class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new AppError(status, code, message); };
const bytes32 = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const asPositive = (value, max, label) => {
  if (!/^[1-9]\d*$/.test(String(value)) || BigInt(value) > BigInt(max)) fail(400, 'VALIDATION', `${label} must be an integer from 1 to ${max}.`);
  return BigInt(value);
};

export class ProoflaneService {
  constructor(chain, dataDir, options = {}) {
    const { rpc, provider, owner, agent, contract, deployment, artifact, snapshot } = chain;
    Object.assign(this, { rpc, provider, owner, agent, contract, deployment, artifact, snapshot });
    this.chain = chain;
    this.store = createStore({ filename: join(dataDir, 'prooflane.sqlite'), databaseUrl: options.databaseUrl, poolOptions: options.poolOptions });
    this.db = this.store.db;
    this.publicMode = options.publicMode ?? false;
    this.network = chain.network;
    this.domain = domainFor(this.deployment.chainId, this.deployment.address);
    this.limits = { transactions: [20, 100], executions: [100, 1000], mandates: [5, 100], ...options.limits };
    this.tail = Promise.resolve();
  }
  async initialize() {
    await this.store.initialize();
    const fingerprint = JSON.stringify([this.domain.chainId, this.domain.verifyingContract.toLowerCase(), (await this.owner.getAddress()).toLowerCase(), this.agent.address.toLowerCase()]);
    await this.store.withLock('prooflane:mutations', async () => {
      const previous = await this.store.get('SELECT value FROM app_metadata WHERE key=?', 'deployment');
      if (previous && previous.value !== fingerprint) throw new Error('Database belongs to a different deployment or signing identity. Use its original configuration or a new database.');
      await this.store.run('INSERT INTO app_metadata (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING', 'deployment', fingerprint);
    });
  }
  mutate(fn) {
    const next = this.tail.then(() => this.store.withLock('prooflane:mutations', fn));
    this.tail = next.catch(() => {}); return next;
  }
  async quota(scope, category) {
    if (!this.publicMode) return;
    const day = new Date().toISOString().slice(0, 10);
    await this.store.atomic(async () => {
      for (const [subject, limit] of [[scope, this.limits[category][0]], ['global', this.limits[category][1]]]) {
        const row = await this.store.get('SELECT count FROM usage_counters WHERE subject=? AND day=? AND category=?', subject, day, category);
        if (Number(row?.count ?? 0) >= limit) fail(429, 'DEMO_QUOTA', 'The free demo has reached its daily usage limit. Try again after 00:00 UTC.');
        await this.store.run('INSERT INTO usage_counters (subject,day,category,count) VALUES (?,?,?,1) ON CONFLICT(subject,day,category) DO UPDATE SET count=usage_counters.count+1', subject, day, category);
      }
      await this.store.run('DELETE FROM usage_counters WHERE day<?', day);
    });
  }
  async capacity(table, maximum) {
    if (!this.publicMode) return;
    if (!['mandates', 'receipts', 'attempts'].includes(table)) throw new Error('Invalid capacity table');
    const row = await this.store.get(`SELECT count(*) AS n FROM ${table}`);
    if (Number(row.n) >= maximum) fail(429, 'DEMO_CAPACITY', 'The free evidence archive is full. Existing receipts can still be verified; the operator must archive data before accepting more.');
  }
  async policy(idValue, scope = 'local') {
    if (!bytes32(idValue)) fail(400, 'VALIDATION', 'A valid mandate ID is required.');
    const row = await this.store.get("SELECT * FROM mandates WHERE id=? AND scope=? AND state='active'", idValue, scope);
    if (!row) fail(404, 'NOT_FOUND', 'Mandate not found.');
    const p = await this.contract.mandates(idValue);
    if (p.owner === ZeroAddress) fail(409, 'CHAIN_STATE', 'Mandate is missing from this chain.');
    const pendingRows = await this.store.all("SELECT cost,nonce FROM receipts WHERE mandate_id=? AND status='pending' ORDER BY nonce", idValue);
    if (pendingRows.length && BigInt(pendingRows[0].nonce) !== p.nextNonce) fail(503, 'INDEX_SYNC', 'Chain settlement is ahead of the evidence index. Refresh to continue recovery before sending another transaction.');
    const reserved = pendingRows.reduce((sum, r) => sum + BigInt(r.cost), 0n);
    const now = Math.floor(Date.now() / 1000);
    return { id: idValue, label: row.label, tools: JSON.parse(row.tools), owner: p.owner, agent: p.agent, actionRoot: p.actionRoot,
      budget: String(p.budget), maxPerReceipt: String(p.maxPerReceipt), spent: String(p.spent), reserved: String(reserved),
      nextNonce: String(p.nextNonce), expiresAt: String(p.expiresAt), revoked: p.revoked, latestRoot: p.latestRoot,
      status: p.revoked ? 'revoked' : Number(p.expiresAt) <= now ? 'expired' : 'active', createdAt: row.created_at };
  }
  async state(scope = 'local') {
    await this.tail;
    await this.reconcile();
    const rows = await this.store.all("SELECT id FROM mandates WHERE scope=? AND state='active' ORDER BY created_at DESC LIMIT 100", scope);
    const mandates = [];
    for (const row of rows) mandates.push(await this.policy(row.id, scope));
    const receipts = (await this.store.all('SELECT * FROM receipts WHERE scope=? ORDER BY created_at DESC LIMIT 250', scope)).map(receiptView);
    const counts = await this.store.get("SELECT count(*) AS receipts, sum(CASE WHEN status='anchored' THEN 1 ELSE 0 END) AS anchored FROM receipts WHERE scope=?", scope);
    const denied = Number((await this.store.get("SELECT count(*) AS n FROM attempts WHERE scope=? AND decision='denied'", scope)).n);
    const batches = await this.store.all('SELECT * FROM batches WHERE scope=? ORDER BY block_number DESC LIMIT 250', scope);
    return { network: { ...this.network, chainId: this.deployment.chainId, contractAddress: this.deployment.address, operator: await this.owner.getAddress(),
      agent: this.agent.address, blockNumber: await this.provider.getBlockNumber(), database: this.store.kind },
      tools: TOOLS, mandates, receipts, batches, metrics: { receipts: Number(counts.receipts), anchored: Number(counts.anchored ?? 0), denied },
      attempts: await this.store.all('SELECT id,mandate_id,tool,decision,reason,created_at FROM attempts WHERE scope=? ORDER BY created_at DESC LIMIT 30', scope) };
  }
  createMandate(data, scope = 'local') { return this.mutate(async () => {
    await this._reconcile();
    const label = typeof data.label === 'string' ? data.label.trim() : '';
    if (!label || label.length > 60) fail(400, 'VALIDATION', 'Label must contain 1–60 characters.');
    const budget = asPositive(data.budget, 1000000, 'Budget');
    const max = asPositive(data.maxPerReceipt, 1000000, 'Per-call limit');
    const ttl = asPositive(data.ttlMinutes ?? 60, 1440, 'Expiry minutes');
    if (max > budget) fail(400, 'VALIDATION', 'Per-call limit cannot exceed the total budget.');
    if (!Array.isArray(data.tools) || !data.tools.length || data.tools.length > TOOLS.length || new Set(data.tools).size !== data.tools.length || data.tools.some(t => !TOOLS.some(x => x.name === t))) fail(400, 'VALIDATION', 'Select one or more distinct supported tools.');
    const tools = [...data.tools].sort();
    const mandateId = id(`${await this.owner.getAddress()}:${randomUUID()}`);
    const tree = merkleTree(tools.map(actionHash));
    const block = await this.provider.getBlock('latest');
    const expires = BigInt(Math.max(block.timestamp, Math.floor(Date.now() / 1000))) + ttl * 60n;
    await this.capacity('mandates', 500);
    if (this.publicMode && Number((await this.store.get('SELECT count(*) AS n FROM mandates WHERE scope=?', scope)).n) >= 20) fail(429, 'DEMO_CAPACITY', 'This visitor session has reached its 20-mandate limit.');
    await this.quota(scope, 'mandates');
    await this.store.run('INSERT INTO mandates (id,label,tools,created_at,tx_hash,scope,state) VALUES (?,?,?,?,?,?,?)', mandateId, label, JSON.stringify(tools), new Date().toISOString(), '', scope, 'prepared');
    try { await this.transact('createMandate', [mandateId, this.agent.address, tree.root, budget, max, expires], scope, mandateId); }
    catch (error) {
      const operation = await this.store.get('SELECT id FROM operations WHERE mandate_id=?', mandateId);
      if (!operation) await this.store.run("UPDATE mandates SET state='failed' WHERE id=?", mandateId);
      throw error;
    }
    return this.policy(mandateId, scope);
  }); }
  async recordAttempt(mandateId, tool, decision, reason, scope) {
    await this.store.run('INSERT INTO attempts (id,mandate_id,tool,decision,reason,created_at,scope) VALUES (?,?,?,?,?,?,?)', randomUUID(), mandateId, tool, decision, reason, new Date().toISOString(), scope);
  }
  execute(data, scope = 'local') { return this.mutate(async () => {
    if (!data || typeof data !== 'object' || typeof data.requestId !== 'string' || !/^[\w-]{8,100}$/.test(data.requestId)) fail(400, 'VALIDATION', 'A requestId of 8–100 letters, digits, underscores or hyphens is required.');
    if (typeof data.tool !== 'string' || !TOOLS.some(t => t.name === data.tool)) fail(400, 'VALIDATION', 'Choose a supported tool.');
    if (!data.input || typeof data.input.text !== 'string' || !data.input.text.trim() || data.input.text.length > 5000 || Object.keys(data.input).some(k => k !== 'text')) fail(400, 'VALIDATION', 'Input must be {text: a non-empty string up to 5000 characters}.');
    const input = { text: data.input.text };
    const requestHash = contentHash({ mandateId: data.mandateId, tool: data.tool, input });
    const requestId = scope === 'local' ? data.requestId : `${scope}:${data.requestId}`;
    const existing = await this.store.get('SELECT * FROM receipts WHERE request_id=? AND scope=?', requestId, scope);
    if (existing) {
      if (existing.request_hash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', 'This requestId was already used with different input.');
      return { ...receiptView(existing), replayed: true };
    }
    await this._reconcile();
    const p = await this.policy(data.mandateId, scope);
    await this.capacity('receipts', 5000);
    await this.capacity('attempts', 10000);
    await this.quota(scope, 'executions');
    const tool = TOOLS.find(t => t.name === data.tool);
    const deny = async (code, message) => { await this.recordAttempt(p.id, tool.name, 'denied', message, scope); fail(422, code, message); };
    if (p.status !== 'active') return deny('INACTIVE_MANDATE', `Mandate is ${p.status}. Create a new mandate to continue.`);
    if (!p.tools.includes(tool.name)) return deny('TOOL_NOT_ALLOWED', 'This tool is outside the mandate’s allowlist.');
    if (BigInt(tool.cost) > BigInt(p.maxPerReceipt)) return deny('PER_CALL_LIMIT', 'Tool cost exceeds the per-call limit.');
    if (BigInt(p.spent) + BigInt(p.reserved) + BigInt(tool.cost) > BigInt(p.budget)) return deny('BUDGET_EXCEEDED', 'Insufficient budget, including receipts waiting to be anchored.');
    const pending = Number((await this.store.get("SELECT count(*) AS n FROM receipts WHERE mandate_id=? AND status='pending'", p.id)).n);
    if (pending >= 32) return deny('BATCH_FULL', 'Anchor the 32 pending receipts before executing more tools.');
    const output = runTool(tool.name, input);
    const receipt = { mandateId: p.id, actionHash: actionHash(tool.name), inputHash: contentHash(input), outputHash: contentHash(output), cost: tool.cost, nonce: String(BigInt(p.nextNonce) + BigInt(pending)) };
    const signature = await this.agent.signTypedData(this.domain, RECEIPT_TYPES, receipt);
    const receiptId = randomUUID();
    await this.store.atomic(async () => {
      await this.store.run('INSERT INTO receipts (id,request_id,request_hash,mandate_id,nonce,cost,tool,input,output,receipt,signature,created_at,scope,client_request_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        receiptId, requestId, requestHash, p.id, Number(receipt.nonce), tool.cost, tool.name, canonicalJson(input), canonicalJson(output), JSON.stringify(receipt), signature, new Date().toISOString(), scope, data.requestId);
      await this.recordAttempt(p.id, tool.name, 'accepted', `${tool.cost} credits reserved; receipt signed.`, scope);
    });
    return receiptView(await this.store.get('SELECT * FROM receipts WHERE id=?', receiptId));
  }); }
  async indexEvent(event) {
    const root = event.args.root;
    const mandate = await this.store.get('SELECT scope FROM mandates WHERE id=?', event.args.mandateId);
    if (!mandate) return;
    const tx = await this.provider.getTransaction(event.transactionHash);
    const mined = await this.provider.getTransactionReceipt(event.transactionHash);
    const parsed = this.contract.interface.parseTransaction({ data: tx.data, value: tx.value });
    if (!parsed || parsed.name !== 'settleBatch') throw new Error('Unexpected anchoring transaction');
    if (!mined || mined.status !== 1) throw new Error('Anchoring transaction is unavailable');
    await this.store.atomic(async () => {
      await this.store.run('INSERT INTO batches (root,mandate_id,previous_root,count,total_cost,gas_used,tx_hash,block_number,scope) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(root) DO UPDATE SET tx_hash=excluded.tx_hash,block_number=excluded.block_number', root, event.args.mandateId, event.args.previousRoot, Number(event.args.count), String(event.args.totalCost), String(mined.gasUsed), event.transactionHash, event.blockNumber, mandate.scope);
      for (const r of parsed.args[1]) {
        const decoded = { mandateId: r.mandateId, actionHash: r.actionHash, inputHash: r.inputHash, outputHash: r.outputHash, cost: String(r.cost), nonce: String(r.nonce) };
        const row = await this.store.get('SELECT * FROM receipts WHERE mandate_id=? AND nonce=?', r.mandateId, Number(r.nonce));
        if (row && eq(receiptHash(this.domain, JSON.parse(row.receipt)), receiptHash(this.domain, decoded))) {
          await this.store.run("UPDATE receipts SET status='anchored',root=?,tx_hash=?,block_number=? WHERE id=?", root, event.transactionHash, event.blockNumber, row.id);
        }
      }
    });
  }
  reconcile() { return this.mutate(() => this._reconcile()); }
  async _reconcile() {
    for (const operation of await this.store.all("SELECT * FROM operations WHERE state='prepared' ORDER BY created_at")) {
      if (!operation.tx_hash) {
        await this.store.run("UPDATE operations SET state='failed' WHERE id=?", operation.id);
        if (operation.kind === 'createMandate') await this.store.run("UPDATE mandates SET state='failed' WHERE id=?", operation.mandate_id);
        continue;
      }
      let mined = await this.provider.getTransactionReceipt(operation.tx_hash);
      if (!mined && operation.raw_transaction) {
        // Replay exactly the committed signed bytes, never allocate another nonce.
        try { await this.provider.broadcastTransaction(operation.raw_transaction); } catch { /* Already known or temporarily unavailable; check the saved hash. */ }
      }
      if (!mined) {
        try { mined = await this.chain.waitForTransaction(operation.tx_hash); }
        catch { fail(503, 'TRANSACTION_PENDING', 'A submitted transaction is still unresolved. Refresh later; its saved hash will be recovered before new transactions are sent.'); }
      }
      await this.finishOperation(operation, mined);
    }
    // A bounded, persistent cursor also discovers batches sent by other relayers.
    const tip = await this.provider.getBlockNumber() - (this.network.confirmations - 1);
    const cursor = await this.store.get('SELECT value FROM app_metadata WHERE key=?', 'indexed_block');
    let from = Math.max(this.deployment.blockNumber, Number(cursor?.value ?? this.deployment.blockNumber - 1) + 1);
    for (let page = 0; from <= tip && page < (this.publicMode ? 5 : 100); page++) {
      const to = Math.min(tip, from + 1999);
      for (const event of await this.contract.queryFilter(this.contract.filters.BatchAnchored(), from, to)) await this.indexEvent(event);
      await this.store.run('INSERT INTO app_metadata (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'indexed_block', String(to));
      from = to + 1;
    }
  }
  async finishOperation(operation, mined) {
    const block = await this.provider.getBlock(mined.blockNumber);
    const depth = await this.provider.getBlockNumber() - mined.blockNumber + 1;
    if (!block || !eq(block.hash, mined.blockHash) || depth < this.network.confirmations) fail(503, 'TRANSACTION_PENDING', 'Waiting for the configured block confirmations. Refresh before retrying.');
    if (mined.status !== 1) {
      await this.store.run("UPDATE operations SET state='failed',raw_transaction=NULL WHERE id=?", operation.id);
      if (operation.kind === 'createMandate') await this.store.run("UPDATE mandates SET state='failed' WHERE id=?", operation.mandate_id);
      return false;
    }
    if (operation.kind === 'settleBatch') {
      const events = await this.contract.queryFilter(this.contract.filters.BatchAnchored(operation.mandate_id, operation.expected_root), mined.blockNumber, mined.blockNumber);
      const event = events.find(e => eq(e.transactionHash, operation.tx_hash));
      if (!event) fail(503, 'INDEX_SYNC', 'The transaction has no matching batch event. Operator review is required.');
      await this.indexEvent(event);
    }
    await this.store.atomic(async () => {
      if (operation.kind === 'createMandate') await this.store.run("UPDATE mandates SET state='active',tx_hash=? WHERE id=?", operation.tx_hash, operation.mandate_id);
      await this.store.run("UPDATE operations SET state='confirmed',raw_transaction=NULL WHERE id=?", operation.id);
    });
    return true;
  }
  async transact(kind, args, scope, mandateId, expectedRoot = null) {
    await this.quota(scope, 'transactions');
    const operation = { id: randomUUID(), kind, scope, mandate_id: mandateId, expected_root: expectedRoot, tx_hash: null };
    await this.store.run('INSERT INTO operations (id,scope,kind,mandate_id,expected_root,created_at) VALUES (?,?,?,?,?,?)', operation.id, scope, kind, mandateId, expectedRoot, new Date().toISOString());
    try {
      const save = async ({ hash, rawTransaction = null }) => {
        await this.store.run('UPDATE operations SET tx_hash=?,raw_transaction=? WHERE id=?', hash, rawTransaction, operation.id);
        operation.tx_hash = hash;
      };
      let tx;
      if (this.chain.sendTransaction) tx = await this.chain.sendTransaction(kind, args, save);
      else { tx = await this.contract.getFunction(kind)(...args); await save(tx); }
      const mined = await this.chain.waitForTransaction(tx);
      await this.snapshot();
      if (!await this.finishOperation(operation, mined)) fail(422, 'CHAIN_REVERTED', 'The contract rejected this transaction. Refresh the mandate before trying again.');
      return mined;
    } catch (error) {
      if (!operation.tx_hash) {
        await this.store.run("UPDATE operations SET state='failed' WHERE id=?", operation.id);
        if (kind === 'createMandate') await this.store.run("UPDATE mandates SET state='failed' WHERE id=?", mandateId);
      }
      if (error instanceof AppError) throw error;
      fail(503, operation.tx_hash ? 'TRANSACTION_PENDING' : 'CHAIN_UNAVAILABLE', operation.tx_hash ? 'The transaction was recorded but confirmation is unresolved. Refresh later to recover its result.' : 'The blockchain could not accept a transaction. The operator may need to refill testnet gas or check the RPC connection.');
    }
  }
  anchor(data, scope = 'local') { return this.mutate(async () => {
    await this._reconcile();
    const p = await this.policy(data.mandateId, scope);
    if (p.status !== 'active') fail(422, 'INACTIVE_MANDATE', `Cannot anchor a ${p.status} mandate.`);
    const rows = await this.store.all("SELECT * FROM receipts WHERE mandate_id=? AND status='pending' ORDER BY nonce LIMIT 32", p.id);
    if (!rows.length) fail(422, 'EMPTY_BATCH', 'Execute a tool before anchoring.');
    const actionTree = merkleTree(p.tools.map(actionHash));
    const root = merkleTree(rows.map(r => receiptHash(this.domain, JSON.parse(r.receipt)))).root;
    const mined = await this.transact('settleBatch', [p.id, rows.map(r => JSON.parse(r.receipt)), rows.map(r => r.signature), rows.map(r => actionTree.proofs[p.tools.indexOf(r.tool)])], scope, p.id, root);
    const batch = await this.store.get('SELECT * FROM batches WHERE tx_hash=?', mined.hash);
    return { ...batch, transactionHash: mined.hash, gasPerReceipt: (Number(mined.gasUsed) / rows.length).toFixed(0), status: 'included', finality: this.network.finality };
  }); }
  revoke(data, scope = 'local') { return this.mutate(async () => {
    await this._reconcile();
    const p = await this.policy(data.mandateId, scope);
    if (p.revoked) return { id: p.id, revoked: true };
    const mined = await this.transact('revokeMandate', [p.id], scope, p.id);
    return { id: p.id, revoked: true, transactionHash: mined.hash };
  }); }
  async bundle(receiptId, scope = 'local') {
    await this.tail;
    const row = await this.store.get('SELECT * FROM receipts WHERE id=? AND scope=?', receiptId, scope);
    if (!row) fail(404, 'NOT_FOUND', 'Receipt not found.');
    if (row.status !== 'anchored') fail(422, 'NOT_ANCHORED', 'Anchor this receipt before exporting its inclusion proof.');
    const p = await this.policy(row.mandate_id, scope);
    const batchRows = await this.store.all('SELECT * FROM receipts WHERE root=? AND scope=? ORDER BY nonce', row.root, scope);
    const tree = merkleTree(batchRows.map(r => receiptHash(this.domain, JSON.parse(r.receipt))));
    if (!eq(tree.root, row.root)) fail(409, 'INCOMPLETE_EVIDENCE', 'Local batch data is incomplete; restore the evidence archive.');
    const actions = merkleTree(p.tools.map(actionHash));
    return { schema: 'prooflane.receipt.v1', domain: this.domain, receipt: JSON.parse(row.receipt), signature: row.signature, agent: p.agent,
      policy: { id: p.id, owner: p.owner, agent: p.agent, actionRoot: p.actionRoot, budget: p.budget, maxPerReceipt: p.maxPerReceipt, expiresAt: p.expiresAt },
      action: { name: row.tool, proof: actions.proofs[p.tools.indexOf(row.tool)] }, input: JSON.parse(row.input), output: JSON.parse(row.output),
      anchor: { root: row.root, proof: tree.proofs[batchRows.findIndex(r => r.id === row.id)], transactionHash: row.tx_hash, blockNumber: row.block_number, chainId: this.deployment.chainId, contractAddress: this.deployment.address } };
  }
  async verify(bundle) {
    const result = verifyBundle(bundle);
    const check = (name, valid, detail) => result.checks.push({ name, valid, detail });
    const configured = eq(bundle?.domain?.verifyingContract, this.deployment.address) && String(bundle?.domain?.chainId) === this.deployment.chainId;
    check('Expected deployment', configured, configured ? 'Matches the chain and contract configured by this verifier.' : 'Bundle does not match the configured deployment. No bundle-provided RPC URL is contacted.');
    if (result.valid && configured) {
      try {
        const p = await this.contract.mandates(bundle.receipt.mandateId);
        const genuinePolicy = ['owner','agent','actionRoot'].every(k => eq(p[k], bundle.policy[k])) && ['budget','maxPerReceipt','expiresAt'].every(k => String(p[k]) === String(bundle.policy[k]));
        check('On-chain policy', genuinePolicy, 'Compared immutable policy fields with the configured contract.');
        const batch = await this.contract.batches(bundle.anchor.root);
        const inclusion = batch.exists && eq(batch.mandateId, bundle.receipt.mandateId) && await this.contract.verifyReceipt(bundle.anchor.root, result.receiptDigest, bundle.anchor.proof);
        check('On-chain inclusion', inclusion, 'Read the anchored root and verified membership on the configured contract.');
        const mined = await this.provider.getTransactionReceipt(bundle.anchor.transactionHash);
        const logMatches = mined?.logs.some(log => {
          if (!eq(log.address, this.deployment.address)) return false;
          try { const parsed = this.contract.interface.parseLog(log); return parsed?.name === 'BatchAnchored' && eq(parsed.args.root, bundle.anchor.root) && eq(parsed.args.mandateId, bundle.receipt.mandateId); } catch { return false; }
        });
        check('Transaction provenance', Boolean(mined?.status === 1 && String(mined.blockNumber) === String(bundle.anchor.blockNumber) && logMatches), 'Transaction must contain this contract’s matching BatchAnchored event at the stated block.');
        const canonical = mined ? await this.provider.getBlock(mined.blockNumber) : null;
        const depth = mined ? await this.provider.getBlockNumber() - mined.blockNumber + 1 : 0;
        check('Block confirmations', Boolean(canonical && eq(canonical.hash, mined.blockHash) && depth >= this.network.confirmations), this.network.finality);
        result.anchoring = inclusion ? (this.publicMode ? 'included_testnet' : 'included_local') : 'not_found';
        result.policyAuthenticity = genuinePolicy ? 'checked_onchain' : 'mismatch';
        result.currentPolicy = { revoked: p.revoked, expiresAt: String(p.expiresAt), spent: String(p.spent), note: 'Later expiry or revocation does not invalidate earlier anchored evidence.' };
      } catch { check('Chain availability', false, 'Unable to establish evidence against the configured chain.'); }
    }
    result.valid = result.checks.every(c => c.valid);
    result.limitations = [this.publicMode ? `${this.network.finality}. Base Sepolia is a testnet.` : 'This report uses a local development chain, not public-chain finality.', 'Signatures and inclusion do not prove truthful tool execution, accurate claimed cost, or complete logging.'];
    return result;
  }
  async close() { await this.tail; await this.store.close(); }
}
