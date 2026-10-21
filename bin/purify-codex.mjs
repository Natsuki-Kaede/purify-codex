#!/usr/bin/env node
// Adds the purify style rules (PURIFY.md) to each agent's global instructions and installs the
// /purify skill next to them. Running it again updates both.
//   npx github:Natsuki-Kaede/purify-codex [install | uninstall]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'purify');
const RULES = fs.readFileSync(path.join(SKILL, 'PURIFY.md'), 'utf8').trim();
const START = '<!-- purify-codex:start -->';
const END = '<!-- purify-codex:end -->';
const BLOCK = new RegExp(`\\n*${START}[\\s\\S]*?${END}\\n?`);

// Claude Code and Codex get a PURIFY.md copy and an @ line that imports it. Codex's line carries
// the absolute path, since a Codex session runs in the project directory. Antigravity shares
// ~/.gemini/GEMINI.md with Gemini CLI, so that file gets the rules inline between markers.
// Codex reads AGENTS.override.md instead of AGENTS.md when it exists.
const AGENTS = [
  { name: 'Claude Code', dir: '.claude', files: ['CLAUDE.md'] },
  { name: 'Codex', dir: '.codex', files: ['AGENTS.override.md', 'AGENTS.md'], absolute: true },
  { name: 'Gemini CLI and Antigravity', dir: '.gemini', files: ['GEMINI.md'], inline: true },
];

const tilde = (p) => (p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p);
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const append = (text, add) => `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${add}\n`;
const isLink = (p) => fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink();
const importRef = (agent, copy) => `@${agent.absolute ? copy : 'PURIFY.md'}`;
// The @ line together with the blank lines before it.
const importLine = (ref) => new RegExp(`\\n*^${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$\\n?`, 'm');

function install(agent, dir) {
  const file = path.join(dir, agent.files.find((f) => fs.existsSync(path.join(dir, f))) ?? agent.files.at(-1));
  const text = read(file);
  let rules;
  if (agent.inline) {
    const block = `${START}\n${RULES}\n${END}`;
    fs.writeFileSync(file, BLOCK.test(text) ? text.replace(BLOCK, () => `\n\n${block}\n`).replace(/^\n+/, '') : append(text, block));
    rules = `added the rules to ${tilde(file)}`;
  } else {
    const copy = path.join(dir, 'PURIFY.md');
    const ref = importRef(agent, copy);
    fs.writeFileSync(copy, `${RULES}\n`);
    if (!importLine(ref).test(text)) fs.writeFileSync(file, append(text, ref));
    rules = `wrote ${tilde(copy)}, imported from ${tilde(file)}`;
  }
  const skill = path.join(dir, 'skills', 'purify');
  if (isLink(skill)) return `${rules}; kept the linked skill at ${tilde(skill)}`;
  fs.rmSync(skill, { recursive: true, force: true });
  fs.cpSync(SKILL, skill, { recursive: true });
  return `${rules}; installed the skill in ${tilde(skill)}`;
}

function uninstall(agent, dir) {
  const out = [];
  const copy = path.join(dir, 'PURIFY.md');
  const pattern = agent.inline ? BLOCK : importLine(importRef(agent, copy));
  for (const f of agent.files) {
    const file = path.join(dir, f);
    const text = read(file);
    if (!pattern.test(text)) continue;
    const rest = text.replace(pattern, '\n');
    if (rest.trim()) fs.writeFileSync(file, rest.replace(/^\n+/, ''));
    else fs.rmSync(file);
    out.push(`removed the rules from ${tilde(file)}`);
  }
  if (!agent.inline && fs.existsSync(copy)) fs.rmSync(copy);
  const skill = path.join(dir, 'skills', 'purify');
  if (isLink(skill)) out.push(`left the linked skill at ${tilde(skill)}`);
  else if (fs.existsSync(skill)) {
    fs.rmSync(skill, { recursive: true });
    out.push(`removed ${tilde(skill)}`);
  }
  return out.join('; ') || 'nothing to remove';
}

const command = process.argv[2] ?? 'install';
if (!['install', 'uninstall'].includes(command)) {
  console.error('usage: purify-codex [install | uninstall]');
  process.exit(2);
}
const found = AGENTS.map((a) => [a, path.join(HOME, a.dir)]).filter(([, dir]) => fs.existsSync(dir));
if (!found.length) {
  console.error(`Found no ${AGENTS.map((a) => `~/${a.dir}`).join(', ')} directory. Install Claude Code, Codex, or Gemini CLI first.`);
  process.exit(1);
}
for (const [agent, dir] of found) console.log(`${agent.name}: ${(command === 'install' ? install : uninstall)(agent, dir)}`);
if (command === 'install') console.log('New sessions load the rules.');
