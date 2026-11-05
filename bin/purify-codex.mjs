#!/usr/bin/env node
// Installs the audit skill and, unless already maintained by the user, the plain-reporting rules.
//   npx github:Natsuki-Kaede/purify-codex [install | uninstall] [--skill-only]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, START, END, managedBlock, replaceManagedBlock, hasInlineRules, instructionReferences, isPurifyReference, resolveReference } from '../skills/purify/scripts/rules.mjs';

const HOME = os.homedir();
const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'purify');

// Managed blocks identify what the installer owns. Codex and Gemini get inline rules;
// Claude Code gets its native @ import. Existing user rules and references stay in place.
const AGENTS = [
  { name: 'Claude Code', dir: '.claude', files: ['CLAUDE.md'] },
  { name: 'Codex', dir: '.codex', files: ['AGENTS.override.md', 'AGENTS.md'], inline: true },
  { name: 'Gemini CLI and Antigravity', dir: '.gemini', files: ['GEMINI.md'], inline: true },
];

const tilde = (p) => (p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p);
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const append = (text, add) => `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${add}\n`;
const isLink = (p) => fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink();
const references = (text, file) => instructionReferences(text).map((ref) => ({ ...ref, path: resolveReference(ref.ref, file, HOME) }));

function install(agent, dir) {
  const file = path.join(dir, agent.files.find((f) => fs.existsSync(path.join(dir, f))) ?? agent.files.at(-1));
  const text = read(file);
  let rules = 'kept the existing rules (--skill-only)';
  if (!skillOnly) {
    const userText = replaceManagedBlock(text, '\n');
    const existing = hasInlineRules(userText) || references(userText, file).some((ref) => isPurifyReference(ref) || hasInlineRules(read(ref.path)));
    if (existing) {
      if (managedBlock(text)) fs.writeFileSync(file, userText);
      rules = `kept the user-maintained rules in ${tilde(file)}`;
    } else {
      const copy = path.join(dir, 'PURIFY.md');
      const previous = managedBlock(text);
      const managesCopy = previous && references(previous.text, file).some((ref) => ref.path === copy);
      let body = RULES;
      if (!agent.inline && (managesCopy || (!fs.existsSync(copy) && !isLink(copy)))) {
        fs.writeFileSync(copy, `${RULES}\n`);
        body = '@PURIFY.md';
      }
      const block = `${START}\n${body}\n${END}`;
      fs.writeFileSync(file, managedBlock(text) ? replaceManagedBlock(text, `\n\n${block}\n`).replace(/^\n+/, '') : append(text, block));
      rules = `updated the managed rules in ${tilde(file)}`;
    }
  }
  const skill = path.join(dir, 'skills', 'purify');
  if (isLink(skill)) return `${rules}; kept the linked skill at ${tilde(skill)}`;
  fs.rmSync(skill, { recursive: true, force: true });
  fs.cpSync(SKILL, skill, { recursive: true });
  return `${rules}; installed the skill in ${tilde(skill)}`;
}

function uninstall(agent, dir) {
  const out = [];
  if (!skillOnly) {
    const copy = path.join(dir, 'PURIFY.md');
    let ownedCopy = false;
    for (const f of agent.files) {
      const file = path.join(dir, f);
      const text = read(file);
      const block = managedBlock(text);
      if (!block) continue;
      ownedCopy ||= references(block.text, file).some((ref) => ref.path === copy);
      const rest = replaceManagedBlock(text, '\n');
      if (rest.trim()) fs.writeFileSync(file, rest.replace(/^\n+/, ''));
      else fs.rmSync(file);
      out.push(`removed the managed rules from ${tilde(file)}`);
    }
    const stillReferenced = AGENTS.some((other) => other.files.some((f) => {
      const file = path.join(HOME, other.dir, f);
      return references(replaceManagedBlock(read(file)), file).some((ref) => ref.path === copy);
    }));
    if (ownedCopy && !stillReferenced && fs.existsSync(copy)) fs.rmSync(copy);
  }
  const skill = path.join(dir, 'skills', 'purify');
  if (isLink(skill)) out.push(`left the linked skill at ${tilde(skill)}`);
  else if (fs.existsSync(skill)) {
    fs.rmSync(skill, { recursive: true });
    out.push(`removed ${tilde(skill)}`);
  }
  return out.join('; ') || 'nothing to remove';
}

const args = process.argv.slice(2);
const skillOnly = args.includes('--skill-only');
const positional = args.filter((arg) => arg !== '--skill-only');
const command = positional[0] ?? 'install';
if (!['install', 'uninstall'].includes(command) || positional.length > 1) {
  console.error('usage: purify-codex [install | uninstall] [--skill-only]');
  process.exit(2);
}
const found = AGENTS.map((a) => [a, path.join(HOME, a.dir)]).filter(([, dir]) => fs.existsSync(dir));
if (!found.length) {
  console.error(`Found no ${AGENTS.map((a) => `~/${a.dir}`).join(', ')} directory. Install Claude Code, Codex, or Gemini CLI first.`);
  process.exit(1);
}
for (const [agent, dir] of found) console.log(`${agent.name}: ${(command === 'install' ? install : uninstall)(agent, dir)}`);
if (command === 'install') console.log('Installed the audit skill. Review detected rule configuration with /purify agents.');
