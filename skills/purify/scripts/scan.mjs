#!/usr/bin/env node
// Read-only scanner for Codex-style pollution in AI agent setups and repositories.
//
//   node scan.mjs agents           agent instructions, rules, memory, skills, hooks, settings
//   node scan.mjs project <path>   one repository: agent rules, design docs, docs, comments, code leads
//   add --json for machine-readable output
//
// The scanner reads instruction text and a few named configuration keys. It writes nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const OWN_DIR = fs.realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const [mode, target] = argv.filter((a) => !a.startsWith('--'));
const MAX_BYTES = 1_000_000;
const SAMPLES = 3;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'oh_modules', 'target', 'dist', 'build', 'out', 'vendor', '.next', '.venv', 'venv', '__pycache__', 'coverage', 'Pods', 'DerivedData', '.gradle', '.idea']);
// Agent-managed worktrees hold copies of the repository's own files.
const WORKTREES = /[\\/]\.(?:claude|codex)[\\/]worktrees$/;
// Directories that hold private material: report counts only.
const PRIVATE = /[\\/][^\\/]*(?:private|secret|credential)[^\\/]*[\\/]/i;

// Pollution patterns. Hits are leads: the agent confirms each one by reading the file.
const PATTERNS = [
  { id: 'not-done', label: 'states what was not done or left unchanged', weight: 1,
    re: /未改动|没有改动|未修改|没有修改|没有改任何|保持不变|不涉及|不包含|不包括|未包含|未运行|没有运行|未执行|\b(?:left|remains?|remained|stays?|stayed|kept) unchanged\b|\bno changes? (?:to|were|was)\b|\bdid(?:n't| not) (?:change|modify|touch|run|edit)\b|\bnot (?:included|touched|modified|changed)\b|\bwithout (?:changing|touching|modifying|editing)\b|\bout of scope\b/giu },
  { id: 'proof-boundary', label: 'proof-boundary disclaimer', weight: 1.5,
    re: /不代表|不证明|不能证明|不等于|并不意味着|不意味着|未验证|未经验证|仅证明|只证明|\bdoes(?:n't| not) (?:prove|establish|guarantee|imply)\b|\bproves? only\b|\bonly proves\b|\b(?:as|remains?) unverified\b|\bunverified unless\b|\bproof (?:boundar(?:y|ies)|levels?)\b/giu },
  { id: 'authorization', label: 'authorization boilerplate', weight: 1.5,
    re: /不授权|不授予|未授权|不构成授权|不是[^。\n]{0,8}授权|不得用于[^。\n]{0,20}授权|只允许修改|不(?:提交|commit)[^。\n]{0,6}(?:push|推送)|不(?:推送|\s?push)|\bdo(?:es)?(?:n't| not) authori[sz]e\b|\bgrants? no (?:additional )?(?:authori[sz]ation|permission)\b|\bno additional authori[sz]ation\b|\bis not (?:an )?authori[sz]ation\b/giu,
    // End-user permission wording in app code and docs is a different thing.
    skip: /权限|弹窗|登录|账号|token|permission|用户未授权/iu },
  { id: 'contrast', label: '"X, not Y" contrast', weight: 0.5,
    re: /不是[^。！？\n]{1,30}而是|而不是|而非|\b(?:is|are|was|it's|this is) not [^.,;\n]{1,40}[,;—–]\s*(?:but|it's|it is)\b|[^.;\n]{3,60}, not [a-z][^.;\n]{2,40}(?=[.;\n])/giu },
  { id: 'hypothetical', label: 'hypothetical-risk hedge', weight: 0.5,
    re: /以防万一|潜在风险|\bjust in case\b|\bto be safe\b|\bas a precaution\b/giu },
  { id: 'codex-log', label: 'Codex task-log memory format', weight: 2,
    re: /rollout_summary_files|Failures and how to do differently|^#{2,3} Task \d+\b|\bthread_id=|\breuse_rule=|^applies_to:/gimu },
  { id: 'codex-tools', label: 'names Codex-only tools', weight: 2,
    re: /\b(?:spawn_agent|send_message_to_thread|send_input|wait_agent|close_agent|apply_patch|request_user_input|exec_command|write_stdin|view_image|js_repl)\b/gu },
  { id: 'slop', label: 'stock phrase', weight: 0.5,
    re: /\bdelve\b|\bleverag(?:e|ing)\b|it'?s worth noting|\bbottom line:|\bin short:|\bgenuinely\b/giu },
  { id: 'jargon', label: 'coined compound noun', weight: 0.5,
    re: /记账|保真|回签|收口|口径|闭环|抓手|拉齐|卡点|颗粒度|赋能|打通|\bclose the loop\b|\bnorth star\b/giu },
  { id: 'local-path', label: 'personal or machine-local path', weight: 1,
    re: /\/Users\/[^/\s`'")]+\/|\/home\/[^/\s`'")]+\/|[A-Z]:\\Users\\|~\/\.(?:claude|codex)\/(?:plans|projects|sessions)\b/gu },
  // Counted per file in scanText: labels used but never defined in the same file.
  { id: 'label', label: 'internal label never explained in the file', weight: 0.5, fileLevel: true },
];
// Internal labels: round, item, and section codes such as R6, T2, PRF5, ⑧.
const LABEL = /(?<![\w./-])(?:[A-Z]{1,4}\d{1,2}[a-z]?(?![\w./-])|[A-Z]{2,}-[A-Z]?\d+(?:\.[A-Z0-9]+)?(?![\w/-]))|[①-⑳]/gu;
const COMMON_PREFIX = /^(?:GPT|UTF|ISO|SHA|AES|RFC|ECMA|IEEE|CVE|GPL|LGPL|AGPL|MPL|BSD|HTTP|TLS|CSS|ES|IP|MD|RSA|EC|ED|UTC|GMT|PEP|JSR|ARM|SSE|AVX)-/;
const COMMON_LABEL = new Set([
  'H2', 'H3', 'L4', 'L7', 'S3', 'EC2', 'P50', 'P90', 'P95', 'P99', 'Q1', 'Q2', 'Q3', 'Q4', 'MP3', 'MP4', 'W3C', 'X11', 'IE11', 'ES5', 'ES6', 'U2F',
  'P0', 'P1', 'P2', 'P3', 'P4', 'DNS64', 'NAT64', 'HTTP2', 'HTTP3', 'UTF8', 'UTF16', 'IPV4', 'IPV6', 'MD5', 'SHA1', 'SHA2', 'SHA3', 'TLS12', 'TLS13', 'AV1', 'VP8', 'VP9', 'BASE64', 'ARM64', 'X64', 'X86',
]);
const isCommonLabel = (l) => COMMON_LABEL.has(l) || COMMON_PREFIX.test(l);

// A line defines a label when it is a heading, starts with the label (list item, table cell),
// puts a colon or parenthesis right after it, or wraps it in parentheses after the full name.
function definesLabel(line, label, index) {
  if (/^\s*#{1,6}\s/.test(line)) return true;
  if (/^\s*(?:[-*+]|\d+[.)]|\|)?\s*\**\s*$/.test(line.slice(0, index))) return true;
  const after = line.slice(index + label.length);
  if (/^\s*\**\s*[（(:：=—]/u.test(after)) return true;
  // Ranges such as "L0–L6：" define every label in them.
  const RANGE_END = /^\s*[–~-]\s*[A-Z]{1,4}\d{1,2}[a-z]?\s*\**\s*[（(:：=—]/u;
  if (RANGE_END.test(after)) return true;
  // Mapping lines such as "映射：阶段一 S1；阶段二 S2" name each label right before it.
  if (/[:：]/.test(line.slice(0, index)) && /[\p{Script=Han}A-Za-z)）]\s+$/u.test(line.slice(0, index)) && /^\s*(?:[；;，,。]|$)/u.test(after)) return true;
  if (/[A-Z]{1,4}\d{1,2}[a-z]?\s*[–~-]\s*$/u.test(line.slice(0, index)) && /^\s*\**\s*[（(:：=—]/u.test(after)) return true;
  return /[（(]\s*$/u.test(line.slice(0, index)) && /^\s*[)）]/u.test(after);
}
const PROHIBITION = /不得|严禁|禁止|切勿|\bnever\b|\bmust not\b|\bdo not\b|\bdon'?t\b/giu;
// Quoted text is usually the user's own words or an example: leave it out of matching.
const QUOTED = /“[^”\n]{0,120}”|「[^」\n]{0,120}」|『[^』\n]{0,120}』|"[^"\n]{0,120}"/gu;
// Lines that present a pattern as a bad example (antidote rules, before/after pairs).
const EXAMPLE = /^\s*[-*|]?\s*(?:Avoid|Before|Bad|Found|避免|反例)\s*[:：|]/u;
const COMMENT = /^\s*(?:\/\/|#(?!!)|\*|\/\*|--|<!--)/;

const CODE_LEADS = [
  { id: 'empty-default', label: 'default that may hide missing data', ext: /\.(?:[cm]?[jt]sx?|ets)$/, re: /\?\?\s*(?:''|""|\[\]|\{\}|0\b|null\b)|\|\|\s*(?:\{\}|\[\]|''|"")/g },
  { id: 'swallowed', label: 'swallowed error', ext: /\.(?:[cm]?[jt]sx?|ets|py)$/, re: /catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*(?:\}|return\b)|except(?:\s+\w+)?\s*:\s*(?:pass|return|continue)\b/g },
  { id: 'silent-default', label: 'silent Rust default or discard', ext: /\.rs$/, re: /\.unwrap_or_default\(\)|\.unwrap_or\(|\.ok\(\)\s*[;?)]|\blet _ = /g },
  { id: 'platform-branch', label: 'platform branch', ext: /\.(?:rs|[cm]?[jt]sx?|py|go)$/, re: /cfg\(not\(unix\)\)|cfg\(windows\)|process\.platform\s*===?\s*['"]win32['"]|sys\.platform\s*==\s*['"]win32['"]|runtime\.GOOS\s*==\s*"windows"/g },
  { id: 'marker', label: 'fallback/legacy/compat/retry marker', ext: /\.(?:rs|[cm]?[jt]sx?|ets|py|go|kt|swift|java|sh)$/, re: /\b(?:fallback|legacy|compat(?:ibility)?|shim|polyfill|retry|retries)\b/gi },
];
const AGENT_NAMES = /\b(claude|codex|gemini|antigravity|cursor|windsurf|copilot|opencode|amp|kiro)\b/i;

// ---------- file helpers ----------
const home = (p) => (p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p);
function exists(p) { try { fs.lstatSync(p); return true; } catch { return false; } }
function readText(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    const buf = fs.readFileSync(p);
    return buf.includes(0) ? null : buf.toString('utf8');
  } catch { return null; }
}
function realpath(p) { try { return fs.realpathSync(p); } catch { return p; } }
function mtime(p) { try { return fs.statSync(p).mtime.toISOString().slice(0, 10); } catch { return ''; } }
function size(p) { try { return fs.statSync(p).size; } catch { return 0; } }
function listDir(p) { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } }
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
// The skill's own files: this copy, and any other installed copy (a purify folder holding PURIFY.md and the scanner).
const own = (p) => {
  const r = realpath(p);
  if (r === OWN_DIR || r.startsWith(OWN_DIR + path.sep)) return true;
  const copy = r.match(/^(.*[\\/]purify)[\\/]/)?.[1];
  return !!copy && exists(path.join(copy, 'PURIFY.md')) && exists(path.join(copy, 'scripts', 'scan.mjs'));
};

function walk(dir, { depth = 4, match = () => true, out = [] } = {}) {
  if (depth < 0) return out;
  for (const e of listDir(dir)) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !WORKTREES.test(p)) walk(p, { depth: depth - 1, match, out }); }
    else if ((e.isFile() || e.isSymbolicLink()) && match(p, e.name)) out.push(p);
  }
  return out;
}

// ---------- text scanning ----------
function scanText(text, { codeComments = false } = {}) {
  const hits = {};
  const used = new Map();
  const defined = new Set();
  let chars = 0;
  for (const [i, raw] of text.split('\n').entries()) {
    if (codeComments && !COMMENT.test(raw)) continue;
    chars += raw.length + 1;
    if (EXAMPLE.test(raw)) continue;
    const line = raw.replace(QUOTED, '');
    if (!codeComments) {
      for (const m of line.matchAll(LABEL)) {
        if (isCommonLabel(m[0])) continue;
        if (!used.has(m[0])) used.set(m[0], { line: i + 1, text: raw.trim().slice(0, 140) });
        if (definesLabel(line, m[0], m.index)) defined.add(m[0]);
      }
    }
    for (const p of PATTERNS) {
      // In code comments, contrasts usually explain a design choice.
      if (p.fileLevel || (codeComments && p.id === 'contrast') || p.skip?.test(line)) continue;
      const n = (line.match(p.re) || []).length;
      if (!n) continue;
      const h = (hits[p.id] ??= { count: 0, samples: [] });
      h.count += n;
      if (h.samples.length < SAMPLES) h.samples.push({ line: i + 1, text: raw.trim().slice(0, 160) });
    }
  }
  const open = [...used].filter(([l]) => !defined.has(l));
  if (open.length) {
    hits.label = {
      count: open.length,
      labels: open.map(([l]) => l),
      samples: open.slice(0, SAMPLES).map(([l, u]) => ({ line: u.line, text: `${l} — ${u.text}` })),
    };
  }
  const weighted = PATTERNS.reduce((s, p) => s + (hits[p.id]?.count ?? 0) * p.weight, 0);
  return {
    hits,
    chars,
    weighted: +weighted.toFixed(1),
    density: chars ? +(weighted * 1000 / chars).toFixed(2) : 0,
    prohibitions: codeComments ? 0 : (text.match(PROHIBITION) || []).length,
    definedLabels: [...defined],
  };
}

// The purify rules, installed as PURIFY.md or inline between these markers, quote the patterns they
// replace, so they are recorded as loaded and left out of matching, along with the @ line that
// imports PURIFY.md (an absolute path in Codex's AGENTS.md).
const PURIFY_BLOCK = /<!-- purify-codex:start -->[\s\S]*?<!-- purify-codex:end -->/;
const PURIFY_IMPORT = /^@\S*PURIFY\.md[ \t]*$/gm;

function fileReport(p, extra = {}) {
  const text = readText(p);
  if (text == null) return null;
  const link = fs.lstatSync(p).isSymbolicLink() ? realpath(p) : null;
  const purify = path.basename(p) === 'PURIFY.md' || PURIFY_BLOCK.test(text);
  const scanned = scanText(path.basename(p) === 'PURIFY.md' ? '' : text.replace(PURIFY_BLOCK, '').replace(PURIFY_IMPORT, ''));
  return { path: p, link, modified: mtime(p), ...scanned, ...(purify && { purify, chars: text.length }), ...extra };
}

// ---------- agent registry ----------
const H = (...p) => path.join(HOME, ...p);
const MAC = (...p) => path.join(HOME, 'Library', 'Application Support', ...p);
const APPDATA = process.env.APPDATA;
const AGENTS = [
  { name: 'Codex', marker: [H('.codex')],
    instructions: [H('.codex', 'AGENTS.md'), H('.codex', 'AGENTS.override.md')],
    memory: { dirs: [H('.codex', 'memories')], injected: [H('.codex', 'memories', 'memory_summary.md')], owner: 'Codex regenerates this directory from its session logs' },
    skills: [H('.codex', 'skills'), H('.codex', 'memories', 'skills')],
    prompts: [H('.codex', 'prompts')],
    hooks: [H('.codex', 'hooks.json')], tomlHooks: [H('.codex', 'config.toml')] },
  { name: 'Claude Code', marker: [H('.claude')],
    instructions: [H('.claude', 'CLAUDE.md')], rules: [H('.claude', 'rules')],
    memory: { dirs: [H('.claude', 'projects')], claudeProjects: true },
    skills: [H('.claude', 'skills')],
    prompts: [H('.claude', 'agents'), H('.claude', 'commands'), H('.claude', 'output-styles')],
    hooks: [H('.claude', 'settings.json'), H('.claude', 'settings.local.json')] },
  { name: 'Claude app', marker: [MAC('Claude'), APPDATA && path.join(APPDATA, 'Claude')],
    skills: [MAC('Claude', 'local-agent-mode-sessions', 'skills-plugin'), APPDATA && path.join(APPDATA, 'Claude', 'local-agent-mode-sessions', 'skills-plugin')], deepSkills: true,
    account: 'personal preferences, styles, and project instructions' },
  { name: 'Antigravity', marker: [H('.gemini', 'antigravity')],
    instructions: [H('.gemini', 'GEMINI.md'), H('.gemini', 'AGENTS.md')],
    memory: { dirs: [H('.gemini', 'antigravity', 'knowledge')] },
    skills: [H('.gemini', 'antigravity', 'skills'), H('.gemini', 'antigravity', 'global_skills')] },
  { name: 'Gemini CLI', marker: [H('.gemini', 'settings.json')],
    instructions: [H('.gemini', 'GEMINI.md')], skills: [H('.gemini', 'skills')], hooks: [H('.gemini', 'settings.json')] },
  { name: 'Cursor', marker: [H('.cursor')], rules: [H('.cursor', 'rules')], skills: [H('.cursor', 'skills')], account: 'User Rules (Settings → Rules)' },
  { name: 'Windsurf', marker: [H('.codeium', 'windsurf')],
    instructions: [H('.codeium', 'windsurf', 'memories', 'global_rules.md')],
    memory: { dirs: [H('.codeium', 'windsurf', 'memories')] }, skills: [H('.codeium', 'windsurf', 'skills')] },
  { name: 'GitHub Copilot', marker: [H('.copilot'), MAC('Code', 'User', 'prompts'), H('.config', 'Code', 'User', 'prompts')],
    rules: [MAC('Code', 'User', 'prompts'), H('.config', 'Code', 'User', 'prompts'), APPDATA && path.join(APPDATA, 'Code', 'User', 'prompts')], skills: [H('.copilot', 'skills')] },
  { name: 'OpenCode', marker: [H('.config', 'opencode')], instructions: [H('.config', 'opencode', 'AGENTS.md')], skills: [H('.config', 'opencode', 'skills')] },
  { name: 'Amp', marker: [H('.config', 'amp')], instructions: [H('.config', 'amp', 'AGENTS.md')], skills: [H('.config', 'agents', 'skills')] },
  { name: 'Kiro', marker: [H('.kiro')], rules: [H('.kiro', 'steering')], skills: [H('.kiro', 'skills')] },
  { name: 'Shared (home)', marker: [HOME], instructions: [H('AGENTS.md'), H('CLAUDE.md'), H('GEMINI.md')], skills: [H('.agents', 'skills')], optional: true },
];
const TEXT_FILE = /\.(?:md|mdc|txt)$/i;
const clean = (list) => (list ?? []).filter(Boolean);

function skillFiles(dir, deep) {
  if (deep) return walk(dir, { depth: 6, match: (_, n) => n === 'SKILL.md' });
  return listDir(dir).filter((e) => e.isDirectory() || e.isSymbolicLink())
    .map((e) => path.join(dir, e.name, 'SKILL.md')).filter(exists);
}

function importsOf(file) {
  const text = readText(file) ?? '';
  return [...text.matchAll(/^@(\S+)\s*$/gm)].map((m) => resolveRef(m[1], file));
}
function resolveRef(ref, file) {
  const r = ref.replace(/[:#]\d+.*$/, '').replace(/[.,;)]+$/, '');
  return r.startsWith('~') ? path.join(HOME, r.slice(1)) : path.isAbsolute(r) ? r : path.join(path.dirname(file), r);
}
function brokenRefs(file) {
  const text = readText(file) ?? '';
  const refs = new Set();
  for (const m of text.matchAll(/^@(\S+)\s*$/gm)) refs.add(m[1]);
  for (const m of text.matchAll(/`((?:~|\/Users|\/home)\/[^`\s]+)`/g)) refs.add(m[1]);
  return [...refs].filter((r) => !/[<>*{}$]/.test(r) && !exists(resolveRef(r, file)));
}

function hookEntry(file, agent, event, command) {
  const other = command.match(AGENT_NAMES)?.[1];
  const foreign = other && !agent.toLowerCase().includes(other.toLowerCase()) ? other : null;
  return { file, event, command: command.slice(0, 100), foreign, injects: ['SessionStart', 'UserPromptSubmit', 'BeforeAgent'].includes(event) };
}

function hookReport(file, agent) {
  const text = readText(file);
  if (!text) return [];
  let data;
  try { data = JSON.parse(text); } catch { return [{ file, event: '-', command: 'not valid JSON' }]; }
  const out = [];
  for (const [event, groups] of Object.entries(data.hooks ?? {})) {
    for (const g of [groups].flat()) for (const h of g?.hooks ?? [g]) {
      if (h?.command) out.push(hookEntry(file, agent, event, String(h.command)));
    }
  }
  return out;
}

// Codex also declares hooks in config.toml as [[hooks.<Event>.hooks]] tables.
function tomlHookReport(file, agent) {
  const text = readText(file);
  if (!text) return [];
  const out = [];
  let event = null;
  for (const line of text.split('\n')) {
    const header = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/);
    if (header) { event = header[1].match(/^hooks\.(\w+)\.hooks$/)?.[1] ?? null; continue; }
    const cmd = event && line.match(/^\s*command\s*=\s*"((?:[^"\\]|\\.)*)"/);
    if (!cmd) continue;
    let command = cmd[1];
    try { command = JSON.parse(`"${cmd[1]}"`); } catch { /* keep the raw TOML string */ }
    out.push(hookEntry(file, agent, event, command));
  }
  return out;
}

function memoryReport(spec) {
  const files = spec.claudeProjects
    ? spec.dirs.flatMap((d) => listDir(d).filter((e) => e.isDirectory())
      .flatMap((e) => walk(path.join(d, e.name, 'memory'), { depth: 1, match: (p) => p.endsWith('.md') })))
    : spec.dirs.flatMap((d) => walk(d, { depth: 3, match: (p) => TEXT_FILE.test(p) }));
  if (!files.length && !clean(spec.injected).some(exists)) return null;
  const injectedPaths = new Set(clean(spec.injected));
  if (spec.claudeProjects) files.filter((f) => path.basename(f) === 'MEMORY.md').forEach((f) => injectedPaths.add(f));
  const reports = files.map((f) => fileReport(f)).filter(Boolean);
  return {
    files: files.length,
    bytes: files.reduce((s, f) => s + size(f), 0),
    taskLog: reports.filter((r) => r.hits['codex-log']).length,
    owner: spec.owner,
    injected: [...injectedPaths].map((f) => fileReport(f)).filter((r) => r && (r.weighted || !spec.claudeProjects)),
    top: spec.owner ? [] : reports.filter((r) => r.weighted && !injectedPaths.has(r.path)).sort((a, b) => b.weighted - a.weighted).slice(0, 6),
  };
}

function codexConfig() {
  const text = readText(H('.codex', 'config.toml'));
  if (!text) return null;
  const want = /^(developer_instructions|model_instructions_file|experimental_instructions_file|project_doc_fallback_filenames|project_doc_max_bytes|external-agent-import-sync-enabled|external-agent-import-sync-item-types|memories|generate_memories|use_memories|model|model_verbosity|personality)$/;
  let section = '';
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (s) { section = s[1]; continue; }
    const kv = line.match(/^\s*([\w-]+)\s*=\s*(.*)$/);
    if (kv && want.test(kv[1])) out.push({ section, key: kv[1], value: kv[2].trim().slice(0, 80) });
  }
  return out;
}

function claudeSettings() {
  const text = readText(H('.claude', 'settings.json'));
  if (!text) return null;
  try { const s = JSON.parse(text); return { autoMemoryEnabled: s.autoMemoryEnabled ?? true, outputStyle: s.outputStyle ?? null }; }
  catch { return { error: 'settings.json is not valid JSON' }; }
}

function normalize(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '').toLowerCase()
    .replace(/\b(?:claude code|gemini cli|codex|claude|gemini|antigravity|cursor|windsurf|copilot|opencode)\b/g, 'agent')
    .replace(/\.(?:codex|claude|gemini|cursor)\b/g, '.agent')
    .replace(/\b(?:agents|claude|gemini)\.md\b/g, 'rules.md')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function duplicates(files) {
  const norm = [...new Set(files)].map((f) => ({ path: f, raw: (readText(f) ?? '').replace(PURIFY_BLOCK, '') })).map((f) => ({ ...f, lines: normalize(f.raw) })).filter((f) => f.lines.length > 3);
  const out = [];
  for (let i = 0; i < norm.length; i++) for (let j = i + 1; j < norm.length; j++) {
    const a = new Set(norm[i].lines), b = new Set(norm[j].lines);
    const inter = [...a].filter((l) => b.has(l)).length;
    const jaccard = inter / (a.size + b.size - inter);
    if (jaccard < 0.6) continue;
    const kind = norm[i].raw === norm[j].raw ? 'exact copy'
      : norm[i].lines.join('\n') === norm[j].lines.join('\n') ? 'copy with agent names swapped'
      : `near copy (${Math.round(jaccard * 100)}% shared lines)`;
    out.push({ a: norm[i].path, b: norm[j].path, kind });
  }
  return out;
}

// Instruction files inside agent directories (archives, imports, backups) load when an agent works there.
function strayInstructions(primary) {
  const skip = new Set(primary.map(realpath));
  return [H('.claude'), H('.codex'), H('.gemini')].flatMap((d) => walk(d, {
    depth: 3,
    match: (p, n) => /^(?:AGENTS|CLAUDE|GEMINI)(?:\.override|\.local)?\.md$/i.test(n) && !/[\\/](?:skills|projects|sessions|plugins)[\\/]/.test(p) && !skip.has(realpath(p)),
  })).map((p) => fileReport(p)).filter(Boolean);
}

function auditAgents() {
  const agents = [];
  const primary = [];
  const skillsByContent = new Map();
  const skillsByName = new Map();
  for (const a of AGENTS) {
    const installed = clean(a.marker).some(exists);
    if (!installed) continue;
    const entry = { name: a.name, checked: clean(a.instructions).map(home), instructions: [], rules: [], prompts: [], hooks: [], account: a.account };
    for (const p of clean(a.instructions)) {
      const r = fileReport(p);
      if (!r) continue;
      primary.push(p);
      r.broken = brokenRefs(p);
      r.imports = importsOf(p).map((f) => fileReport(f)).filter(Boolean);
      entry.instructions.push(r);
    }
    if (entry.checked.length) entry.purify = entry.instructions.some((r) => r.purify || r.imports.some((i) => i.purify));
    for (const d of clean(a.rules)) for (const p of walk(d, { depth: 2, match: (f) => TEXT_FILE.test(f) })) {
      const r = fileReport(p);
      if (r) { entry.rules.push(r); primary.push(p); }
    }
    for (const d of clean(a.prompts)) for (const p of walk(d, { depth: 2, match: (f) => TEXT_FILE.test(f) })) {
      const r = fileReport(p);
      if (r && r.weighted) entry.prompts.push(r);
    }
    if (a.memory) entry.memory = memoryReport(a.memory);
    for (const f of clean(a.hooks)) entry.hooks.push(...hookReport(f, a.name));
    for (const f of clean(a.tomlHooks)) entry.hooks.push(...tomlHookReport(f, a.name));
    const skillPaths = clean(a.skills).flatMap((d) => skillFiles(d, a.deepSkills)).filter((p) => !own(p));
    if (skillPaths.length) {
      const names = [];
      for (const p of skillPaths) {
        const text = readText(p);
        if (text == null) continue;
        const name = path.basename(path.dirname(p));
        names.push(name);
        const key = hash(text);
        let r = skillsByContent.get(key);
        if (!r) { r = { ...fileReport(p), name, agents: new Set(), copies: new Set() }; skillsByContent.set(key, r); }
        r.agents.add(a.name);
        r.copies.add(home(p));
        skillsByName.set(name, new Set([...(skillsByName.get(name) ?? []), key]));
      }
      entry.skills = { count: skillPaths.length, names: names.length <= 5 ? names : null };
    }
    agents.push(entry);
  }
  // Codex-only tool names matter only outside Codex's own files.
  const skills = [...skillsByContent.values()].map((r) => {
    const agentsList = [...r.agents];
    if (agentsList.every((x) => x === 'Codex')) delete r.hits['codex-tools'];
    const weighted = PATTERNS.reduce((s, p) => s + (r.hits[p.id]?.count ?? 0) * p.weight, 0);
    return { ...r, agents: agentsList, copies: [...r.copies], weighted };
  });
  const diverged = [...skillsByName].filter(([, keys]) => keys.size > 1).map(([name, keys]) => ({
    name,
    copies: [...keys].map((k) => skills.find((s) => hash(readText(s.path) ?? '') === k)).filter(Boolean).map((s) => ({ copies: s.copies, modified: s.modified })),
  }));
  return {
    agents,
    skills: skills.filter((s) => s.weighted).sort((a, b) => b.weighted - a.weighted).slice(0, 10),
    divergedSkills: diverged,
    duplicates: duplicates(primary),
    stray: strayInstructions(primary),
    codexConfig: codexConfig(),
    claudeSettings: claudeSettings(),
  };
}

function gitRoot(dir) {
  for (let d = dir; d && d !== path.dirname(d); d = path.dirname(d)) if (exists(path.join(d, '.git'))) return d;
  return null;
}

// ---------- project audit ----------
function git(root, args) {
  try { return execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
}
const RULE_FILE = /^(?:AGENTS(?:\.override)?\.md|CLAUDE(?:\.local)?\.md|GEMINI\.md|\.cursorrules|\.windsurfrules|\.clinerules|copilot-instructions\.md|.*\.instructions\.md|.*\.mdc|SKILL\.md)$/i;
const RULE_DIR = /[\\/](?:\.cursor[\\/]rules|\.agents?[\\/]rules|\.agents?[\\/]workflows|\.windsurf[\\/]rules|\.clinerules|\.roo[\\/]rules|\.kiro[\\/]steering|\.github[\\/]instructions|docs[\\/](?:agents?|roles))[\\/]/i;

// Design documents: Markdown under these directories, tracked or git-ignored.
const DESIGN_DIR = /^(?:docs?|designs?|design-docs|rfcs?|adrs?|specs?|proposals?|decisions?|plans?)$/i;
const DESIGN_SECTIONS = [
  { id: 'scope-list', label: 'non-goals, limitations, or out-of-scope section',
    re: /^(?:[\d.]+[.)]?\s*)?(?:non-?goals?|out of scope|not in scope|(?:known )?limitations?|caveats|deferred|what (?:this|we) (?:will not|won't) do|非目标|不做|不包括|不属于|不在(?:本次)?范围|范围外|边界|后置项|暂缓项|后续项|待定项|限制|局限|已知限制|未验证)/i },
  { id: 'process-log', label: 'implementation log, handoff, or review record inside the doc',
    re: /^(?:[\d.]+[.)]?\s*)?(?:implementation (?:log|record|notes)|handoff|review (?:log|record|notes)|status update|progress|session log|实施记录|交接记录|开发交接|交接状态|独立复核|独立只读审查|审查与处理|核对与补证|进度|续作|恢复上下文|会话记录|本轮|环境与踩坑|已验证\s*[\/／]\s*待验证)|给.{0,12}AI/i },
];
// Deeper headings that carry a date are usually entries of a running log.
const DATED_HEADING = /\d{4}-\d{2}-\d{2}/;
const LOG_FILE = /progress|handoff|worklog|journal/i;
// A status line near the top that still says the design is pending.
const STATUS_LINE = /(?:状态|Status)\**\s*[:：]\s*\**([^。\n]+)/iu;
const PENDING_ANYWHERE = /No-?Go|尚未实现|仍在推进|待测定|待实测|\bTBD\b/iu;
const PENDING = /尚未实现|仍在推进|进行中|未实现|未实施|no-?go|\bTBD\b|待定|草案|\bdraft\b|proposed|待开发|待确认|pending|not (?:yet )?implemented/iu;
const DESIGN_TERMS = [
  { id: 'compat', label: 'compatibility or migration for older versions', weight: 0.5, re: /backwards?[- ]?compat|(?<![-\w])legacy\b|migrat(?:e|ion)|deprecat|向后兼容|兼容旧|旧版本|迁移|过渡期/gi },
  { id: 'speculative', label: 'speculative extension point', weight: 0.5, re: /future[- ]proof|extensib|extension point|pluggable|for future use|later we (?:can|could)|预留|扩展点|可扩展|将来|未来可能|后续可/gi },
  { id: 'fallback', label: 'fallback, retry, or degradation', weight: 0.25, re: /\bfallback\b|graceful degradation|circuit breaker|\bretr(?:y|ies)\b|降级|兜底|重试/gi },
];

function designDirs(root) {
  // A repository that is itself a design folder (a nested design repo) is audited as one.
  if (DESIGN_DIR.test(path.basename(root))) return [root];
  const out = [];
  const visit = (dir, depth) => {
    for (const e of listDir(dir)) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (DESIGN_DIR.test(e.name)) out.push(p);
      else if (depth > 0) visit(p, depth - 1);
    }
  };
  visit(root, 2);
  return out;
}

function designReport(file, root, trackedSet) {
  const text = readText(file);
  if (text == null) return null;
  const rel = path.relative(root, file);
  const sections = Object.fromEntries(DESIGN_SECTIONS.map((s) => [s.id, { count: 0, lines: 0, headings: [] }]));
  let current = null;
  let level = 0;
  for (const line of text.split('\n')) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const s = DESIGN_SECTIONS.find((d) => d.re.test(h[2].trim()))
        ?? (h[1].length >= 3 && DATED_HEADING.test(h[2]) ? DESIGN_SECTIONS.find((d) => d.id === 'process-log') : null);
      // A plain subheading stays inside the current section; a matching one starts its own.
      if (current && h[1].length > level && !s) continue;
      current = s ? sections[s.id] : null;
      level = h[1].length;
      if (current) { current.count++; if (current.headings.length < 3) current.headings.push(h[2].trim().slice(0, 60)); }
      continue;
    }
    if (current && line.trim()) current.lines++;
  }
  const lines = text.split('\n');
  const terms = Object.fromEntries(DESIGN_TERMS.map((t) => [t.id, (text.match(t.re) || []).length]));
  const termSamples = Object.fromEntries(DESIGN_TERMS.map((t) => {
    const i = lines.findIndex((l) => new RegExp(t.re.source, 'iu').test(l));
    return [t.id, i < 0 ? null : { line: i + 1, text: lines[i].trim().slice(0, 140) }];
  }));
  const statusAt = lines.slice(0, 25).findIndex((l) => STATUS_LINE.test(l));
  const statusText = statusAt < 0 ? '' : lines[statusAt].match(STATUS_LINE)[1].trim().slice(0, 140);
  const status = statusAt < 0 ? null : { line: statusAt + 1, text: statusText, pending: PENDING.test(statusText) };
  const pendingAt = lines.map((l, i) => [l, i]).filter(([l, i]) => i !== statusAt && PENDING_ANYWHERE.test(l));
  const pendingMentions = { count: pendingAt.length, samples: pendingAt.slice(0, 2).map(([l, i]) => ({ line: i + 1, text: l.trim().slice(0, 140) })) };
  const base = { path: file, rel, tracked: trackedSet ? trackedSet.has(rel) : null, modified: mtime(file), ...scanText(text), sections, terms, termSamples, status, pendingMentions, logFile: LOG_FILE.test(path.basename(file)) };
  base.designWeight = +(base.weighted + 0.25 * (sections['scope-list'].lines + sections['process-log'].lines)
    + DESIGN_TERMS.reduce((s, t) => s + t.weight * terms[t.id], 0)
    + (status?.pending ? 2 : 0) + Math.min(pendingMentions.count, 4) + (base.logFile ? 5 : 0)).toFixed(1);
  return base;
}

// With a scope, every Markdown file under it counts as a design document and all are listed.
function auditDesigns(root, trackedSet, scopeDir) {
  const isDoc = (p, n) => /\.md$/i.test(n) && !RULE_FILE.test(n) && !RULE_DIR.test(p) && !own(p);
  const files = scopeDir ? walk(scopeDir, { depth: 6, match: isDoc }) : designDirs(root).flatMap((d) => walk(d, { depth: 4, match: isDoc }));
  const archived = files.filter((f) => /[\\/](?:archive|archived|deprecated|old)[\\/]/i.test(f));
  const reports = files.filter((f) => !archived.includes(f)).map((f) => designReport(f, root, trackedSet)).filter(Boolean);
  // Labels defined by any doc in the same audit count as defined.
  const definedSomewhere = new Set(reports.flatMap((r) => r.definedLabels));
  for (const r of reports) {
    const h = r.hits.label;
    if (!h) continue;
    const before = h.count;
    h.labels = h.labels.filter((l) => !definedSomewhere.has(l));
    h.samples = h.samples.filter((s) => h.labels.includes(s.text.split(' — ')[0]));
    h.count = h.labels.length;
    if (!h.count) delete r.hits.label;
    r.weighted = +(r.weighted - 0.5 * (before - h.count)).toFixed(1);
    r.designWeight = +(r.designWeight - 0.5 * (before - h.count)).toFixed(1);
  }
  const folders = new Map();
  for (const r of reports) {
    const folder = path.dirname(r.rel);
    const f = folders.get(folder) ?? { folder, docs: 0, ignored: 0, scopeLines: 0, logLines: 0, logSections: 0, hits: 0 };
    f.docs++;
    if (r.tracked === false) f.ignored++;
    f.scopeLines += r.sections['scope-list'].lines;
    f.logLines += r.sections['process-log'].lines;
    f.logSections += r.sections['process-log'].count;
    f.hits += r.weighted;
    folders.set(folder, f);
  }
  return {
    docs: reports.length,
    archived: archived.length,
    folders: [...folders.values()].sort((a, b) => b.docs - a.docs),
    rels: reports.map((r) => r.rel),
    top: reports.filter((r) => scopeDir || r.designWeight).sort((a, b) => b.designWeight - a.designWeight).slice(0, scopeDir ? undefined : 15),
  };
}

// Docs that scripts, validators, or CI read: a wording edit can break them. Recorded results
// (results/, attempts/, receipts/, snapshots) only mention paths, so they are skipped.
function toolingConsumers(root, tracked, docs) {
  const RECORDS = /(?:^|\/)(?:node_modules|results?|attempts?|receipts?|snapshots?|artifacts?|result-contracts?)\//;
  const SCRIPT = /\.(?:py|sh|mjs|cjs|js|ts)$/i;
  const tooling = tracked.filter((f) => /\.(?:json|py|mjs|cjs|js|ts|sh|ya?ml|toml)$/i.test(f) && !RECORDS.test(f))
    .sort((a, b) => SCRIPT.test(b) - SCRIPT.test(a)).slice(0, 8000);
  const texts = tooling.map((f) => [f, readText(path.join(root, f)) ?? '']);
  for (const d of docs) {
    const needles = [d.rel, path.basename(d.rel)].filter((n) => n.length >= 8);
    const hits = texts.filter(([, text]) => needles.some((n) => text.includes(n))).map(([f]) => f);
    d.consumers = hits.slice(0, 3);
    d.consumerCount = hits.length;
  }
}

// Docs in the audit that no other Markdown file links to or names.
function orphanDocs(root, mdFiles, docs) {
  const texts = mdFiles.map((f) => [f, readText(path.join(root, f)) ?? '']);
  for (const d of docs) {
    const base = path.basename(d.rel);
    d.orphan = !texts.some(([f, text]) => f !== d.rel && text.includes(base));
  }
}

// A path inside a repository narrows the audit to that folder; root-level agent rules still apply.
function auditProject(dir) {
  const abs = path.resolve(dir);
  const root = gitRoot(abs) ?? abs;
  const scope = path.relative(root, abs);
  const inScope = (rel) => !scope || rel === scope || rel.startsWith(scope + path.sep);
  const tracked = git(root, ['ls-files', '-z'])?.split('\0').filter(Boolean) ?? null;
  const trackedSet = new Set(tracked ?? []);
  const files = (tracked ?? walk(root, { depth: 8 }).map((p) => path.relative(root, p))).filter((f) => !own(path.join(root, f)) && inScope(f));
  const status = git(root, ['status', '--porcelain']);
  const agentRules = walk(root, { depth: 5, match: (p, n) => !own(p) && (RULE_FILE.test(n) || (RULE_DIR.test(p) && TEXT_FILE.test(n))) })
    .filter((p) => inScope(path.relative(root, p)) || path.dirname(path.relative(root, p)) === '.')
    .map((p) => fileReport(p, { tracked: tracked ? trackedSet.has(path.relative(root, p)) : null }))
    .filter(Boolean).sort((a, b) => b.weighted - a.weighted);
  const designs = auditDesigns(root, tracked ? trackedSet : null, scope ? abs : null);
  if (tracked) {
    toolingConsumers(root, tracked, designs.top);
    orphanDocs(root, tracked.filter((f) => /\.md$/i.test(f)), designs.top);
  }
  const designRels = new Set(designs.rels);
  const docs = files.filter((f) => /\.md$/i.test(f) && !RULE_FILE.test(path.basename(f)) && !designRels.has(f))
    .map((f) => fileReport(path.join(root, f))).filter((r) => r && r.weighted)
    .sort((a, b) => b.weighted - a.weighted).slice(0, 15);
  const code = Object.fromEntries(CODE_LEADS.map((l) => [l.id, { label: l.label, total: 0, files: [] }]));
  const comments = [];
  for (const f of files) {
    if (/\.min\.|\.lock$|lock\.json$/.test(f) || !CODE_LEADS.some((l) => l.ext.test(f))) continue;
    const full = path.join(root, f);
    const text = readText(full);
    if (!text) continue;
    for (const l of CODE_LEADS) {
      if (!l.ext.test(f)) continue;
      const n = (text.match(l.re) || []).length;
      if (n) { code[l.id].total += n; code[l.id].files.push({ file: f, count: n }); }
    }
    const c = scanText(text, { codeComments: true });
    if (c.weighted) comments.push({ path: full, modified: mtime(full), ...c });
  }
  for (const v of Object.values(code)) v.files = v.files.sort((a, b) => b.count - a.count).slice(0, 8);
  comments.sort((a, b) => b.weighted - a.weighted);
  return {
    root,
    scope: scope || null,
    git: Boolean(tracked),
    dirty: status == null ? null : status.split('\n').filter(Boolean).length,
    agentRules, designs, docs, code,
    comments: comments.slice(0, 12),
  };
}

// ---------- markdown rendering ----------
const LEGEND = 'Each file line shows: last modified, size, pattern hits by type, and weighted hits (`w`). Hits are leads; quoted text and lines marked as bad examples are skipped.';
const hitSummary = (r) => PATTERNS.filter((p) => r.hits[p.id]).map((p) => `${p.id} ${r.hits[p.id].count}`).join(', ');
function samples(r, indent = '  ') {
  if (PRIVATE.test(r.path)) return '';
  return PATTERNS.flatMap((p) => (r.hits[p.id]?.samples ?? []).slice(0, 2).map((s) => `${indent}- ${p.id} L${s.line}: ${s.text}`)).slice(0, 6).join('\n');
}
function fileLine(r, { prohibitions = false } = {}) {
  const link = r.link ? ` → \`${home(r.link)}\`` : '';
  const hits = hitSummary(r);
  const never = prohibitions && r.prohibitions ? `, ${r.prohibitions} never/do-not` : '';
  return `- \`${home(r.path)}\`${link} (${r.modified}, ${r.chars} chars${never}): ${hits ? `${hits}; w ${r.weighted}` : 'no hits'}`;
}
function withSamples(out, r, opts = {}) {
  const indent = opts.indent ?? '';
  out.push(indent + (opts.prefix ? `- ${opts.prefix} ${fileLine(r, opts).slice(2)}` : fileLine(r, opts)));
  const s = samples(r, indent + '  ');
  if (s) out.push(s);
}

function renderAgents(res) {
  const out = ['# Agent setup scan', '', LEGEND, ''];
  for (const a of res.agents) {
    const shared = a.name.startsWith('Shared');
    if (shared && !a.instructions.length && !a.skills) continue;
    out.push(`## ${a.name}`, '');
    if (a.instructions.length) {
      for (const r of a.instructions) {
        withSamples(out, r, { prohibitions: true });
        if (r.broken.length) out.push(`  - broken references: ${r.broken.join(', ')}`);
        for (const i of r.imports) out.push(`  - imports ${fileLine(i).slice(2)}`);
      }
    } else if (a.checked.length && !shared) out.push(`- global instructions: none (checked ${a.checked.join(', ')})`);
    if (a.checked.length && !shared) out.push(`- purify rules (PURIFY.md): ${a.purify ? 'loaded' : 'not loaded'}`);
    for (const r of a.rules) withSamples(out, r, { prohibitions: true });
    for (const r of a.prompts) out.push(fileLine(r));
    const m = a.memory;
    if (m) {
      out.push(`- memory: ${m.files} files, ${Math.round(m.bytes / 1024)} KB, ${m.taskLog} in Codex task-log format${m.owner ? ` (${m.owner})` : ''}`);
      for (const r of m.injected) withSamples(out, r, { indent: '  ', prefix: 'loaded into every session:' });
      for (const r of m.top) out.push('  ' + fileLine(r));
    }
    if (a.skills) out.push(`- skills: ${a.skills.count}${a.skills.names ? ` (${a.skills.names.join(', ')})` : ''}`);
    for (const h of a.hooks) {
      const notes = [h.injects && 'runs at session start or on each prompt', h.foreign && `names another agent: ${h.foreign}`].filter(Boolean).join('; ');
      out.push(`- hook \`${home(h.file)}\` ${h.event}: \`${h.command}\`${notes ? ` (${notes})` : ''}`);
    }
    if (a.account) out.push(`- kept in the account, not on disk: ${a.account}`);
    out.push('');
  }
  if (res.skills.length) {
    out.push('## Skills with the most hits', '', 'Each skill appears once; its copies and the agents that load it are listed.', '');
    for (const s of res.skills) {
      out.push(`- ${s.name} [${s.agents.join(', ')}] (${s.modified}): ${hitSummary(s)}; w ${s.weighted}`);
      out.push(`  - ${s.copies.join(', ')}`);
    }
    out.push('');
  }
  if (res.divergedSkills.length) {
    out.push('## Skills whose copies drifted apart', '');
    for (const d of res.divergedSkills) out.push(`- ${d.name}: ${d.copies.map((c) => `${c.copies.join(', ')} (${c.modified})`).join(' vs ')}`);
    out.push('');
  }
  out.push('## Duplicated instructions', '', ...(res.duplicates.length ? res.duplicates.map((d) => `- ${d.kind}: \`${home(d.a)}\` and \`${home(d.b)}\``) : ['- none']), '');
  if (res.stray.length) {
    out.push('## Instruction files inside agent directories', '', 'An agent that reads files in these folders may load them as rules.', '');
    for (const r of res.stray) withSamples(out, r);
    out.push('');
  }
  if (res.codexConfig?.length) {
    out.push('## Codex config.toml', '');
    const syncOff = res.codexConfig.some((k) => k.key === 'external-agent-import-sync-enabled' && /false/.test(k.value));
    for (const k of res.codexConfig) {
      if (syncOff && k.key === 'external-agent-import-sync-item-types') continue;
      out.push(`- ${k.section ? `[${k.section}] ` : ''}${k.key} = ${k.value}`);
    }
    out.push('');
  }
  if (res.claudeSettings) {
    const s = res.claudeSettings;
    out.push('## Claude Code settings', '', s.error ? `- ${s.error}` : `- auto memory: ${s.autoMemoryEnabled ? 'on' : 'off'}; output style: ${s.outputStyle ?? 'default'}`, '');
  }
  return out.join('\n');
}

function renderProject(r) {
  const out = [`# Project scan: \`${home(r.root)}\`${r.scope ? ` (scope: \`${r.scope}\`)` : ''}`, '', LEGEND, '',
    `- git: ${r.git ? `yes, ${r.dirty} changed paths` : 'no'}`, ''];
  out.push('## Agent rule files', '');
  for (const f of r.agentRules) {
    out.push(fileLine(f, { prohibitions: true }) + (f.tracked === false ? ' (untracked or ignored)' : ''));
    const s = samples(f); if (s) out.push(s);
  }
  if (!r.agentRules.length) out.push('- none');
  const d = r.designs;
  out.push('', '## Design documents', '');
  if (!d.docs) out.push('- none found under docs/, design/, rfc/, adr/, spec/, proposal/, decision/, or plan/ directories');
  else {
    out.push(`${d.docs} docs${d.archived ? `; ${d.archived} in archive folders left out` : ''}. Per folder: docs (git-ignored), lines in non-goal/limitation sections, process-log sections and their lines, weighted text hits.`, '',
      '| folder | docs | scope lines | process logs | log lines | text hits |', '|---|---:|---:|---:|---:|---:|',
      ...d.folders.map((f) => `| ${f.folder} | ${f.docs}${f.ignored ? ` (${f.ignored})` : ''} | ${f.scopeLines} | ${f.logSections} | ${f.logLines} | ${Math.round(f.hits)} |`), '',
      r.scope ? 'Every doc in the scope, most design leads first:' : 'Docs with the most design leads:', '');
    for (const x of d.top) {
      const sec = DESIGN_SECTIONS.filter((s) => x.sections[s.id].count).map((s) => `${s.id} ${x.sections[s.id].count}×${x.sections[s.id].lines} lines (${x.sections[s.id].headings.join('; ')})`);
      const terms = DESIGN_TERMS.filter((t) => x.terms[t.id]).map((t) => `${t.id} ${x.terms[t.id]}`);
      out.push(`- \`${x.rel}\`${x.tracked === false ? ' (ignored)' : ''}${x.logFile ? ' (log-style file name)' : ''} (${x.modified}, ${x.chars} chars; lead weight ${x.designWeight}): ${[hitSummary(x), ...sec, ...terms].filter(Boolean).join('; ') || 'no leads'}`);
      if (x.status) out.push(`  - status line L${x.status.line}${x.status.pending ? ' (says pending: check it against the code)' : ''}: ${x.status.text}`);
      if (x.pendingMentions?.count) out.push(`  - pending wording elsewhere in the doc (${x.pendingMentions.count}): ${x.pendingMentions.samples.map((s) => `L${s.line} ${s.text}`).join(' | ')}`);
      if (x.consumers?.length) out.push(`  - read by tooling (${x.consumerCount}; scripts first): ${x.consumers.join(', ')}${x.consumerCount > 3 ? ', …' : ''}. Check whether an edit breaks a check that passes now.`);
      if (x.orphan) out.push('  - no other Markdown file links to it or names it');
      const s = samples(x); if (s) out.push(s);
      for (const tm of DESIGN_TERMS) if (x.termSamples[tm.id]) out.push(`  - ${tm.id} e.g. L${x.termSamples[tm.id].line}: ${x.termSamples[tm.id].text}`);
    }
  }
  out.push('', '## Other docs with the most hits', '');
  for (const f of r.docs) withSamples(out, f);
  if (!r.docs.length) out.push('- none');
  out.push('', '## Code comments with the most hits', '');
  for (const f of r.comments) withSamples(out, f);
  if (!r.comments.length) out.push('- none');
  out.push('', '## Code leads (confirm each by reading the callers)', '');
  const leads = Object.entries(r.code).filter(([, v]) => v.total);
  for (const [id, v] of leads) out.push(`- ${id} (${v.label}): ${v.total}; most in ${v.files.map((x) => `${x.file} ${x.count}`).join(', ')}`);
  if (!leads.length) out.push('- none');
  return out.join('\n');
}

const json = flags.has('--json');
const print = (data, render) => console.log(json ? JSON.stringify(data, null, 2) : render(data));
if (mode === 'agents') print(auditAgents(), renderAgents);
else if (mode === 'project' && target) print(auditProject(target), renderProject);
else {
  console.error('usage: node scan.mjs agents | project <path> [--json]');
  process.exit(2);
}
