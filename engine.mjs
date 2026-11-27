/** TwinCircuit deterministic logic core. No eval, network, or AI execution. */
import { t as translate } from './i18n.mjs';
export const ENGINE_VERSION = '1.0.0';
export const LIMITS = Object.freeze({ maxVariables: 8, maxGates: 2048, maxStateBits: 64, maxBytes: 16384, maxSource: 4096, maxDepth: 64 });
export const CME1_EXPRESSION = 'E && (C || M)';
export const TEMPLATE_IDS = Object.freeze(['greenhouse', 'studio-light', 'leak-alarm', 'sequence']);
const DEFINITIONS = {
  greenhouse: { title: '温室通风', inputNames: ['温度条件 C', '手动 M', '许可 E'], threshold: 28, thresholdUnit: '°C', thresholdRange: [-40, 125] },
  'studio-light': { title: '工作室照明', inputNames: ['光线暗 C', '手动 M', '许可 E'], threshold: 35, thresholdUnit: '%', thresholdRange: [0, 100] },
  'leak-alarm': { title: '漏水提示', inputNames: ['漏水 C', '手动 M', '许可 E'], threshold: null, thresholdUnit: null, thresholdRange: null },
  sequence: { title: '顺序 A → B → 开门', inputNames: ['A 脉冲', 'B 脉冲', 'alarm', 'reset'], threshold: null, thresholdUnit: null, thresholdRange: null },
};
export class SpecError extends Error {
  constructor(message, line = 1, column = 1) { super(translate('第 {line} 行，第 {column} 列：{message}', { line, column, message: translate(message) })); this.name = 'SpecError'; this.line = line; this.column = column; }
}
function label(value, fallback = '', max = 160) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : fallback; }
function variablesChecked(variables = ['C', 'M', 'E']) {
  if (!Array.isArray(variables) || variables.length < 1 || variables.length > LIMITS.maxVariables || new Set(variables).size !== variables.length || variables.some(v => typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(v))) throw new SpecError('变量必须为 1–8 个不重复的英文标识符。');
  return [...variables];
}
function tokens(source) {
  if (typeof source !== 'string' || source.length > LIMITS.maxSource) throw new SpecError('表达式为空或超过长度限制。');
  const result = []; let i = 0, line = 1, column = 1;
  const advance = () => { if (source[i++] === '\n') { line++; column = 1; } else column++; };
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { advance(); continue; }
    if (source.slice(i, i + 2) === '//') { while (i < source.length && source[i] !== '\n') advance(); continue; }
    const at = { line, column }; const rest = source.slice(i);
    const match = rest.match(/^(?:&&|\|\||[!^()=;]|[01]|[A-Za-z][A-Za-z0-9_]*)/);
    if (!match) throw new SpecError(translate('不支持字符 {character}；仅支持 &&、||、!、^、括号、变量与 0/1。', { character: JSON.stringify(ch) }), line, column);
    for (let n = 0; n < match[0].length; n++) advance();
    result.push({ value: match[0], ...at });
  }
  result.push({ value: '<end>', line, column }); return result;
}
/** Grammar precedence: !, &&, ^, ||. Optional single Y = expression; wrapper. */
export function parseExpression(source, options = {}) {
  const variables = variablesChecked(Array.isArray(options) ? options : options.variables);
  const ts = tokens(source); let pos = 0, depth = 0;
  const peek = () => ts[pos]; const take = () => ts[pos++];
  const fail = (message, t = peek()) => { throw new SpecError(message, t.line, t.column); };
  function primary() {
    if (++depth > LIMITS.maxDepth) fail('表达式嵌套过深。');
    const t = take(); let ast;
    if (t.value === '!') ast = { type: 'not', arg: primary() };
    else if (t.value === '(') { ast = binary(0); if (peek().value !== ')') fail('缺少右括号。'); take(); }
    else if (t.value === '0' || t.value === '1') ast = { type: 'const', value: t.value === '1' };
    else if (variables.includes(t.value)) ast = { type: 'var', name: t.value };
    else fail(translate('未知变量或缺少操作数：{value}', { value: t.value }), t);
    depth--; return ast;
  }
  const precedence = { '||': 1, '^': 2, '&&': 3 }, types = { '||': 'or', '^': 'xor', '&&': 'and' };
  function binary(min) {
    let left = primary();
    while ((precedence[peek().value] ?? -1) >= min) {
      const op = take().value; const right = binary(precedence[op] + 1); left = { type: types[op], left, right };
    }
    return left;
  }
  if (ts[0].value === 'Y' && ts[1]?.value === '=') pos = 2;
  const ast = binary(0);
  if (peek().value === ';') take();
  if (peek().value !== '<end>') fail(translate('不支持的额外内容：{value}', { value: peek().value }));
  return ast;
}
function bit(value) { if (value === true || value === 1) return true; if (value === false || value === 0) return false; throw new TypeError(translate('输入只能是布尔值或数字 0/1。')); }
function inputBits(values, count) { if (!Array.isArray(values) || values.length !== count) throw new TypeError(translate('需要恰好 {count} 个输入位。', { count })); return values.map(bit); }
/** Rule evaluator does not consume compiled gates or netlist bytes. */
export function evaluateAST(ast, inputs, variables = ['C', 'M', 'E']) {
  const map = Array.isArray(inputs) ? Object.fromEntries(variables.map((v, i) => [v, bit(inputs[i])])) : inputs;
  let visits = 0;
  function run(node, depth = 0) {
    if (++visits > 8192 || depth > LIMITS.maxDepth) throw new SpecError('AST 超过限制。');
    switch (node?.type) {
      case 'const': return bit(node.value);
      case 'var': if (!Object.hasOwn(map ?? {}, node.name)) throw new SpecError(translate('未知变量 {name}', { name: node.name })); return bit(map[node.name]);
      case 'not': return !run(node.arg, depth + 1);
      case 'and': { const a = run(node.left, depth + 1), b = run(node.right, depth + 1); return a && b; }
      case 'or': { const a = run(node.left, depth + 1), b = run(node.right, depth + 1); return a || b; }
      case 'xor': return run(node.left, depth + 1) !== run(node.right, depth + 1);
      default: throw new SpecError('无效 AST 节点。');
    }
  }
  return run(ast);
}
function makeBuilder(nIn, elements = []) {
  const cache = new Map();
  const nand = (a, b) => {
    const key = `${Math.min(a, b)},${Math.max(a, b)}`;
    if (cache.has(key)) return cache.get(key);
    if (elements.length >= LIMITS.maxGates) throw new SpecError('门数量超过原型上限。');
    const out = 2 + nIn + elements.length; elements.push({ op: 'NAND', a, b, out }); cache.set(key, out); return out;
  };
  const not = a => nand(a, a), and = (a, b) => not(nand(a, b)), or = (a, b) => nand(not(a), not(b));
  function compile(ast, mapping, depth = 0) {
    if (depth > LIMITS.maxDepth) throw new SpecError('AST 嵌套过深。');
    if (ast.type === 'var') { if (!Object.hasOwn(mapping, ast.name)) throw new SpecError('未知 AST 变量。'); return mapping[ast.name]; }
    if (ast.type === 'const') return ast.value ? 1 : 0;
    if (ast.type === 'not') return not(compile(ast.arg, mapping, depth + 1));
    const a = compile(ast.left, mapping, depth + 1), b = compile(ast.right, mapping, depth + 1);
    if (ast.type === 'and') return and(a, b);
    if (ast.type === 'or') return or(a, b);
    if (ast.type === 'xor') { const k = nand(a, b); return nand(nand(a, k), nand(b, k)); }
    throw new SpecError('不支持 AST 节点。');
  }
  // TAP-02 outputs are the final element signals, never raw inputs/constants.
  function final(signal) { const last = 2 + nIn + elements.length - 1; if (signal === last && elements.length) return; const a = 2 + nIn + elements.length; elements.push({ op: 'NAND', a: signal, b: signal, out: a }); elements.push({ op: 'NAND', a, b: a, out: a + 1 }); }
  return { elements, nand, not, and, or, compile, final };
}
export function astToNAND(ast, variables = ['C', 'M', 'E']) {
  const names = variablesChecked(variables); evaluateAST(ast, names.map(() => false), names);
  const builder = makeBuilder(names.length); const output = builder.compile(ast, Object.fromEntries(names.map((v, i) => [v, 2 + i]))); builder.final(output);
  return builder.elements.map(g => ({ ...g }));
}
function uint(value, min, max, name) { if (!Number.isInteger(value) || value < min || value > max) throw new SpecError(translate('{name} 超出 {min}–{max}。', { name: translate(name), min, max })); return value; }
function hexChecked(hex) { if (typeof hex !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(hex) || (hex.length - 2) / 2 > LIMITS.maxBytes) throw new SpecError('网表必须是长度受限的 0x 十六进制字节。'); return hex.toLowerCase(); }
export function parseNetlist(netlistHex, nIn, nOut) {
  uint(nIn, 0, LIMITS.maxVariables, '输入数'); uint(nOut, 1, 8, '输出数'); const hex = hexChecked(netlistHex);
  const data = Uint8Array.from(hex.slice(2).match(/../g) ?? [], x => parseInt(x, 16)); const elements = []; let pos = 0, state = 0;
  const u24 = () => { const value = data[pos] * 65536 + data[pos + 1] * 256 + data[pos + 2]; pos += 3; return value; };
  while (pos < data.length) {
    if (elements.length >= LIMITS.maxGates) throw new SpecError('网表门数量超过限制。');
    const start = pos, opcode = data[pos++], out = 2 + nIn + elements.length;
    if (opcode === 0) { if (pos + 6 > data.length) throw new SpecError(translate('字节 {offset}：NAND 记录不完整。', { offset: start })); const a = u24(), b = u24(); if (a >= out || b >= out) throw new SpecError(translate('字节 {offset}：NAND 不允许自引用或前向引用。', { offset: start })); elements.push({ op: 'NAND', a, b, out }); }
    else if (opcode === 1) { if (pos + 3 > data.length) throw new SpecError(translate('字节 {offset}：LATCH 记录不完整。', { offset: start })); elements.push({ op: 'LATCH', d: u24(), out, stateIndex: state++ }); }
    else throw new SpecError(translate('字节 {offset}：不支持 opcode {opcode}；当前仅支持 NAND/LATCH，REF 必须由完整依赖解析器处理。', { offset: start, opcode }));
  }
  if (state > LIMITS.maxStateBits) throw new SpecError('状态位超过限制。');
  if (elements.length < nOut) throw new SpecError('输出必须是最后的元素信号；元素数量不足。');
  const totalSignals = 2 + nIn + elements.length;
  for (const e of elements) if (e.op === 'LATCH' && e.d >= totalSignals) throw new SpecError('LATCH 的反馈信号超出范围。');
  return { elements, gates: elements.filter(e => e.op === 'NAND'), nIn, nOut, nState: state, gateCount: elements.length, netlistHex: hex, totalSignals };
}
export function encodeNetlist(value) {
  const es = Array.isArray(value) ? value : value.elements ?? value.gates; if (!Array.isArray(es) || !es.length || es.length > LIMITS.maxGates) throw new SpecError('缺少门列表或超过限制。');
  const u24 = x => uint(x, 0, 0xffffff, '信号编号').toString(16).padStart(6, '0');
  return `0x${es.map(e => e.op === 'LATCH' || e.op === 1 ? `01${u24(e.d)}` : (e.op === undefined || e.op === 'NAND' || e.op === 0) ? `00${u24(e.a)}${u24(e.b)}` : (() => { throw new SpecError('不支持的门类型。'); })()).join('')}`;
}
export function importNetlist(input) {
  if (!input || typeof input !== 'object') throw new SpecError('导入内容必须为对象。');
  const parsed = parseNetlist(input.netlistHex ?? input.netlist, input.nIn, input.nOut);
  const variables = input.variables === undefined ? Array.from({ length: parsed.nIn }, (_, i) => `I${i}`) : variablesChecked(input.variables);
  if (variables.length !== parsed.nIn) throw new SpecError('变量数与 nIn 不符。');
  const expression = typeof input.expression === 'string' ? input.expression : null;
  const ast = expression ? parseExpression(expression, { variables }) : null;
  return { ...parsed, variables, inputNames: variables.map((v, i) => label(input.inputNames?.[i], v)), id: label(input.id, 'imported'), title: label(input.title, '导入的 TAP-02 电路'), profile: 'TAP02-subset', expression, ast, outputName: label(input.outputName, 'Y'), source: label(input.source, 'import'), description: label(input.description, ''), pins: { condition: 27, sensor: 27, manual: 25, enable: 26, output: 14 } };
}
/** Rebuild accepted fields from bytes, discarding prototypes, HTML and stale metadata. */
export function sanitizeCircuit(input) { return importNetlist(input); }
export function compileExpression(expression, options = {}) {
  const variables = variablesChecked(options.variables); const ast = parseExpression(expression, { variables }); const elements = astToNAND(ast, variables);
  return { ...importNetlist({ netlistHex: encodeNetlist(elements), nIn: variables.length, nOut: 1, variables, expression, title: options.title ?? '布尔逻辑规格', id: options.id ?? 'custom', inputNames: options.inputNames, outputName: 'Y' }), profile: options.profile ?? 'Boolean-DSL/1', ast };
}
export function compileCME1(options = {}) { return compileExpression(CME1_EXPRESSION, { ...options, variables: ['C', 'M', 'E'], profile: 'CME1', id: options.id ?? 'CME1' }); }
export function getTemplate(id) {
  if (!Object.hasOwn(DEFINITIONS, id)) throw new SpecError('未知模板。'); const t = DEFINITIONS[id];
  return { ...t, id, inputNames: [...t.inputNames], thresholdRange: t.thresholdRange ? [...t.thresholdRange] : null, variables: id === 'sequence' ? ['A', 'B', 'alarm', 'reset'] : ['C', 'M', 'E'], expression: id === 'sequence' ? null : CME1_EXPRESSION, pins: { condition: 27, sensor: 27, manual: 25, enable: 26, output: 14 }, outputName: id === 'sequence' ? 'open' : 'Y', description: id === 'sequence' ? 'A、B 依次到达，下一拍开门；alarm/reset 当拍抑制输出并清状态。' : 'Y = E && (C || M)。阈值只用于主机模拟。' };
}
export function listTemplates() { return TEMPLATE_IDS.map(getTemplate); }
function compileSequence() {
  const nIn = 4, es = [{ op: 'LATCH', d: 0, out: 6, stateIndex: 0 }, { op: 'LATCH', d: 0, out: 7, stateIndex: 1 }]; const b = makeBuilder(nIn, es);
  const clear = b.or(4, 5), permitted = b.not(clear), nextA = b.and(permitted, b.or(6, 2)), nextO = b.and(permitted, b.or(7, b.and(6, 3)));
  es[0].d = nextA; es[1].d = nextO; b.final(b.and(permitted, 7));
  return { ...importNetlist({ netlistHex: encodeNetlist(es), nIn, nOut: 1, variables: ['A', 'B', 'alarm', 'reset'], id: 'sequence', title: DEFINITIONS.sequence.title }), ...getTemplate('sequence'), profile: 'Sequence-AB/1', rule: 'sequence-ab', ast: null, expression: null };
}
export function compileTemplate(id = 'greenhouse', options = {}) {
  const t = getTemplate(id); if (id === 'sequence') return compileSequence(); let threshold = options.threshold ?? t.threshold;
  if (t.thresholdRange && (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < t.thresholdRange[0] || threshold > t.thresholdRange[1])) throw new SpecError('模拟阈值超出范围。');
  if (!t.thresholdRange && threshold !== null) throw new SpecError('该模板不使用数值阈值。');
  return { ...compileCME1({ id, title: t.title, inputNames: t.inputNames }), ...t, threshold };
}
export function packBits(bits) { const bytes = new Uint8Array(Math.ceil(bits.length / 8)); bits.forEach((v, i) => { if (bit(v)) bytes[i >> 3] |= 1 << (i & 7); }); return `0x${Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('')}`; }
export function unpackBits(hex, count) { uint(count, 0, 4096, '位数'); const bytes = hexChecked(hex).slice(2).match(/../g)?.map(x => parseInt(x, 16)) ?? []; return Array.from({ length: count }, (_, i) => Boolean(((bytes[i >> 3] ?? 0) >> (i & 7)) & 1)); }
function checkedRuntime(circuit) {
  const parsed = parseNetlist(circuit.netlistHex, circuit.nIn, circuit.nOut);
  const es = circuit.elements ?? circuit.gates;
  if (es && encodeNetlist(es) !== parsed.netlistHex) throw new SpecError('门列表与网表字节不一致。');
  if (circuit.nState !== undefined && circuit.nState !== parsed.nState) throw new SpecError('声明状态数与实际网表不一致。');
  return parsed;
}
export function stepCircuit(circuit, state = [], inputs = []) {
  const p = checkedRuntime(circuit); const ins = typeof inputs === 'string' ? unpackBits(inputs, p.nIn) : inputBits(inputs, p.nIn);
  const oldState = typeof state === 'string' ? unpackBits(state, p.nState) : inputBits(state, p.nState);
  const signals = [false, true, ...ins], newState = [];
  for (const e of p.elements) signals.push(e.op === 'LATCH' ? oldState[e.stateIndex] : !(signals[e.a] && signals[e.b]));
  for (const e of p.elements) if (e.op === 'LATCH') newState[e.stateIndex] = signals[e.d];
  const outputs = signals.slice(-p.nOut);
  return { newState, outputs, output: p.nOut === 1 ? outputs[0] : outputs, stateHex: packBits(newState), outputsHex: packBits(outputs) };
}
export const step = stepCircuit;
export function evaluate(circuit, inputs) { if (checkedRuntime(circuit).nState) throw new SpecError('有状态电路请使用 stepCircuit。'); return stepCircuit(circuit, [], inputs).output; }
export function truthTable(circuit) {
  if (checkedRuntime(circuit).nState) throw new SpecError('有状态电路使用轨迹验证，不生成无状态真值表。');
  return Array.from({ length: 2 ** circuit.nIn }, (_, index) => {
    // Display ordering C,M,E = 000,001,...111. Packing remains TAP-02 LSB first.
    const inputs = Array.from({ length: circuit.nIn }, (_, i) => Boolean(index & (1 << (circuit.nIn - 1 - i))));
    const output = evaluate(circuit, inputs), expected = circuit.ast ? evaluateAST(circuit.ast, inputs, circuit.variables) : null;
    return { index, inputs, output, expected, pass: expected === null ? null : output === expected };
  });
}
export function sequenceRule(state, inputs) { const [a, b, alarm, reset] = inputBits(inputs, 4), [seen, open] = inputBits(state, 2), allow = !(alarm || reset); return { newState: [allow && (seen || a), allow && (open || (seen && b))], outputs: [allow && open] }; }
export function verify(circuit) {
  try {
    const p = checkedRuntime(circuit);
    if (p.nState) {
      if (circuit.rule !== 'sequence-ab' || p.nState !== 2 || p.nIn !== 4 || p.nOut !== 1) return { ok: true, equivalent: null, passed: 0, total: 0, rows: [], message: '结构有效；尚无独立有状态规格，未证明行为等价。' };
      let passed = 0; const rows = [];
      for (let s = 0; s < 4; s++) for (let i = 0; i < 16; i++) { const state = [Boolean(s & 1), Boolean(s & 2)], inputs = Array.from({ length: 4 }, (_, k) => Boolean(i & (1 << (3 - k)))); const actual = stepCircuit(circuit, state, inputs), expected = sequenceRule(state, inputs); const pass = JSON.stringify(actual.newState) === JSON.stringify(expected.newState) && JSON.stringify(actual.outputs) === JSON.stringify(expected.outputs); if (pass) passed++; rows.push({ state, inputs, actual, expected, pass }); }
      return { ok: passed === 64, equivalent: passed === 64, passed, total: 64, rows, counterexample: rows.find(r => !r.pass) ?? null, message: `${passed}/64 状态/输入组合与独立顺序规则一致。` };
    }
    const rows = truthTable(circuit), compared = rows.filter(r => r.pass !== null), passed = compared.filter(r => r.pass).length;
    return { ok: !compared.length || passed === compared.length, equivalent: compared.length ? passed === compared.length : null, passed, total: compared.length, rows, counterexample: rows.find(r => r.pass === false) ?? null, gateCount: p.gateCount, message: compared.length ? `${passed}/${compared.length} 与独立表达式求值一致。` : '结构有效；未附独立规则，不能声称行为等价。' };
  } catch (error) { return { ok: false, equivalent: false, passed: 0, total: 0, rows: [], message: error.message, error: { line: error.line ?? 1, column: error.column ?? 1 } }; }
}
export function inspectCircuit(circuit) { const report = verify(circuit); let p; try { p = checkedRuntime(circuit); } catch {} return { ...report, valid: Boolean(p), nIn: p?.nIn ?? null, nOut: p?.nOut ?? null, nState: p?.nState ?? null, gateCount: p?.gateCount ?? null, nandCount: p?.gates.length ?? null, latchCount: p?.nState ?? null, byteLength: p ? (p.netlistHex.length - 2) / 2 : null, limits: LIMITS }; }
export async function circuitHash(circuit) { const p = checkedRuntime(circuit); if (!globalThis.crypto?.subtle) throw new Error('Web Crypto unavailable.'); const payload = new TextEncoder().encode(JSON.stringify({ format: 'TwinCircuit/TAP02/1', nIn: p.nIn, nOut: p.nOut, netlistHex: p.netlistHex })); return `0x${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', payload)), b => b.toString(16).padStart(2, '0')).join('')}`; }
export function truthCSV(circuit) { const rows = truthTable(circuit); return [`${circuit.variables.join(',')},Y,expected,match`, ...rows.map(r => `${r.inputs.map(Number).join(',')},${Number(r.output)},${r.expected === null ? '' : Number(r.expected)},${r.pass === null ? '' : r.pass}`)].join('\r\n'); }
export const exportTruthCSV = truthCSV;
export function exportST(circuit) {
  const p = checkedRuntime(circuit); if (p.nState) throw new SpecError('ST 导出首版仅支持无状态 NAND 子集。');
  const v = circuit.variables ?? Array.from({ length: p.nIn }, (_, i) => `I${i}`); variablesChecked(v);
  const names = v.map(x => x.toUpperCase());
  const reserved = new Set(['TRUE','FALSE','AND','OR','XOR','NOT','MOD','BOOL','VAR','VAR_INPUT','VAR_OUTPUT','END_VAR','FUNCTION_BLOCK','END_FUNCTION_BLOCK','IF','THEN','ELSE','END_IF','FOR','DO','END_FOR','RETURN']);
  if (new Set(names).size !== v.length || names.some(x => reserved.has(x))) throw new SpecError('ST 标识符不能大小写冲突或使用保留字；请重命名变量后导出。');
  let internal = 'tcSignals'; while (names.includes(internal.toUpperCase())) internal += '_1';
  const outs = Array.from({ length: p.nOut }, (_, i) => { let name = `Y${p.nOut === 1 ? '' : i}`; while (names.includes(name.toUpperCase()) || name.toUpperCase() === internal.toUpperCase()) name = `tc_${name}`; return name; });
  return `(* TwinCircuit NAND subset; boolean scan semantics. Not IEC certification. *)\nFUNCTION_BLOCK TwinCircuit\nVAR_INPUT\n${v.map(x => `  ${x} : BOOL;`).join('\n')}\nEND_VAR\nVAR_OUTPUT\n${outs.map(x => `  ${x} : BOOL;`).join('\n')}\nEND_VAR\nVAR\n  ${internal} : ARRAY[0..${p.totalSignals - 1}] OF BOOL;\nEND_VAR\n${internal}[0] := FALSE;\n${internal}[1] := TRUE;\n${v.map((x, i) => `${internal}[${2 + i}] := ${x};`).join('\n')}\n${p.elements.map(g => `${internal}[${g.out}] := NOT (${internal}[${g.a}] AND ${internal}[${g.b}]);`).join('\n')}\n${outs.map((x, i) => `${x} := ${internal}[${p.totalSignals - p.nOut + i}];`).join('\n')}\nEND_FUNCTION_BLOCK\n`;
}
export const structuredText = exportST;
export function firmware(circuit) {
  const p = checkedRuntime(circuit); if (p.nIn !== 3 || p.nOut !== 1 || p.nState) throw new SpecError('ESP32 导出首版仅支持 3 输入/1 输出无状态网表。');
  return `// TwinCircuit generated ESP32 sketch. NAND arrays match the exported netlist.\n// 3.3 V low-voltage logic/LED only. LED requires a current-limiting resistor.\n// GPIO14 is not a motor, mains or relay-coil driver. Real sensor calibration is separate.\n// Input order: C, M, E. Serial at 115200: TC,0,0,1,42 followed by newline.\n// Thresholds are host simulation metadata, never ADC temperature readings.\n#include <Arduino.h>\n#include <stdint.h>\n#include <string.h>\nconstexpr uint8_t C_PIN=27,M_PIN=25,E_PIN=26,OUT_PIN=14;\nconstexpr bool PHYSICAL_SWITCHES=false; // three 3.3 V digital switches, not analog sensors\nstruct Gate {uint16_t a,b;};\nconst Gate gates[]={${p.gates.map(g => `{${g.a},${g.b}}`).join(',')}};\nbool run(const bool in[3]) {bool s[${p.totalSignals}]={};s[1]=true;for(size_t i=0;i<3;i++)s[2+i]=in[i];for(size_t i=0;i<${p.gates.length};i++)s[5+i]=!(s[gates[i].a]&&s[gates[i].b]);return s[${p.totalSignals - 1}];}\nchar line[96];size_t used=0;bool overflow=false;uint32_t seq=0,lastRead=0;\nvoid report(const bool in[3],uint32_t n){bool y=run(in);digitalWrite(OUT_PIN,y?HIGH:LOW);Serial.printf("{\\"inputs\\":[%u,%u,%u],\\"output\\":%u,\\"seq\\":%lu}\\n",(unsigned)in[0],(unsigned)in[1],(unsigned)in[2],(unsigned)y,(unsigned long)n);}\nbool parse(const char* l,bool in[3],uint32_t &n){if(strlen(l)<10||strncmp(l,"TC,",3)||l[4]!=','||l[6]!=','||l[8]!=',')return false;for(size_t i=0;i<3;i++){char c=l[3+2*i];if(c!='0'&&c!='1')return false;in[i]=c=='1';}uint32_t v=0;for(size_t i=9;l[i];i++){if(l[i]<'0'||l[i]>'9')return false;uint32_t d=l[i]-'0';if(v>(UINT32_MAX-d)/10u)return false;v=v*10+d;}n=v;return true;}\nvoid setup(){pinMode(OUT_PIN,OUTPUT);digitalWrite(OUT_PIN,LOW);if(PHYSICAL_SWITCHES){pinMode(C_PIN,INPUT_PULLDOWN);pinMode(M_PIN,INPUT_PULLDOWN);pinMode(E_PIN,INPUT_PULLDOWN);}Serial.begin(115200);}\nvoid loop(){if(PHYSICAL_SWITCHES){uint32_t now=millis();if((uint32_t)(now-lastRead)>=100u){lastRead=now;bool in[3]={digitalRead(C_PIN)==HIGH,digitalRead(M_PIN)==HIGH,digitalRead(E_PIN)==HIGH};report(in,++seq);}return;}while(Serial.available()){char c=(char)Serial.read();if(c=='\\r')continue;if(c=='\\n'){if(!overflow){line[used]=0;bool in[3];uint32_t n;if(parse(line,in,n))report(in,n);}used=0;overflow=false;}else if(!overflow&&used+1<sizeof(line))line[used++]=c;else overflow=true;}}\n`;
}
export function parsePrompt(text, currentId = 'greenhouse') {
  const no = message => ({ supported: false, id: null, threshold: null, message });
  if (typeof text !== 'string' || !text.trim() || text.length > LIMITS.maxSource) return no('需求为空或过长。');
  const prompt = text.trim();
  if (/[!^&|()]/.test(prompt) || /^Y\s*=/.test(prompt)) { try { const expression = prompt; const c = compileExpression(expression); return { supported: true, id: 'custom', expression, variables: c.variables, threshold: null, mode: 'rule', message: '已使用确定性布尔 DSL；未调用 AI。' }; } catch (e) { return no(e.message); } }
  if (/PCB|PID|PWM|电压|电流|射频|定时|延时|联网|不.*手动|仅当.*同时|(?:温度|光线|漏水|condition|sensor).*(?:且|并且|同时|and)\s*(?:手动|manual)/i.test(prompt)) return no('超出固定模板范围；请使用布尔 DSL 明确逻辑。');
  const matches = [[/温室|大棚|通风|风扇|greenhouse|\bfan\b/i, 'greenhouse'], [/灯光|照明|光线|亮度|studio|\blight/i, 'studio-light'], [/漏水|水浸|leak/i, 'leak-alarm'], [/顺序|A\s*(?:→|->).*B/i, 'sequence']].filter(([r]) => r.test(prompt)).map(([, id]) => id);
  const number = prompt.match(/(?:高于|低于|阈值|改为|改成|above|below|threshold)\s*(?:为|是|:|：)?\s*(-?\d+(?:\.\d+)?)/i) ?? prompt.match(/(-?\d+(?:\.\d+)?)\s*(?:°C|℃|度|%)/i);
  const id = matches.length === 1 ? matches[0] : matches.length === 0 && number && Object.hasOwn(DEFINITIONS, currentId) ? currentId : null;
  if (!id) return no('未明确匹配唯一模板。当前仅支持固定模板与布尔 DSL，不会伪称 AI 生成。');
  if ((id === 'greenhouse' && /温度.*低于|temperature.*below/i.test(prompt)) || (id === 'studio-light' && /亮度.*高于|brightness.*above/i.test(prompt))) return no('条件方向与模板不同；请用 DSL 明确逻辑。');
  try { const c = compileTemplate(id, number ? { threshold: Number(number[1]) } : {}); return { supported: true, id, expression: c.expression, variables: c.variables, threshold: c.threshold, mode: 'rule', message: `匹配固定模板「${c.title}」，未调用 AI。${c.nState ? '时序规则需要逐拍验证。' : '规则为 Y = E && (C || M)。'}` }; } catch (e) { return no(e.message); }
}
