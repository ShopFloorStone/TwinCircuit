import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { checkReferenceNand, XLAYER } from './chain.mjs';
import { evaluate, importNetlist, packBits } from './engine.mjs';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--xlayer') || args.length > 1) {
  throw new Error('Usage: node review.mjs [--xlayer]');
}

const manifest = JSON.parse(await readFile(new URL('./conformance.json', import.meta.url), 'utf8'));
const groups = Object.entries(manifest.conformance.circuits);
const digest = createHash('sha256').update(JSON.stringify(manifest.conformance)).digest('hex');
assert.equal(manifest.conformanceSha256, 'sha256:' + digest);
assert.equal(manifest.version, 'TC-IC/0.1');
assert.equal(groups.length, manifest.profileCount);

let passed = 0;
for (const [name, { profile, vectors }] of groups) {
  const { netlistHex, nIn, nOut } = profile;
  const circuit = importNetlist({ netlistHex, nIn, nOut });
  const inputs = new Set();
  for (const row of vectors) {
    assert.equal(row.inputBits.length, nIn, name);
    assert.equal(row.inputHex, packBits(row.inputBits), name);
    const result = evaluate(circuit, row.inputBits);
    assert.equal(result, row.output, name);
    assert.equal(packBits([result]), row.outputHex, name);
    inputs.add(row.inputHex);
    passed += 1;
  }
  assert.equal(vectors.length, 2 ** nIn, name);
  assert.equal(inputs.size, vectors.length, name);
  console.log(name + ' ' + vectors.length + '/' + vectors.length);
}
assert.equal(passed, manifest.vectorCount);
console.log(manifest.version + ' ' + passed + '/' + manifest.vectorCount + ' vectors, SHA-256 ' + digest);

if (args.includes('--xlayer')) {
  const endpoint = XLAYER.rpcUrls[0];
  const result = await checkReferenceNand({
    async rpc(payload) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('X Layer RPC returned HTTP ' + response.status);
      return response.json();
    },
  });
  assert.equal(result.ok, true, 'Unexpected result from the public TapeOut reference circuit');
  const { chainId, address, circuitId, block } = result.evidence;
  console.log('X Layer ' + chainId + ', ' + address + ', circuit ' + circuitId + ', block ' + block);
  console.log('TapeOut public reference: ' + result.rows.filter(row => row.pass).length + '/' + result.rows.length);
}
