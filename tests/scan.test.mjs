// Regression tests for scan.mjs. Each test builds a small fixture in a temp directory and
// runs the scanner against it with HOME pointed at the fixture.
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCAN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'purify', 'scripts', 'scan.mjs');

const made = [];
process.on('exit', () => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purify-test-'));
  made.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

function gitRepo(files) {
  const dir = fixture(files);
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  return dir;
}

function scan(home, ...args) {
  return JSON.parse(execFileSync(process.execPath, [SCAN, ...args, '--json'], { encoding: 'utf8', env: { ...process.env, HOME: home } }));
}

const RULES = `# Global instructions

- Report what you did and what you found.
- Keep Claude Code memory short.
- See ~/.claude/SHELL.md for shell rules.
- Commit only when asked.
`;

test('agents: a copy with agent names swapped and its broken import', () => {
  const home = fixture({
    '.claude/CLAUDE.md': `${RULES}\n@SHELL.md\n`,
    '.claude/SHELL.md': 'shell rules\n',
    'AGENTS.md': `${RULES.replace('Claude Code', 'Codex').replace('.claude', '.codex')}\n@SHELL.md\n`,
    '.codex/AGENTS.md': '# Codex\n',
  });
  const r = scan(home, 'agents');
  assert.ok(r.duplicates.some((d) => d.kind === 'copy with agent names swapped' && [d.a, d.b].some((p) => p.endsWith('AGENTS.md'))));
  const shared = r.agents.find((a) => a.name === 'Shared (home)');
  assert.deepEqual(shared.instructions[0].broken, ['SHELL.md']);
});

test('agents: hooks in hooks.json and config.toml, flagging another agent and session start', () => {
  const home = fixture({
    '.codex/AGENTS.md': '# Codex\n',
    '.codex/hooks.json': JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'git-ai checkpoint claude --hook-input stdin' }] }] } }),
    '.codex/config.toml': [
      '[[hooks.PreToolUse]]', '[[hooks.PreToolUse.hooks]]', 'command = "git-ai checkpoint codex --hook-input stdin"', '',
      '[[hooks.SessionStart]]', '[[hooks.SessionStart.hooks]]', 'command = "cat ~/rules.md"', '',
      '[hooks.state."x:pre_tool_use:0:0"]', 'trusted_hash = "sha256:abc"', '',
      '[mcp_servers.demo]', 'command = "node server.js"', '',
    ].join('\n'),
  });
  const hooks = scan(home, 'agents').agents.find((a) => a.name === 'Codex').hooks;
  assert.equal(hooks.length, 3);
  assert.deepEqual(hooks.filter((h) => h.foreign).map((h) => h.command), ['git-ai checkpoint claude --hook-input stdin']);
  assert.ok(hooks.find((h) => h.event === 'SessionStart').injects);
});

test('agents: the @ line that imports PURIFY.md is not a local-path lead', () => {
  const home = fixture({ '.codex/AGENTS.md': '# Codex\n\n- Keep notes in /home/me/notes/.\n\n@/home/me/.codex/PURIFY.md\n' });
  const codex = scan(home, 'agents').agents.find((a) => a.name === 'Codex');
  assert.equal(codex.instructions[0].hits['local-path'].count, 1);
});

const SPEC = `# Spec

状态：方案已评审，尚未实现。

- 测试层级 L0–L6：从单元测试到发布。
- 前置工单 QX-T03.B 完成后接入。
- 排序规则见 X9。使用 IPV6 与 HTTP2，由 GPT-5 生成摘要。
- 离线方案目前 No-Go。

脚本校验见 tools/check.py。
`;

function designRepo() {
  return gitRepo({
    'docs/design/PERF_SPEC.md': SPEC,
    'docs/design/SORT_RULES.md': '# Sort\n\n## X9：排序规则\n\n按更新时间倒序。见 PERF_SPEC.md。\n',
    'docs/design/OLD_GUIDE.md': '# Old guide\n\n原型接口说明。\n',
    'tools/check.py': 'DESIGN_DIR = "docs/design"\nPIN = DESIGN_DIR + "/" + "PERF_SPEC.md"\n',
    'results/attempts/1/out.json': '{"doc": "docs/design/OLD_GUIDE.md"}\n',
  });
}

test('labels: ranges and labels defined in a sibling doc count as explained', () => {
  const home = fixture({});
  const spec = scan(home, 'project', path.join(designRepo(), 'docs', 'design')).designs.top.find((d) => d.rel.endsWith('PERF_SPEC.md'));
  assert.deepEqual(spec.hits.label.labels, ['QX-T03.B']);
});

test('stale status: a pending status line and No-Go further down', () => {
  const home = fixture({});
  const spec = scan(home, 'project', path.join(designRepo(), 'docs', 'design')).designs.top.find((d) => d.rel.endsWith('PERF_SPEC.md'));
  assert.equal(spec.status.pending, true);
  assert.equal(spec.pendingMentions.count, 1);
  assert.match(spec.pendingMentions.samples[0].text, /No-Go/);
});

test('tooling consumers and orphan docs', () => {
  const home = fixture({});
  const docs = scan(home, 'project', path.join(designRepo(), 'docs', 'design')).designs.top;
  const by = (name) => docs.find((d) => d.rel.endsWith(name));
  assert.deepEqual(by('PERF_SPEC.md').consumers, ['tools/check.py']);
  assert.equal(by('OLD_GUIDE.md').consumerCount, 0, 'recorded results under results/ are not consumers');
  assert.equal(by('OLD_GUIDE.md').orphan, true);
  assert.equal(by('PERF_SPEC.md').orphan, false);
});
