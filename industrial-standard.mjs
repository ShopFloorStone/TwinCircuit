/** TC-IC/0.1 rule profiles. Numeric facts become typed bits before TapeOut evaluation. */
import { compileExpression, evaluate, packBits, truthTable } from './engine.mjs';
import { keccak256 } from './keccak.mjs';

export const STANDARD_VERSION = 'TC-IC/0.1';

const profiles = Object.freeze({
  firstArticle: Object.freeze({
    name: 'first-article-offer',
    variables: Object.freeze(['D', 'B', 'C', 'V', 'R']),
    expression: 'D && B && C && V && R',
    meanings: Object.freeze({
      D: 'committed demand reaches the requested minimum',
      B: 'committed budget covers the first-article cost',
      C: 'a capable workstation has confirmed its offer',
      V: 'an independent verifier has confirmed its role',
      R: 'rights required to issue the offer are cleared',
    }),
  }),
  acceptancePass: Object.freeze({
    name: 'cross-factory-accept',
    variables: Object.freeze(['I', 'K', 'S', 'G']),
    expression: 'I && K && S && G',
    meanings: Object.freeze({
      I: 'workpiece identity is verified',
      K: 'calibration is valid for this measurement',
      S: 'the required measurement source is present',
      G: 'the uncertainty interval is wholly inside the frozen tolerance',
    }),
  }),
  acceptanceReject: Object.freeze({
    name: 'cross-factory-reject',
    variables: Object.freeze(['I', 'K', 'S', 'X']),
    expression: 'I && K && S && X',
    meanings: Object.freeze({
      I: 'workpiece identity is verified',
      K: 'calibration is valid for this measurement',
      S: 'the required measurement source is present',
      X: 'the uncertainty interval is wholly outside the frozen tolerance',
    }),
  }),
  license: Object.freeze({
    name: 'licensed-industrial-use',
    variables: Object.freeze(['A', 'P', 'T', 'Q', 'R']),
    expression: 'A && P && T && Q && R',
    meanings: Object.freeze({
      A: 'the declared licensee matches the grant',
      P: 'the referenced process profile matches the grant',
      T: 'the use occurred inside the grant time window',
      Q: 'the requested quantity fits the remaining licensed units',
      R: 'the use preceded revocation or no revocation exists',
    }),
  }),
});

const compiled = Object.fromEntries(Object.entries(profiles).map(([key, profile]) => [
  key,
  compileExpression(profile.expression, {
    variables: [...profile.variables],
    id: `${STANDARD_VERSION}/${profile.name}`,
    title: profile.name,
  }),
]));

function circuitProfile(key) {
  const profile = profiles[key];
  const circuit = compiled[key];
  // This digest identifies the profile bytes and bit order. It does not attest facts.
  const digest = keccak256(`${STANDARD_VERSION}|${profile.name}|${profile.variables.join(',')}|${circuit.netlistHex}`);
  return {
    version: STANDARD_VERSION,
    name: profile.name,
    expression: profile.expression,
    inputOrder: [...profile.variables],
    inputMeanings: { ...profile.meanings },
    nIn: circuit.nIn,
    nOut: circuit.nOut,
    netlistHex: circuit.netlistHex,
    gateCount: circuit.gateCount,
    digestAlgorithm: 'keccak256',
    digest,
  };
}

export function getStandardProfiles() {
  return Object.fromEntries(Object.keys(profiles).map(key => [key, circuitProfile(key)]));
}

function run(key, bits) {
  const profile = circuitProfile(key);
  const inputs = profile.inputOrder.map(name => {
    if (typeof bits[name] !== 'boolean') throw new TypeError(`Missing boolean ${name}`);
    return bits[name];
  });
  const output = evaluate(compiled[key], inputs);
  return {
    ...profile,
    inputBits: inputs,
    inputHex: packBits(inputs),
    output,
    outputHex: packBits([output]),
  };
}

function safeInteger(value, name, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) throw new TypeError(`${name} must be a safe integer >= ${min}`);
  return value;
}

function boolean(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean`);
  return value;
}

function minor(value, name) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,29})$/.test(value)) {
    throw new TypeError(`${name} must be a canonical nonnegative integer string`);
  }
  return BigInt(value);
}

function identifier(value, name) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
    throw new TypeError(`${name} must be a bounded identifier`);
  }
  return value;
}

function instant(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new TypeError(`${name} must be a UTC RFC3339 instant`);
  }
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new TypeError(`${name} is invalid`);
  }
  return epoch;
}

/** Fixed property order and integer types make these spec bytes reproducible. */
export function getSpecEnvelope(kind, terms) {
  if (!terms || typeof terms !== 'object' || Array.isArray(terms)) throw new TypeError('specification terms required');
  if (kind === 'firstArticle') return {
    standardVersion: STANDARD_VERSION,
    requiredDemandUnits: safeInteger(terms.requiredDemandUnits, 'requiredDemandUnits', 1),
    requiredBudgetMinor: minor(terms.requiredBudgetMinor, 'requiredBudgetMinor').toString(),
  };
  if (kind === 'acceptance') {
    const lowerMicrometers = safeInteger(terms.lowerMicrometers, 'lowerMicrometers', -1_000_000_000_000);
    const upperMicrometers = safeInteger(terms.upperMicrometers, 'upperMicrometers', -1_000_000_000_000);
    if (lowerMicrometers > upperMicrometers) throw new RangeError('lowerMicrometers must not exceed upperMicrometers');
    return {
      standardVersion: STANDARD_VERSION,
      lowerMicrometers,
      upperMicrometers,
      requireIndependentMeasurement: boolean(terms.requireIndependentMeasurement, 'requireIndependentMeasurement'),
    };
  }
  if (kind === 'license') {
    const validFrom = terms.validFrom;
    const validUntil = terms.validUntil;
    if (instant(validFrom, 'validFrom') >= instant(validUntil, 'validUntil')) throw new RangeError('validFrom must precede validUntil');
    return {
      standardVersion: STANDARD_VERSION,
      validFrom,
      validUntil,
      rateMinor: minor(terms.rateMinor, 'rateMinor').toString(),
      maxUnits: safeInteger(terms.maxUnits, 'maxUnits'),
      licenseeId: identifier(terms.licenseeId, 'licenseeId'),
      profileDigest: identifier(terms.profileDigest, 'profileDigest'),
    };
  }
  throw new TypeError('unknown TC-IC profile');
}

/** SHA-256 of a versioned, validated specification envelope. Dynamic facts are excluded. */
export async function getSpecDigest(kind, terms) {
  const bytes = new TextEncoder().encode(JSON.stringify(getSpecEnvelope(kind, terms)));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** A `ready` result permits an offer to be issued. Workstation execution is separate. */
export function evaluateFirstArticle(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('first-article facts required');
  const requiredDemandUnits = safeInteger(input.requiredDemandUnits, 'requiredDemandUnits', 1);
  const committedDemandUnits = safeInteger(input.committedDemandUnits, 'committedDemandUnits');
  const requiredBudgetMinor = minor(input.requiredBudgetMinor, 'requiredBudgetMinor');
  const committedBudgetMinor = minor(input.committedBudgetMinor, 'committedBudgetMinor');
  const bits = {
    D: committedDemandUnits >= requiredDemandUnits,
    B: committedBudgetMinor >= requiredBudgetMinor,
    C: boolean(input.capabilityConfirmed, 'capabilityConfirmed'),
    V: boolean(input.verifierConfirmed, 'verifierConfirmed'),
    R: boolean(input.rightsCleared, 'rightsCleared'),
  };
  const circuit = run('firstArticle', bits);
  const reasons = [
    !bits.D && 'DEMAND_BELOW_MINIMUM',
    !bits.B && 'BUDGET_BELOW_COST',
    !bits.C && 'NO_CONFIRMED_WORKSTATION',
    !bits.V && 'NO_CONFIRMED_VERIFIER',
    !bits.R && 'RIGHTS_UNCLEARED',
  ].filter(Boolean);
  return { standardVersion: STANDARD_VERSION, decision: circuit.output ? 'ready' : 'pending', reasons, inputs: bits, circuit };
}

/** Three-way measurement decision using frozen integer micrometres and two circuits. */
export function evaluateAcceptance(spec, evidence) {
  if (!spec || !evidence || typeof spec !== 'object' || typeof evidence !== 'object' || Array.isArray(spec) || Array.isArray(evidence)) {
    throw new TypeError('measurement specification and evidence required');
  }
  const lower = safeInteger(spec.lowerMicrometers, 'lowerMicrometers', -1_000_000_000_000);
  const upper = safeInteger(spec.upperMicrometers, 'upperMicrometers', -1_000_000_000_000);
  if (lower > upper) throw new RangeError('lowerMicrometers must not exceed upperMicrometers');
  const measured = safeInteger(evidence.measuredMicrometers, 'measuredMicrometers', -1_000_000_000_000);
  const uncertainty = safeInteger(evidence.uncertaintyMicrometers, 'uncertaintyMicrometers');
  const intervalLower = measured - uncertainty;
  const intervalUpper = measured + uncertainty;
  if (!Number.isSafeInteger(intervalLower) || !Number.isSafeInteger(intervalUpper)) throw new RangeError('measurement interval exceeds safe integer range');
  identifier(evidence.unitId, 'unitId');
  const identity = boolean(evidence.identityVerified, 'identityVerified');
  const calibration = boolean(evidence.calibrationValid, 'calibrationValid');
  const independent = boolean(evidence.independentMeasurement, 'independentMeasurement');
  const independentRequired = boolean(spec.requireIndependentMeasurement, 'requireIndependentMeasurement');
  const base = { I: identity, K: calibration, S: !independentRequired || independent };
  const pass = run('acceptancePass', { ...base, G: intervalLower >= lower && intervalUpper <= upper });
  const reject = run('acceptanceReject', { ...base, X: intervalUpper < lower || intervalLower > upper });
  const decision = pass.output ? 'accept' : reject.output ? 'reject' : 'review';
  const reasons = [
    !base.I && 'UNIT_IDENTITY_UNVERIFIED',
    !base.K && 'CALIBRATION_INVALID',
    !base.S && 'INDEPENDENT_MEASUREMENT_REQUIRED',
    decision === 'review' && base.I && base.K && base.S && 'INTERVAL_TOUCHES_TOLERANCE',
  ].filter(Boolean);
  return {
    standardVersion: STANDARD_VERSION,
    decision,
    reasons,
    inputs: { pass: { ...base, G: pass.inputBits[3] }, reject: { ...base, X: reject.inputBits[3] } },
    intervalMicrometers: { lower: intervalLower, upper: intervalUpper },
    circuit: { pass, reject },
  };
}

/** Fee eligibility is evaluated per declared use; consuming a use is a store transaction. */
export function evaluateLicense(grant, use) {
  if (!grant || !use || typeof grant !== 'object' || typeof use !== 'object' || Array.isArray(grant) || Array.isArray(use)) {
    throw new TypeError('license grant and use required');
  }
  const from = instant(grant.validFrom, 'validFrom');
  const until = instant(grant.validUntil, 'validUntil');
  if (from >= until) throw new RangeError('validFrom must precede validUntil');
  const occurred = instant(use.occurredAt, 'occurredAt');
  const revoked = grant.revokedAt == null ? null : instant(grant.revokedAt, 'revokedAt');
  const rate = minor(grant.rateMinor, 'rateMinor');
  const max = safeInteger(grant.maxUnits, 'maxUnits');
  const used = safeInteger(grant.usedUnits, 'usedUnits');
  const quantity = safeInteger(use.quantity, 'quantity', 1);
  if (used > max || !Number.isSafeInteger(used + quantity)) throw new RangeError('licensed quantity exceeds safe bound');
  const bits = {
    A: identifier(grant.licenseeId, 'grant.licenseeId') === identifier(use.licenseeId, 'use.licenseeId'),
    P: identifier(grant.profileDigest, 'grant.profileDigest') === identifier(use.profileDigest, 'use.profileDigest'),
    T: occurred >= from && occurred < until,
    Q: used + quantity <= max,
    R: revoked === null || occurred < revoked,
  };
  const circuit = run('license', bits);
  const reasons = [
    !bits.A && 'LICENSEE_MISMATCH',
    !bits.P && 'PROCESS_PROFILE_MISMATCH',
    !bits.T && 'OUTSIDE_LICENSE_WINDOW',
    !bits.Q && 'LICENSE_QUOTA_EXCEEDED',
    !bits.R && 'LICENSE_REVOKED',
  ].filter(Boolean);
  return {
    standardVersion: STANDARD_VERSION,
    decision: circuit.output ? 'payable' : 'not-payable',
    reasons,
    inputs: bits,
    feeMinor: circuit.output ? (rate * BigInt(quantity)).toString() : '0',
    circuit,
  };
}

export const STANDARD_VECTORS = Object.freeze({
  firstArticle: Object.freeze([
    Object.freeze({ input: { requiredDemandUnits: 30, committedDemandUnits: 29, requiredBudgetMinor: '1000', committedBudgetMinor: '1000', capabilityConfirmed: true, verifierConfirmed: true, rightsCleared: true }, decision: 'pending' }),
    Object.freeze({ input: { requiredDemandUnits: 30, committedDemandUnits: 30, requiredBudgetMinor: '1000', committedBudgetMinor: '1000', capabilityConfirmed: true, verifierConfirmed: true, rightsCleared: true }, decision: 'ready' }),
  ]),
  acceptance: Object.freeze([
    Object.freeze({ spec: { lowerMicrometers: 9900, upperMicrometers: 10100, requireIndependentMeasurement: true }, evidence: { measuredMicrometers: 10030, uncertaintyMicrometers: 20, unitId: 'piece-1', calibrationValid: true, identityVerified: true, independentMeasurement: true }, decision: 'accept' }),
    Object.freeze({ spec: { lowerMicrometers: 9900, upperMicrometers: 10100, requireIndependentMeasurement: true }, evidence: { measuredMicrometers: 10090, uncertaintyMicrometers: 30, unitId: 'piece-2', calibrationValid: true, identityVerified: true, independentMeasurement: true }, decision: 'review' }),
    Object.freeze({ spec: { lowerMicrometers: 9900, upperMicrometers: 10100, requireIndependentMeasurement: true }, evidence: { measuredMicrometers: 10150, uncertaintyMicrometers: 20, unitId: 'piece-3', calibrationValid: true, identityVerified: true, independentMeasurement: true }, decision: 'reject' }),
  ]),
  license: Object.freeze([
    Object.freeze({ grant: { validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z', rateMinor: '25', maxUnits: 100, usedUnits: 40, licenseeId: 'shop-a', profileDigest: 'rule-1' }, use: { occurredAt: '2026-11-19T12:00:00Z', licenseeId: 'shop-a', profileDigest: 'rule-1', quantity: 3 }, decision: 'payable', feeMinor: '75' }),
  ]),
});

/** Complete bit-level conformance set plus typed examples, ready for public download. */
export function getConformanceVectors() {
  const circuits = Object.fromEntries(Object.entries(profiles).map(([key, profile]) => [
    key,
    {
      profile: circuitProfile(key),
      vectors: truthTable(compiled[key]).map(row => ({
        inputBits: row.inputs,
        inputHex: packBits(row.inputs),
        output: row.output,
        outputHex: packBits([row.output]),
      })),
    },
  ]));
  return {
    version: STANDARD_VERSION,
    circuitFormat: 'TapeOut TAP-02 NAND subset',
    bitOrder: 'first input is bit 0 of the first packed byte',
    circuits,
    typedExamples: STANDARD_VECTORS,
  };
}

/** SHA-256 of the exact UTF-8 JSON emitted by getConformanceVectors(). */
export async function getConformanceDigest() {
  const bytes = new TextEncoder().encode(JSON.stringify(getConformanceVectors()));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
