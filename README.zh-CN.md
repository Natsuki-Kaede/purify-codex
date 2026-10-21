# purify-codex

[English](README.md) | 简体中文

purify-codex 让 AI 编程 agent 不再写 Codex 腔，并清理这种文风已经留下的痕迹。它由两部分组成：

- **`PURIFY.md`**：一份简短的汇报规则，每个 agent 会话启动时自动加载；
- **`/purify`**：一个 skill，用来审计你的 agent 配置和代码仓库。

Codex 系列模型（GPT-5.x、GPT-6 Sol 和 Astra）有几个很好认的习惯：

- 回复里大段列举"没做什么、没改什么"；
- "不代表、不证明"一类的免责声明；
- "不是 X，而是 Y"式的对比句；
- 凭空编出来的规则、重复的禁令；
- 没有需求支撑的兜底和重复校验。

OpenAI 自己的[提示词指南](https://developers.openai.com/api/docs/guides/latest-model)也让开发者关掉这些习惯，但它们还是会扩散：写进 `AGENTS.md` 和记忆，再通过导入功能和复制来的规则进入其他 agent 的 `CLAUDE.md`、`GEMINI.md`，最后进入代码和文档。其他模型读到这些文字后，会跟着学这种写法。

## 安装

```bash
npx github:Natsuki-Kaede/purify-codex
```

安装器会找出本机已有的 agent，给每个 agent 接入规则，并装好 `/purify` skill：

| Agent | 规则怎么接入 | Skill 位置 |
|---|---|---|
| Claude Code | 写入 `~/.claude/PURIFY.md`，由 `~/.claude/CLAUDE.md` 里的 `@PURIFY.md` 引入 | `~/.claude/skills/purify` |
| Codex | 写入 `~/.codex/PURIFY.md`，由 `~/.codex/AGENTS.md` 里一行带绝对路径的 `@` 引入 | `~/.codex/skills/purify` |
| Gemini CLI 和 Antigravity | 直接写进两者共用的 `~/.gemini/GEMINI.md` | `~/.gemini/skills/purify` |

`GEMINI.md` 里直接写入的那段规则用 `<!-- purify-codex:start -->` 和 `<!-- purify-codex:end -->` 两个标记包住。再运行一次即更新；加 `uninstall` 会删掉安装器加进去的全部内容，原文件恢复原样。如果 skill 目录是符号链接（比如 skills CLI 建的），安装器不会动它。规则从下一个新会话开始生效。

其他 agent 可以把 [`PURIFY.md`](skills/purify/PURIFY.md) 粘贴进它们的全局规则（Cursor 的 User Rules、Windsurf 的 `global_rules.md`、Claude 桌面版的个人偏好），再用 [skills CLI](https://github.com/vercel-labs/skills) 安装 skill：`npx skills add Natsuki-Kaede/purify-codex`。

安装器和扫描器需要 Node 18 及以上。

## 使用

| 命令 | 作用 |
|---|---|
| `/purify` | 审计本机的 agent，再提议审计当前所在的仓库 |
| `/purify agents` | 审计 Codex、Claude Code、Claude 桌面版、Antigravity、Gemini CLI、Cursor、Windsurf、GitHub Copilot、OpenCode 等工具的规则文件、记忆、skills 和同步设置 |
| `/purify <路径>` | 审计一个仓库：设计文档、代码、文档、注释，以及仓库里的 agent 规则 |

在 Codex 里用 `$purify` 调用，或直接说出 skill 的名字。

审计结束时会给出一份报告，发现的问题按三组编号：

- **A，可直接改**：改动不影响行为。
- **B，需要你决定**：改动会影响行为、配置或加载的内容。
- **K，保留**：看起来像污染、其实应该保留的内容，附上保留理由。

回复你想改的编号即可。修改前会先备份文件；在仓库里会在单独的分支上改，改完代码后会跑项目自己的检查。

## 检查哪些内容

- **规则文件**：会催生这种文风的规则，比如要求把一长串检查报告为"未验证"、"不代表授权"之类的套话、重复的禁令、从代码里抄来的常量。
- **agent 之间的传播渠道**，包括：
  - 被加载了两次的规则文件，包括导入功能写出的、只替换了 agent 名字的副本；
  - 留在 agent 目录里的规则文件；
  - 失效的引用；
  - 共享 skill 的多个副本内容已经不一致；
  - 从别的 agent 复制过来的 hook；
  - 会把污染重新带回来的同步设置。
- **记忆**：把从 Codex 导入的任务日志式记忆提炼成长期有用的事实。也会检查 Codex 每个会话都会加载的 `memory_summary.md`。
- **purify 规则**：每个 agent 是否加载了 `PURIFY.md`，以及它自己的规则里有没有重复的同类规则。
- **设计文档**：从 `docs/`、`design/`、`rfc/`、`adr/`、`spec/` 等目录读取，包括被 git 忽略的目录。检查的问题有：
  - 留在设计稿里的过程记录和交接提示词；
  - 长长的"非目标"和"限制"清单；
  - 写成"不证明什么"的验收标准；
  - 没人需要的兼容、为假想需求预留的扩展点、没有说明理由的兜底。

  设计里的问题会关联到实现它的代码。详见 [`design-audit.md`](skills/purify/references/design-audit.md)。
- **代码仓库**：掩盖接口问题的兜底、重复校验、吞掉的错误、为根本编译不了的平台写的分支、只用一次的封装层、死代码、否定式注释，以及仓库里的 agent 规则文件。

## 扫描器

`skills/purify/scripts/scan.mjs` 是一个只读、无依赖的 Node 脚本：

```bash
node skills/purify/scripts/scan.mjs agents
node skills/purify/scripts/scan.mjs project ~/code/my-repo
```

它只读规则文本和少数几个指定的配置项。对规则文件会打印示例行；目录名含 `private`、`secret` 或 `credential` 的文件只报计数。它不写任何文件。

## 开发

```bash
npm test
```

测试会在临时目录里生成小型夹具，再对它们运行安装器和扫描器。

## 许可证

MIT
