/** X Layer read/import/compare and reviewed wallet publishing. No embedded keys. */
import { selector, keccak256 } from './keccak.mjs';
import { t } from './i18n.mjs';
import { importNetlist, inspectCircuit, evaluate, stepCircuit, packBits, unpackBits } from './engine.mjs';

export const CHAIN_ID = 196;
export const XLAYER = Object.freeze({ chainId: '0xc4', chainName: 'X Layer', nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 }, rpcUrls: ['https://rpc.xlayer.tech'], blockExplorerUrls: ['https://web3.okx.com/explorer/x-layer'] });
export const FACTORY = '0x1f09daefa827f02cbb40967cc91b259763760761';
export const REFERENCE = Object.freeze({ address: '0x839bdd6fa7a66416a609a735e11de5411b98574e', id: 2, chainId: 196, label: '已存在的参考 NAND（含两个缓冲门）；不是 CME1 五门部署' });
export const ABI = Object.freeze(Object.fromEntries([
  'circuitInfo(uint256)', 'netlist(uint256)', 'eval(uint256,bytes)', 'step(uint256,bytes,bytes)',
  'TAPEOUT_FEE()', 'tapeout(bytes,uint32,uint32)', 'isCPU(address)', 'factory()', 'transistors()',
  'balanceOf(address,uint256)', 'balanceOf(address)', 'isApprovedForAll(address,address)', 'NAND()', 'LATCH()',
].map(s => [s, selector(s)])));
let requestId = 0;
export function validAddress(address) { return typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address) && !/^0x0{40}$/.test(address); }
export function requireAddress(address) { if (!validAddress(address)) throw new Error(t('请输入有效且非零的 EVM 合约地址。')); return address.toLowerCase(); }
function word(value) { const n = BigInt(value); if (n < 0n || n >= 1n << 256n) throw new Error('ABI integer out of range.'); return n.toString(16).padStart(64, '0'); }
function addressWord(address) { return requireAddress(address).slice(2).padStart(64, '0'); }
function hexBytes(hex, limit = 65536) { if (typeof hex !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(hex) || hex.length > 2 + limit * 2) throw new Error('Invalid ABI bytes.'); return hex.slice(2).toLowerCase(); }
function dynamic(hex) { const h = hexBytes(hex); return word(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64, '0'); }
function idWord(id) { if (!/^[1-9]\d{0,17}$/.test(String(id))) throw new Error(t('电路 ID 应为 1–10^18−1 的整数。')); return word(id); }
export function encodeCall(signature, values = []) {
  if (!Object.hasOwn(ABI, signature)) throw new Error('Unsupported ABI signature.');
  const types = signature.slice(signature.indexOf('(') + 1, -1).split(',').filter(Boolean);
  if (types.length !== values.length) throw new Error('ABI arity mismatch.');
  let offset = types.length * 32; const tail = [], head = [];
  types.forEach((type, i) => {
    if (type === 'bytes') { const bytes = dynamic(values[i]); head.push(word(offset)); tail.push(bytes); offset += bytes.length / 2; }
    else if (type === 'address') head.push(addressWord(values[i]));
    else if (/^uint/.test(type)) head.push(word(values[i]));
    else throw new Error('Unsupported ABI type.');
  });
  return ABI[signature] + head.join('') + tail.join('');
}
function abiWords(hex) { const h = hexBytes(hex); if (h.length % 64) throw new Error('Malformed ABI word result.'); return h.match(/.{64}/g) ?? []; }
export function decodeUint(hex, index = 0) { const ws = abiWords(hex); if (!ws[index]) throw new Error('ABI result is missing a word.'); return BigInt(`0x${ws[index]}`); }
export function decodeAddress(hex) { const ws = abiWords(hex); if (ws.length !== 1 || !/^0{24}[0-9a-f]{40}$/.test(ws[0])) throw new Error('Malformed ABI address.'); return `0x${ws[0].slice(24)}`; }
export function decodeBytes(hex, wordIndex = 0) {
  const h = hexBytes(hex), ws = abiWords(hex); if (!ws[wordIndex]) throw new Error('ABI offset missing.');
  const offsetBig = BigInt(`0x${ws[wordIndex]}`); if (offsetBig > BigInt(h.length / 2) || offsetBig % 32n) throw new Error('ABI offset out of range.');
  const offset = Number(offsetBig) * 2; if (offset + 64 > h.length) throw new Error('ABI byte length missing.');
  const lenBig = BigInt(`0x${h.slice(offset, offset + 64)}`); if (lenBig > 65536n) throw new Error('ABI byte result too large.');
  const length = Number(lenBig); if (offset + 64 + length * 2 > h.length) throw new Error('Truncated ABI byte result.');
  return `0x${h.slice(offset + 64, offset + 64 + length * 2)}`;
}
export async function rpcCall(method, params = [], options = {}) {
  const payload = { jsonrpc: '2.0', id: ++requestId, method, params };
  let body;
  if (options.rpc) body = await options.rpc(payload);
  else {
    const response = await (options.fetchImpl ?? fetch)('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(t('RPC 代理 HTTP {status}', { status: response.status }));
    body = await response.json();
  }
  if (body && typeof body === 'object' && body.error) throw new Error(`RPC: ${body.error.message ?? 'request rejected'}`);
  return body && typeof body === 'object' && Object.hasOwn(body, 'result') ? body.result : body;
}
async function assertChain(options) { const chain = await rpcCall('eth_chainId', [], options); if (BigInt(chain) !== BigInt(CHAIN_ID)) throw new Error(t('RPC 不是 X Layer 主网（196）。')); }
async function call(address, signature, args, options = {}, block = 'latest') { return rpcCall('eth_call', [{ to: requireAddress(address), data: encodeCall(signature, args) }, block], options); }
function safeNumber(n, max = 4096) { if (n > BigInt(max) || n < 0n) throw new Error('Chain value exceeds prototype resource limits.'); return Number(n); }
/** All reads for one import/compare are pinned to the returned block number. */
export async function readCircuit({ address, id, inputs, state, rpc, fetchImpl, block: requestedBlock } = {}) {
  address = requireAddress(address); idWord(id); const options = { rpc, fetchImpl }; await assertChain(options);
  const block = requestedBlock ?? await rpcCall('eth_blockNumber', [], options);
  if (typeof block !== 'string' || !/^0x[0-9a-f]+$/i.test(block)) throw new Error('Invalid pinned block.');
  const code = await rpcCall('eth_getCode', [address, block], options); if (!code || code === '0x') throw new Error(t('该地址没有合约代码。'));
  const registered = decodeUint(await call(FACTORY, 'isCPU(address)', [address], options, block));
  if (registered !== 1n) throw new Error(t('该地址不是当前 TapeOut factory 注册的处理器。'));
  const info = await call(address, 'circuitInfo(uint256)', [id], options, block);
  const nIn = safeNumber(decodeUint(info, 0), 8), nOut = safeNumber(decodeUint(info, 1), 8), nState = safeNumber(decodeUint(info, 2), 64), gateCount = safeNumber(decodeUint(info, 3), 2048);
  const netlistHex = decodeBytes(await call(address, 'netlist(uint256)', [id], options, block));
  const circuit = importNetlist({ netlistHex, nIn, nOut, title: `X Layer #${id}`, id: String(id), source: 'xlayer-read' });
  if (circuit.nState !== nState || circuit.gateCount !== gateCount) throw new Error(t('链上元数据与 NAND/LATCH 子集解析不一致；可能含不支持的 REF。'));
  const evidence = { chainId: CHAIN_ID, address, circuitId: String(id), block, netlistHex, nIn, nOut, nState, gateCount, readAt: new Date().toISOString(), verification: 'single-configured-rpc', note: '单一配置 RPC 的只读证据；尚不构成独立多节点验证或本应用新部署。' };
  let comparison = null;
  if (inputs !== undefined) {
    const inputHex = typeof inputs === 'string' ? inputs : packBits(inputs);
    if (!nState) {
      const chainOutputsHex = decodeBytes(await call(address, 'eval(uint256,bytes)', [id, inputHex], options, block));
      const localOutputs = stepCircuit(circuit, [], inputHex).outputs;
      const chainOutputs = unpackBits(chainOutputsHex, nOut);
      comparison = { match: JSON.stringify(localOutputs) === JSON.stringify(chainOutputs), localOutputs, chainOutputs, inputHex, chainOutputsHex };
    } else {
      const stateHex = typeof state === 'string' ? state : packBits(state ?? Array(nState).fill(false));
      const raw = await call(address, 'step(uint256,bytes,bytes)', [id, stateHex, inputHex], options, block);
      const chainStateHex = decodeBytes(raw, 0), chainOutputsHex = decodeBytes(raw, 1), local = stepCircuit(circuit, stateHex, inputHex);
      const chainState = unpackBits(chainStateHex, nState), chainOutputs = unpackBits(chainOutputsHex, nOut);
      comparison = { match: JSON.stringify(local.outputs) === JSON.stringify(chainOutputs) && JSON.stringify(local.newState) === JSON.stringify(chainState), localOutputs: local.outputs, localState: local.newState, chainOutputs, chainState, inputHex, stateHex, chainOutputsHex, chainStateHex };
    }
  }
  return { circuit, evidence, comparison };
}
export async function checkReferenceNand(options = {}) {
  const transport = { rpc: options.rpc, fetchImpl: options.fetchImpl };
  const first = await readCircuit({ ...REFERENCE, ...transport }); const rows = [];
  if (first.circuit.nIn !== 2 || first.circuit.nOut !== 1 || first.circuit.nState !== 0) throw new Error(t('参考电路端口或状态已变化。'));
  for (const inputs of [[false, false], [false, true], [true, false], [true, true]]) {
    const result = await readCircuit({ ...REFERENCE, ...transport, block: first.evidence.block, inputs });
    const expected = !(inputs[0] && inputs[1]);
    rows.push({ inputs, expected, chainOutput: result.comparison.chainOutputs[0], localOutput: evaluate(first.circuit, inputs), pass: result.comparison.match && result.comparison.chainOutputs[0] === expected });
  }
  return { ...first, ok: rows.every(r => r.pass), rows, scope: 'existing-reference-nand', message: '核对已存在 NAND 电路；并未部署 CME1 五门电路。' };
}
/** Exhaustive, bounded combinational comparison without re-importing per vector. */
export async function compareCircuitVectors(options = {}) {
  const result = await readCircuit(options), { circuit, evidence } = result;
  if (circuit.nState) throw new Error(t('有状态电路请提供明确状态和输入做单拍核对，不能标记为无状态真值表通过。'));
  const rows = [], transport = { rpc: options.rpc, fetchImpl: options.fetchImpl };
  for (let index = 0; index < 2 ** circuit.nIn; index++) {
    const inputs = Array.from({length:circuit.nIn},(_,i)=>Boolean(index & (1 << (circuit.nIn-1-i))));
    const raw = await call(evidence.address, 'eval(uint256,bytes)', [evidence.circuitId, packBits(inputs)], transport, evidence.block);
    const actualHex = decodeBytes(raw), chainOutputs = unpackBits(actualHex,circuit.nOut), localOutputs = stepCircuit(circuit,[],inputs).outputs;
    rows.push({index,inputs,chainOutputs,localOutputs,pass:JSON.stringify(chainOutputs)===JSON.stringify(localOutputs)});
  }
  return {...result,scope:'imported-circuit-all-inputs',ok:rows.every(r=>r.pass),passed:rows.filter(r=>r.pass).length,total:rows.length,rows,message:'在同一区块逐组合核对导入网表与链上输出；未声明与其他业务规格等价。'};
}
export function findPublishedCircuitId(receipt, address, author) {
  address=requireAddress(address);author=requireAddress(author);
  const topic=keccak256('Transfer(address,address,uint256)');
  const log=(receipt?.logs??[]).find(l=>String(l.address).toLowerCase()===address && l.topics?.length===4 && l.topics[0]?.toLowerCase()===topic && /^0x0{64}$/.test(l.topics[1]) && l.topics[2]?.toLowerCase()===`0x${addressWord(author)}`);
  if(!log||!/^0x[0-9a-fA-F]{64}$/.test(log.topics[3]))throw new Error(t('成功回执中未找到目标处理器向当前钱包铸造电路的记录；不能自动认定新电路 ID。'));
  return BigInt(log.topics[3]).toString();
}
function walletProvider(provider) { const p = provider ?? globalThis.ethereum; if (!p || typeof p.request !== 'function') throw new Error(t('未发现 EIP-1193 钱包。')); return p; }
export async function switchToXLayer(provider) {
  const p = walletProvider(provider);
  try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xc4' }] }); }
  catch (error) { if (error.code !== 4902) throw error; await p.request({ method: 'wallet_addEthereumChain', params: [XLAYER] }); await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xc4' }] }); }
  if (BigInt(await p.request({ method: 'eth_chainId' })) !== 196n) throw new Error(t('钱包未切换到 X Layer。'));
  return { chainId: CHAIN_ID };
}
export async function connectWallet(provider) { const p = walletProvider(provider); const accounts = await p.request({ method: 'eth_requestAccounts' }); const address = requireAddress(accounts?.[0]); return { address, chainId: Number(BigInt(await p.request({ method: 'eth_chainId' }))), provider: p }; }
export function formatUnits18(amount) { const n = BigInt(amount), whole = n / 10n ** 18n, fraction = (n % (10n ** 18n)).toString().padStart(18, '0').replace(/0+$/, ''); return `${whole}${fraction ? `.${fraction}` : ''}`; }
/** Only prepare a tapeout on a registered existing CPU. Reads mutable fees live. */
export async function preparePublish({ address, netlist, netlistHex, nIn, nOut, from, provider, rpc, fetchImpl } = {}) {
  address = requireAddress(address); from = requireAddress(from); const p = walletProvider(provider), options = { rpc, fetchImpl };
  if (BigInt(await p.request({ method: 'eth_chainId' })) !== 196n) throw new Error(t('发布前请将钱包切换到 X Layer。'));
  const circuit = importNetlist({ netlistHex: netlistHex ?? netlist, nIn, nOut }); const report = inspectCircuit(circuit); if (!report.valid) throw new Error(report.message);
  await assertChain(options); const block = await rpcCall('eth_blockNumber', [], options);
  if (decodeUint(await call(FACTORY, 'isCPU(address)', [address], options, block)) !== 1n) throw new Error(t('仅支持已注册的 TapeOut 处理器。'));
  const fee = decodeUint(await call(address, 'TAPEOUT_FEE()', [], options, block));
  const transistorAddress = decodeAddress(await call(address, 'transistors()', [], options, block)); requireAddress(transistorAddress);
  // Read token IDs instead of assuming a future implementation retains them.
  const nandId = decodeUint(await call(transistorAddress, 'NAND()', [], options, block));
  const latchId = decodeUint(await call(transistorAddress, 'LATCH()', [], options, block));
  if (nandId === latchId) throw new Error(t('晶体管类型编号冲突，拒绝发布。'));
  const nandBalance = decodeUint(await call(transistorAddress, 'balanceOf(address,uint256)', [from, nandId], options, block));
  const latchBalance = decodeUint(await call(transistorAddress, 'balanceOf(address,uint256)', [from, latchId], options, block));
  if (nandBalance < BigInt(report.nandCount) || latchBalance < BigInt(report.latchCount)) throw new Error(t('晶体管余额不足：需要 NAND {nand}、LATCH {latch}。请通过协议界面获取；本应用不会自动购买或授权。', { nand: report.nandCount, latch: report.latchCount }));
  const transaction = { from, to: address, data: encodeCall('tapeout(bytes,uint32,uint32)', [circuit.netlistHex, nIn, nOut]), value: `0x${fee.toString(16)}` };
  const gasEstimate = await rpcCall('eth_estimateGas', [transaction], options);
  if (!/^0x[0-9a-f]+$/i.test(gasEstimate)) throw new Error(t('无有效 gas 估算，不允许发布。'));
  return { chainId: CHAIN_ID, address, from, block, feeWei: fee.toString(), feeOKB: formatUnits18(fee), gasEstimate, tokenConsumption: { NAND: report.nandCount, LATCH: report.latchCount }, balances: { NAND: nandBalance.toString(), LATCH: latchBalance.toString() }, transistorAddress, circuit, transaction, warning: t('将消耗晶体管并支付当前协议费及 gas；协议可能升级。请核对钱包交易内容。') };
}
export async function publishExistingCPU(options = {}) {
  const p = walletProvider(options.provider); const accounts = await p.request({ method: 'eth_accounts' }); const from = requireAddress(accounts?.[0]);
  const review = await preparePublish({ ...options, from, provider: p });
  if (typeof options.onReview !== 'function' || await options.onReview(review) !== true) return { submitted: false, cancelled: true, review };
  const currentAccounts = await p.request({ method: 'eth_accounts' });
  if (requireAddress(currentAccounts?.[0]) !== from || BigInt(await p.request({ method: 'eth_chainId' })) !== 196n) throw new Error(t('审阅后钱包账户或网络发生变化，请重新审阅。'));
  // Mutable fee may change after review; refuse instead of silently increasing value.
  const feeNow = decodeUint(await call(review.address, 'TAPEOUT_FEE()', [], { rpc: options.rpc, fetchImpl: options.fetchImpl }));
  if (feeNow.toString() !== review.feeWei) throw new Error(t('协议费在审阅后变化，请重新审阅。'));
  const transactionHash = await p.request({ method: 'eth_sendTransaction', params: [review.transaction] });
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) throw new Error(t('钱包没有返回有效交易哈希。'));
  // A hash means submitted, never confirmed/deployed. Receipt polling is explicit.
  return { submitted: true, confirmed: false, transactionHash, hash: transactionHash, review };
}
export async function waitForReceipt(transactionHash, options = {}) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) throw new Error('Invalid transaction hash.');
  const attempts = Math.min(options.attempts ?? 30, 60), intervalMs = Math.max(0, Math.min(options.intervalMs ?? 2000, 5000));
  for (let i = 0; i < attempts; i++) {
    const receipt = await rpcCall('eth_getTransactionReceipt', [transactionHash], options);
    if (receipt) {
      if (String(receipt.transactionHash).toLowerCase() !== transactionHash.toLowerCase()) throw new Error('Receipt transaction hash mismatch.');
      if (receipt.status !== '0x1') throw new Error(t('交易执行失败或回执状态不可确认。'));
      return { confirmed: true, transactionHash, receipt, finality: 'included-not-finalized', note: '回执证明已包含并成功执行；请再读取新电路验证，不能仅凭哈希声称部署完成。' };
    }
    if (i + 1 < attempts) await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return { confirmed: false, pending: true, transactionHash };
}
