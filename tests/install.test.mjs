// Tests for the installer: it runs against a temp HOME, and the scanner then reads the result.
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (home, script, ...args) => execFileSync(process.execPath, [path.join(ROOT, script), ...args], { encoding: 'utf8', env: { ...process.env, HOME: home } });

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'purify-test-'));
process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }));
const file = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
  if (text != null) fs.writeFileSync(path.join(home, rel), text);
  return path.join(home, rel);
};
const claudeMd = file('.claude/CLAUDE.md', '# Mine\n\n- Commit only when asked.\n');
const agentsMd = file('.codex/AGENTS.md', '# Codex\n\n- Keep replies short.\n');
const gemini = file('.gemini/settings.json', '{}');
const linked = file('.codex/skills/purify');
fs.symlinkSync(path.join(ROOT, 'skills', 'purify'), linked);
const before = { claude: fs.readFileSync(claudeMd, 'utf8'), codex: fs.readFileSync(agentsMd, 'utf8') };

test('install twice: an @ line each for Claude Code and Codex, one inline block for Gemini, skill copied, linked skill kept', () => {
  run(home, 'bin/purify-codex.mjs');
  run(home, 'bin/purify-codex.mjs', 'install');
  const codexCopy = path.join(home, '.codex', 'PURIFY.md');
  assert.equal(fs.readFileSync(claudeMd, 'utf8').match(/^@PURIFY\.md$/gm).length, 1);
  assert.equal(fs.readFileSync(agentsMd, 'utf8').split('\n').filter((l) => l === `@${codexCopy}`).length, 1);
  assert.doesNotMatch(fs.readFileSync(agentsMd, 'utf8'), /purify-codex:start/);
  for (const f of [path.join(home, '.claude', 'PURIFY.md'), codexCopy]) assert.ok(fs.existsSync(f), f);
  assert.equal(fs.readFileSync(path.join(home, '.gemini', 'GEMINI.md'), 'utf8').split('<!-- purify-codex:start -->').length, 2);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'purify', 'SKILL.md')));
  assert.ok(fs.lstatSync(linked).isSymbolicLink());
});

test('the scanner reports the rules as loaded and finds no pollution in them', () => {
  const r = JSON.parse(run(home, 'skills/purify/scripts/scan.mjs', 'agents', '--json'));
  for (const name of ['Codex', 'Claude Code', 'Gemini CLI']) {
    const agent = r.agents.find((a) => a.name === name);
    assert.equal(agent.purify, true, name);
    for (const f of agent.instructions.flatMap((i) => [i, ...i.imports])) assert.deepEqual(f.hits, {}, f.path);
    assert.equal(agent.skills, undefined, `${name} lists no purify skill copy`);
  }
  assert.deepEqual(r.duplicates, []);
});

test('uninstall restores the original files', () => {
  run(home, 'bin/purify-codex.mjs', 'uninstall');
  assert.equal(fs.readFileSync(claudeMd, 'utf8'), before.claude);
  assert.equal(fs.readFileSync(agentsMd, 'utf8'), before.codex);
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'PURIFY.md')));
  assert.ok(!fs.existsSync(path.join(home, '.codex', 'PURIFY.md')));
  assert.ok(!fs.existsSync(path.join(home, '.gemini', 'GEMINI.md')));
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'skills', 'purify')));
  assert.ok(fs.lstatSync(linked).isSymbolicLink());
});
