import app from './locale-app.mjs';
import operations from './locale-operations.mjs';
import core from './locale-core.mjs';
import apiErrors from './locale-api-errors.mjs';

export const LANGUAGE_KEY = 'tc.language';
export const SUPPORTED_LANGUAGES = Object.freeze(['zh-CN', 'en']);
const base = {
  '界面语言': 'Interface language',
  '切换为中文': 'Switch to Chinese',
  '切换为英文': 'Switch to English',
  '工业能力协议与工具链': 'Industrial Capability Protocol & Tools',
  '正在连接工作区…': 'Connecting to your workspace…',
};
const catalog = Object.freeze({ ...Object.fromEntries(Object.entries(apiErrors).map(([en, zh]) => [zh, en])), ...core, ...app, ...operations, ...base });
const missing = new Set();
const normalize = value => value === 'zh-CN' || value === 'zh' ? 'zh-CN' : value === 'en' || value === 'en-US' || value === 'en-GB' ? 'en' : null;
function storedLanguage() {
  if (typeof window === 'undefined') return 'zh-CN';
  try { return normalize(globalThis.localStorage?.getItem(LANGUAGE_KEY)) ?? 'zh-CN'; }
  catch { return 'zh-CN'; }
}
let language = storedLanguage();
export const getLanguage = () => language;
export const getLocale = () => language === 'en' ? 'en-US' : 'zh-CN';

const placeholder = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
function substitute(message, params) {
  return message.replace(placeholder, (whole, key) => Object.hasOwn(params, key) ? String(params[key] ?? '') : whole);
}
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.entries(catalog).flatMap(([source, target]) => {
  const names = [...source.matchAll(placeholder)].map(m => m[1]);
  if (!names.length) return [];
  let end = 0, expression = '^';
  for (const match of source.matchAll(placeholder)) {
    expression += escapeRegExp(source.slice(end, match.index)) + '(.*?)';
    end = match.index + match[0].length;
  }
  return [{ source, target, names, pattern: new RegExp(expression + escapeRegExp(source.slice(end)) + '$', 's') }];
});

/** Translate explicit system copy. Never run this over a business object or DOM. */
export function t(message, params = {}) {
  if (message === null || message === undefined) return '';
  const source = String(message);
  if (language !== 'en') return substitute(source, params);
  if (Object.hasOwn(catalog, source)) return substitute(catalog[source], params);
  // API/driver errors may already contain values. Match only known complete
  // system templates, keeping every captured value unchanged.
  if (/[\u3400-\u9fff]/u.test(source)) {
    for (const entry of patterns) {
      const match = entry.pattern.exec(source);
      if (!match) continue;
      const captured = Object.create(null);
      entry.names.forEach((name, i) => { captured[name] = match[i + 1]; });
      return substitute(entry.target, { ...captured, ...params });
    }
    missing.add(source);
  }
  return substitute(source, params);
}
export const hasTranslation = message => Object.hasOwn(catalog, String(message));
export const getMissingTranslations = () => [...missing];
export const getMissingMessages = getMissingTranslations;
export const clearMissingTranslations = () => missing.clear();
export const getCatalogStats = () => ({ app: Object.keys(app).length, operations: Object.keys(operations).length, core: Object.keys(core).length, total: Object.keys(catalog).length });

const errorPatterns = Object.entries(apiErrors).flatMap(([source, target]) => {
  const names = [...source.matchAll(placeholder)].map(m => m[1]);
  if (!names.length) return [];
  let end = 0, expression = '^';
  for (const match of source.matchAll(placeholder)) {
    expression += escapeRegExp(source.slice(end, match.index)) + '(.*?)';
    end = match.index + match[0].length;
  }
  return [{ target, names, pattern: new RegExp(expression + escapeRegExp(source.slice(end)) + '$', 's') }];
});
/** Present an error in the chosen language without modifying the error/code. */
export function errorMessage(error) {
  const source = typeof error?.message === 'string' ? error.message : String(error ?? '');
  if (language === 'en') return t(source);
  if (Object.hasOwn(apiErrors, source)) return apiErrors[source];
  for (const entry of errorPatterns) {
    const match = entry.pattern.exec(source);
    if (!match) continue;
    const values = Object.create(null);
    entry.names.forEach((key, i) => { values[key] = match[i + 1]; });
    return substitute(entry.target, values);
  }
  return source;
}

function updateDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  document.title = language === 'en' ? 'TwinCircuit · Industrial Capability Protocol & Tools' : 'TwinCircuit · 工业能力协议与工具链';
  const description = document.querySelector('meta[name="description"]');
  if (description) description.content = language === 'en'
    ? 'TwinCircuit: executable specifications, supplier reservations, device workflows, evidence review and traceable settlement.'
    : 'TwinCircuit 工业能力协议与工具链：可执行规格、供应商预约、履约验收与可追溯结算。';
  const loading = document.querySelector('#app > .loading-screen p');
  if (loading) loading.textContent = t('正在连接工作区…');
}

/** No reload, requests, transaction signing or business-state writes. */
export function setLanguage(value) {
  const next = normalize(value);
  if (!next) return false;
  if (next === language) { updateDocument(); return true; }
  const previousLanguage = language;
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    const before = new CustomEvent('twincircuit:beforelanguagechange', { cancelable: true, detail: { language: next, previousLanguage } });
    if (!window.dispatchEvent(before)) return false;
  }
  language = next;
  try { globalThis.localStorage?.setItem(LANGUAGE_KEY, language); } catch { /* A blocked storage API still allows this session to switch. */ }
  updateDocument();
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') window.dispatchEvent(new CustomEvent('twincircuit:languagechange', { detail: { language, previousLanguage } }));
  return true;
}

export function languageSwitcher() {
  return `<div class="language-switcher" role="group" aria-label="${t('界面语言')}"><button type="button" data-action="set-language" data-language="zh-CN" lang="zh-CN" aria-label="${t('切换为中文')}" aria-pressed="${language === 'zh-CN'}">中文</button><button type="button" data-action="set-language" data-language="en" lang="en" aria-label="${t('切换为英文')}" aria-pressed="${language === 'en'}">EN</button></div>`;
}

updateDocument();
