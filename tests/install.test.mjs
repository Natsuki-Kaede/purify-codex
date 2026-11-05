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

test('install twice: managed imports for Claude, inline rules for Codex and Gemini, linked skill kept', () => {
  run(home, 'bin/purify-codex.mjs');
  run(home, 'bin/purify-codex.mjs', 'install');
  const codexCopy = path.join(home, '.codex', 'PURIFY.md');
  assert.equal(fs.readFileSync(claudeMd, 'utf8').match(/^@PURIFY\.md$/gm).length, 1);
  assert.equal(fs.readFileSync(agentsMd, 'utf8').split('<!-- purify-codex:start -->').length, 2);
  assert.doesNotMatch(fs.readFileSync(agentsMd, 'utf8'), /^@/m);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'PURIFY.md')));
  assert.ok(!fs.existsSync(codexCopy));
  assert.equal(fs.readFileSync(path.join(home, '.gemini', 'GEMINI.md'), 'utf8').split('<!-- purify-codex:start -->').length, 2);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'purify', 'SKILL.md')));
  assert.ok(fs.lstatSync(linked).isSymbolicLink());
});

test('the scanner reports rule configuration and finds no pollution in the rules', () => {
  const r = JSON.parse(run(home, 'skills/purify/scripts/scan.mjs', 'agents', '--json'));
  for (const name of ['Codex', 'Claude Code', 'Gemini CLI']) {
    const agent = r.agents.find((a) => a.name === name);
    assert.ok(agent.purifyRules.length, name);
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

const TEMPLATE = fs.readFileSync(path.join(ROOT, 'skills', 'purify', 'PURIFY.md'), 'utf8');
function isolated(files, check) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purify-install-'));
  const put = (rel, text) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
    return p;
  };
  for (const [rel, text] of Object.entries(files)) put(rel, text);
  try { check(dir, put); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('user rules merged across sections survive repeated install and uninstall without a second copy', () => {
  const rules = TEMPLATE.split('\nExamples:')[0].split('\n').filter((line) => line.startsWith('- '));
  rules[0] = rules[0].replace('Report what you did, what you found, and what the reader should do next. ', '');
  rules[4] = '- Add validation, fallbacks, retries, compatibility, caches or abstractions only for a demonstrated requirement or reachable failure that existing guarantees do not cover. Consider a simpler solution first.';
  const integrated = '# My instructions\n\n' + rules.map((rule, i) => `## Section ${i + 1}\n\n${rule}\n`).reverse().join('\n');
  isolated({ '.codex/AGENTS.md': integrated }, (dir) => {
    run(dir, 'bin/purify-codex.mjs');
    run(dir, 'bin/purify-codex.mjs');
    assert.equal(fs.readFileSync(path.join(dir, '.codex/AGENTS.md'), 'utf8'), integrated);
    assert.ok(!fs.existsSync(path.join(dir, '.codex/PURIFY.md')));
    const result = JSON.parse(run(dir, 'skills/purify/scripts/scan.mjs', 'agents', '--json'));
    assert.deepEqual(result.agents.find((a) => a.name === 'Codex').purifyRules.map((r) => r.form), ['inline text']);
    run(dir, 'bin/purify-codex.mjs', 'uninstall');
    assert.equal(fs.readFileSync(path.join(dir, '.codex/AGENTS.md'), 'utf8'), integrated);
  });
});

for (const kind of ['Read and follow', '读取并遵循', '@']) {
  test(`existing ${kind} reference and its target survive install and uninstall`, () => {
    isolated({ '.codex/PURIFY.md': TEMPLATE }, (dir, put) => {
      const target = path.join(dir, '.codex/PURIFY.md');
      const instructions = '# Mine\n\n' + (kind === '@' ? `@${target}\n` : `${kind} \`${target}\`.\n`);
      const file = put('.codex/AGENTS.md', instructions);
      run(dir, 'bin/purify-codex.mjs');
      assert.equal(fs.readFileSync(file, 'utf8'), instructions);
      run(dir, 'bin/purify-codex.mjs', 'uninstall');
      assert.equal(fs.readFileSync(file, 'utf8'), instructions);
      assert.equal(fs.readFileSync(target, 'utf8'), TEMPLATE);
    });
  });
}

test('skill-only install and uninstall preserve custom instructions for every supported agent', () => {
  const custom = '# User rules\n\nExplain the result plainly.\n';
  const names = ['.codex/AGENTS.md', '.claude/CLAUDE.md', '.gemini/GEMINI.md'];
  isolated(Object.fromEntries(names.map((name) => [name, custom])), (dir) => {
    run(dir, 'bin/purify-codex.mjs', 'install', '--skill-only');
    for (const name of names) {
      assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), custom);
      assert.ok(!fs.existsSync(path.join(dir, path.dirname(name), 'PURIFY.md')));
      assert.ok(fs.existsSync(path.join(dir, path.dirname(name), 'skills/purify/SKILL.md')));
    }
    run(dir, 'bin/purify-codex.mjs', 'uninstall', '--skill-only');
    for (const name of names) {
      assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), custom);
      assert.ok(!fs.existsSync(path.join(dir, path.dirname(name), 'skills/purify')));
    }
  });
});

test('uninstall preserves a managed copy still referenced by user instructions', () => {
  isolated({ '.claude/CLAUDE.md': '# Mine\n' }, (dir) => {
    run(dir, 'bin/purify-codex.mjs');
    const target = path.join(dir, '.claude/PURIFY.md');
    const file = path.join(dir, '.claude/CLAUDE.md');
    fs.appendFileSync(file, `\nRead and follow \`${target}\`.\n`);
    run(dir, 'bin/purify-codex.mjs', 'uninstall');
    assert.match(fs.readFileSync(file, 'utf8'), /Read and follow/);
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /purify-codex:start/);
    assert.ok(fs.existsSync(target));
  });
});

test('uninstall preserves a shared rules file referenced by another agent', () => {
  isolated({ '.claude/CLAUDE.md': '# Claude\n', '.codex/AGENTS.md': '# Codex\n' }, (dir) => {
    run(dir, 'bin/purify-codex.mjs');
    const target = path.join(dir, '.claude/PURIFY.md');
    const codex = path.join(dir, '.codex/AGENTS.md');
    fs.appendFileSync(codex, `\nRead and follow \`${target}\`.\n`);
    run(dir, 'bin/purify-codex.mjs', 'uninstall');
    assert.match(fs.readFileSync(codex, 'utf8'), /Read and follow/);
    assert.ok(fs.existsSync(target), 'the other agent still references the shared copy');
  });
});

test('managed-block examples in code fences survive install and uninstall', () => {
  for (const [open, close] of [['```markdown\n', '```\n'], ['~~~markdown\n', '~~~\n'], ['````markdown\n```markdown\n', '```\n````\n']]) {
    const example = '# My examples\n\n' + open + '<!-- purify-codex:start -->\n' + TEMPLATE.trim() + '\n<!-- purify-codex:end -->\n' + close;
    isolated({ '.codex/AGENTS.md': example }, (dir) => {
      const file = path.join(dir, '.codex/AGENTS.md');
      run(dir, 'bin/purify-codex.mjs');
      const installed = fs.readFileSync(file, 'utf8');
      assert.ok(installed.startsWith(example));
      assert.equal(installed.split('<!-- purify-codex:start -->').length, 3, 'example plus a real managed block');
      run(dir, 'bin/purify-codex.mjs', 'uninstall');
      assert.equal(fs.readFileSync(file, 'utf8'), example);
    });
  }
});

test('an existing unreferenced rules file is preserved through install and uninstall', () => {
  const custom = '# My existing rules\n\nKeep my own examples.\n';
  isolated({ '.claude/CLAUDE.md': '# Mine\n', '.claude/PURIFY.md': custom }, (dir) => {
    const copy = path.join(dir, '.claude/PURIFY.md');
    const file = path.join(dir, '.claude/CLAUDE.md');
    run(dir, 'bin/purify-codex.mjs');
    run(dir, 'bin/purify-codex.mjs');
    assert.equal(fs.readFileSync(copy, 'utf8'), custom);
    assert.match(fs.readFileSync(file, 'utf8'), /# Plain reporting/);
    run(dir, 'bin/purify-codex.mjs', 'uninstall');
    assert.equal(fs.readFileSync(copy, 'utf8'), custom);
    assert.equal(fs.readFileSync(file, 'utf8'), '# Mine\n');
  });
});

test('Codex override receives the managed block while the base instructions stay intact', () => {
  isolated({ '.codex/AGENTS.md': '# Base\n', '.codex/AGENTS.override.md': '# Override\n' }, (dir) => {
    run(dir, 'bin/purify-codex.mjs');
    assert.equal(fs.readFileSync(path.join(dir, '.codex/AGENTS.md'), 'utf8'), '# Base\n');
    assert.match(fs.readFileSync(path.join(dir, '.codex/AGENTS.override.md'), 'utf8'), /purify-codex:start/);
    run(dir, 'bin/purify-codex.mjs', 'uninstall');
    assert.equal(fs.readFileSync(path.join(dir, '.codex/AGENTS.override.md'), 'utf8'), '# Override\n');
  });
});
