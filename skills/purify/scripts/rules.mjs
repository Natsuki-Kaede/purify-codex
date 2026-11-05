// Shared recognition of rule text and instruction references. This describes configuration on disk.
import fs from 'node:fs';
import path from 'node:path';

export const RULES = fs.readFileSync(new URL('../PURIFY.md', import.meta.url), 'utf8').trim();
export const START = '<!-- purify-codex:start -->';
export const END = '<!-- purify-codex:end -->';
export const BLOCK = new RegExp(`${START}[\\s\\S]*?${END}`);
const MANAGED = new RegExp(`\\n*${BLOCK.source}\\n?`);

const bullets = RULES.split('\nExamples:')[0].split('\n').filter((line) => line.startsWith('- ')).map((line) => line.slice(2));
const omission = bullets[0].split('. ').slice(1).join('. ');
// The stronger implementation rule also covers caches, abstractions and existing guarantees.
const implementation = 'Add validation, fallbacks, retries, compatibility, caches or abstractions only for a demonstrated requirement or reachable failure that existing guarantees do not cover.';
const clauses = [[omission], ...bullets.slice(1).map((line) => [line])];
clauses.at(-1).push(implementation);
const normalize = (text) => text.toLowerCase().replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blank = (text) => text.replace(/[^\r\n]/g, ' ');
function prose(text) {
  let fence = null;
  return text.split('\n').map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return blank(line);
    }
    if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
      fence = marker[1];
      return blank(line);
    }
    return line;
  }).join('\n');
}

export function managedBlock(text) {
  const match = prose(text).match(MANAGED);
  return match ? { index: match.index, text: text.slice(match.index, match.index + match[0].length) } : null;
}

export function replaceManagedBlock(text, replacement = '') {
  const block = managedBlock(text);
  return block ? text.slice(0, block.index) + replacement + text.slice(block.index + block.text.length) : text;
}

export function hasInlineRules(text) {
  const normalized = normalize(prose(text));
  return clauses.every((alternatives) => alternatives.some((clause) => normalized.includes(normalize(clause))));
}

export function ruleForms(text) {
  const block = managedBlock(text);
  return [hasInlineRules(replaceManagedBlock(text)) && 'inline text', hasInlineRules(block?.text ?? '') && 'managed inline block'].filter(Boolean);
}

export function instructionReferences(text) {
  text = prose(text);
  const refs = [
    ...[...text.matchAll(/^@(\S+)[ \t]*$/gm)].map((m) => ({ ref: m[1], kind: '@ reference' })),
    ...[...text.matchAll(/(?:read and follow|读取并遵循)\s*`([^`\n]+)`/gi)].map((m) => ({ ref: m[1], kind: 'explicit read' })),
  ];
  return refs.filter((r, i) => refs.findIndex((other) => other.ref === r.ref && other.kind === r.kind) === i);
}

export function resolveReference(ref, file, home) {
  const clean = ref.replace(/[:#]\d+.*$/, '').replace(/[.,;)]+$/, '');
  return clean.startsWith('~/') ? path.join(home, clean.slice(2)) : path.resolve(path.dirname(file), clean);
}

export const isPurifyReference = ({ ref }) => /(?:^|[\\/])PURIFY\.md(?:[:#]\d+.*)?$/.test(ref);

export function stripRuleText(text) {
  let stripped = replaceManagedBlock(text, blank(managedBlock(text)?.text ?? ''));
  for (const clause of [...bullets, omission, implementation]) {
    const pattern = new RegExp(clause.split(/\s+/).map(escape).join('\\s+'), 'gi');
    stripped = stripped.replace(pattern, blank);
  }
  for (const { ref } of instructionReferences(text).filter(isPurifyReference)) stripped = stripped.replaceAll(ref, blank(ref));
  return stripped;
}
