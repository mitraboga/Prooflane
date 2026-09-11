import { randomUUID } from 'node:crypto';
import { id, ZeroAddress } from 'ethers';
import { join } from 'node:path';
import { openStore, atomic, receiptView } from './store.mjs';
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
  constructor(chain, dataDir) {
    const { rpc, provider, owner, agent, contract, deployment, artifact, snapshot } = chain;
    Object.assign(this, { rpc, provider, owner, agent, contract, deployment, artifact, snapshot });
    this.db = openStore(join(dataDir, 'prooflane.sqlite'));
    this.domain = domainFor('31337', this.deployment.address);
    this.tail = Promise.resolve();
  }
  mutate(fn) { const next = this.tail.then(fn); this.tail = next.catch(() => {}); return next; }
  async policy(idValue) {
    if (!bytes32(idValue)) fail(400, 'VALIDATION', 'A valid mandate ID is required.');
    const row = this.db.prepare('SELECT * FROM mandates WHERE id=?').get(idValue);
    if (!row) fail(404, 'NOT_FOUND', 'Mandate not found.');
    const p = await this.contract.mandates(idValue);
    if (p.owner === ZeroAddress) fail(409, 'CHAIN_STATE', 'Mandate is missing from this chain.');
    const reserved = this.db.prepare("SELECT cost FROM receipts WHERE mandate_id=? AND status='pending'").all(idValue).reduce((sum, r) => sum + BigInt(r.cost), 0n);
    const now = Math.floor(Date.now() / 1000);
    return { id: idValue, label: row.label, tools: JSON.parse(row.tools), owner: p.owner, agent: p.agent, actionRoot: p.actionRoot,
      budget: String(p.budget), maxPerReceipt: String(p.maxPerReceipt), spent: String(p.spent), reserved: String(reserved),
      nextNonce: String(p.nextNonce), expiresAt: String(p.expiresAt), revoked: p.revoked, latestRoot: p.latestRoot,
      status: p.revoked ? 'revoked' : Number(p.expiresAt) <= now ? 'expired' : 'active', createdAt: row.created_at };
  }
  async state() {
    await this.tail;
    const mandates = await Promise.all(this.db.prepare('SELECT id FROM mandates ORDER BY created_at DESC').all().map(r => this.policy(r.id)));
    const receipts = this.db.prepare('SELECT * FROM receipts ORDER BY created_at DESC LIMIT 250').all().map(receiptView);
    const counts = this.db.prepare("SELECT count(*) AS receipts, sum(CASE WHEN status='anchored' THEN 1 ELSE 0 END) AS anchored FROM receipts").get();
    const denied = this.db.prepare("SELECT count(*) AS n FROM attempts WHERE decision='denied'").get().n;
    const batches = this.db.prepare('SELECT * FROM batches ORDER BY block_number DESC').all();
    return { network: { mode: 'local-evm', chainId: '31337', contractAddress: this.deployment.address, operator: await this.owner.getAddress(),
      agent: this.agent.address, blockNumber: await this.provider.getBlockNumber(), finality: 'local inclusion only' },
      tools: TOOLS, mandates, receipts, batches, metrics: { receipts: counts.receipts, anchored: counts.anchored ?? 0, denied },
      attempts: this.db.prepare('SELECT * FROM attempts ORDER BY created_at DESC LIMIT 30').all() };
  }
  createMandate(data) { return this.mutate(async () => {
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
    const tx = await this.contract.createMandate(mandateId, this.agent.address, tree.root, budget, max, expires);
    await tx.wait();
    await this.snapshot();
    this.db.prepare('INSERT INTO mandates VALUES (?,?,?,?,?)').run(mandateId, label, JSON.stringify(tools), new Date().toISOString(), tx.hash);
    return this.policy(mandateId);
  }); }
  recordAttempt(mandateId, tool, decision, reason) {
    this.db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?)').run(randomUUID(), mandateId, tool, decision, reason, new Date().toISOString());
  }
  execute(data) { return this.mutate(async () => {
    if (!data || typeof data !== 'object' || typeof data.requestId !== 'string' || !/^[\w-]{8,100}$/.test(data.requestId)) fail(400, 'VALIDATION', 'A requestId of 8–100 letters, digits, underscores or hyphens is required.');
    if (typeof data.tool !== 'string' || !TOOLS.some(t => t.name === data.tool)) fail(400, 'VALIDATION', 'Choose a supported tool.');
    if (!data.input || typeof data.input.text !== 'string' || !data.input.text.trim() || data.input.text.length > 5000 || Object.keys(data.input).some(k => k !== 'text')) fail(400, 'VALIDATION', 'Input must be {text: a non-empty string up to 5000 characters}.');
    const input = { text: data.input.text };
    const requestHash = contentHash({ mandateId: data.mandateId, tool: data.tool, input });
    const existing = this.db.prepare('SELECT * FROM receipts WHERE request_id=?').get(data.requestId);
    if (existing) {
      if (existing.request_hash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', 'This requestId was already used with different input.');
      return { ...receiptView(existing), replayed: true };
    }
    await this.reconcile();
    const p = await this.policy(data.mandateId);
    const tool = TOOLS.find(t => t.name === data.tool);
    const deny = (code, message) => { this.recordAttempt(p.id, tool.name, 'denied', message); fail(422, code, message); };
    if (p.status !== 'active') deny('INACTIVE_MANDATE', `Mandate is ${p.status}. Create a new mandate to continue.`);
    if (!p.tools.includes(tool.name)) deny('TOOL_NOT_ALLOWED', 'This tool is outside the mandate’s allowlist.');
    if (BigInt(tool.cost) > BigInt(p.maxPerReceipt)) deny('PER_CALL_LIMIT', 'Tool cost exceeds the per-call limit.');
    if (BigInt(p.spent) + BigInt(p.reserved) + BigInt(tool.cost) > BigInt(p.budget)) deny('BUDGET_EXCEEDED', 'Insufficient budget, including receipts waiting to be anchored.');
    const pending = this.db.prepare("SELECT count(*) AS n FROM receipts WHERE mandate_id=? AND status='pending'").get(p.id).n;
    if (pending >= 32) deny('BATCH_FULL', 'Anchor the 32 pending receipts before executing more tools.');
    const output = runTool(tool.name, input);
    const receipt = { mandateId: p.id, actionHash: actionHash(tool.name), inputHash: contentHash(input), outputHash: contentHash(output), cost: tool.cost, nonce: String(BigInt(p.nextNonce) + BigInt(pending)) };
    const signature = await this.agent.signTypedData(this.domain, RECEIPT_TYPES, receipt);
    const receiptId = randomUUID();
    atomic(this.db, () => {
      this.db.prepare('INSERT INTO receipts (id,request_id,request_hash,mandate_id,nonce,cost,tool,input,output,receipt,signature,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(receiptId, data.requestId, requestHash, p.id, Number(receipt.nonce), tool.cost, tool.name, canonicalJson(input), canonicalJson(output), JSON.stringify(receipt), signature, new Date().toISOString());
      this.recordAttempt(p.id, tool.name, 'accepted', `${tool.cost} credits reserved; receipt signed.`);
    });
    return receiptView(this.db.prepare('SELECT * FROM receipts WHERE id=?').get(receiptId));
  }); }
  async indexEvent(event) {
    const root = event.args.root;
    const tx = await this.provider.getTransaction(event.transactionHash);
    const mined = await this.provider.getTransactionReceipt(event.transactionHash);
    const parsed = this.contract.interface.parseTransaction({ data: tx.data, value: tx.value });
    if (!parsed || parsed.name !== 'settleBatch') throw new Error('Unexpected anchoring transaction');
    atomic(this.db, () => {
      this.db.prepare('INSERT OR IGNORE INTO batches VALUES (?,?,?,?,?,?,?,?)').run(root, event.args.mandateId, event.args.previousRoot, Number(event.args.count), String(event.args.totalCost), String(mined.gasUsed), event.transactionHash, event.blockNumber);
      for (const r of parsed.args[1]) {
        const decoded = { mandateId: r.mandateId, actionHash: r.actionHash, inputHash: r.inputHash, outputHash: r.outputHash, cost: String(r.cost), nonce: String(r.nonce) };
        const row = this.db.prepare('SELECT * FROM receipts WHERE mandate_id=? AND nonce=?').get(r.mandateId, Number(r.nonce));
        if (row && eq(receiptHash(this.domain, JSON.parse(row.receipt)), receiptHash(this.domain, decoded))) {
          this.db.prepare("UPDATE receipts SET status='anchored',root=?,tx_hash=?,block_number=? WHERE id=?").run(root, event.transactionHash, event.blockNumber, row.id);
        }
      }
    });
  }
  async reconcile() {
    // Replay immutable logs after restart; INSERT OR IGNORE makes indexing idempotent.
    for (const event of await this.contract.queryFilter(this.contract.filters.BatchAnchored(), this.deployment.blockNumber, 'latest')) await this.indexEvent(event);
  }
  anchor(data) { return this.mutate(async () => {
    await this.reconcile();
    const p = await this.policy(data.mandateId);
    if (p.status !== 'active') fail(422, 'INACTIVE_MANDATE', `Cannot anchor a ${p.status} mandate.`);
    const rows = this.db.prepare("SELECT * FROM receipts WHERE mandate_id=? AND status='pending' ORDER BY nonce LIMIT 32").all(p.id);
    if (!rows.length) fail(422, 'EMPTY_BATCH', 'Execute a tool before anchoring.');
    const actionTree = merkleTree(p.tools.map(actionHash));
    const tx = await this.contract.settleBatch(p.id, rows.map(r => JSON.parse(r.receipt)), rows.map(r => r.signature), rows.map(r => actionTree.proofs[p.tools.indexOf(r.tool)]));
    this.db.prepare('INSERT INTO submissions VALUES (?,?,?)').run(tx.hash, p.id, new Date().toISOString());
    const mined = await tx.wait();
    await this.snapshot();
    await this.reconcile();
    const batch = this.db.prepare('SELECT * FROM batches WHERE tx_hash=?').get(tx.hash);
    return { ...batch, transactionHash: tx.hash, gasPerReceipt: (Number(mined.gasUsed) / rows.length).toFixed(0), status: 'included', finality: 'local inclusion only' };
  }); }
  revoke(data) { return this.mutate(async () => {
    const p = await this.policy(data.mandateId);
    if (p.revoked) return { id: p.id, revoked: true };
    const tx = await this.contract.revokeMandate(p.id); await tx.wait();
    await this.snapshot();
    return { id: p.id, revoked: true, transactionHash: tx.hash };
  }); }
  async bundle(receiptId) {
    await this.tail;
    const row = this.db.prepare('SELECT * FROM receipts WHERE id=?').get(receiptId);
    if (!row) fail(404, 'NOT_FOUND', 'Receipt not found.');
    if (row.status !== 'anchored') fail(422, 'NOT_ANCHORED', 'Anchor this receipt before exporting its inclusion proof.');
    const p = await this.policy(row.mandate_id);
    const batchRows = this.db.prepare('SELECT * FROM receipts WHERE root=? ORDER BY nonce').all(row.root);
    const tree = merkleTree(batchRows.map(r => receiptHash(this.domain, JSON.parse(r.receipt))));
    if (!eq(tree.root, row.root)) fail(409, 'INCOMPLETE_EVIDENCE', 'Local batch data is incomplete; restore the evidence archive.');
    const actions = merkleTree(p.tools.map(actionHash));
    return { schema: 'prooflane.receipt.v1', domain: this.domain, receipt: JSON.parse(row.receipt), signature: row.signature, agent: p.agent,
      policy: { id: p.id, owner: p.owner, agent: p.agent, actionRoot: p.actionRoot, budget: p.budget, maxPerReceipt: p.maxPerReceipt, expiresAt: p.expiresAt },
      action: { name: row.tool, proof: actions.proofs[p.tools.indexOf(row.tool)] }, input: JSON.parse(row.input), output: JSON.parse(row.output),
      anchor: { root: row.root, proof: tree.proofs[batchRows.findIndex(r => r.id === row.id)], transactionHash: row.tx_hash, blockNumber: row.block_number, chainId: '31337', contractAddress: this.deployment.address } };
  }
  async verify(bundle) {
    const result = verifyBundle(bundle);
    const check = (name, valid, detail) => result.checks.push({ name, valid, detail });
    const configured = eq(bundle?.domain?.verifyingContract, this.deployment.address) && String(bundle?.domain?.chainId) === '31337';
    check('Expected deployment', configured, configured ? 'Matches the chain and contract configured by this verifier.' : 'Bundle does not match the configured local deployment. No bundle-provided RPC URL is contacted.');
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
        result.anchoring = inclusion ? 'included_local' : 'not_found';
        result.policyAuthenticity = genuinePolicy ? 'checked_onchain' : 'mismatch';
        result.currentPolicy = { revoked: p.revoked, expiresAt: String(p.expiresAt), spent: String(p.spent), note: 'Later expiry or revocation does not invalidate earlier anchored evidence.' };
      } catch { check('Chain availability', false, 'Unable to establish evidence against the configured chain.'); }
    }
    result.valid = result.checks.every(c => c.valid);
    result.limitations = ['This report uses a local development chain, not public-chain finality.', 'Signatures and inclusion do not prove truthful tool execution, accurate claimed cost, or complete logging.'];
    return result;
  }
  async close() { await this.tail; this.db.close(); }
}
