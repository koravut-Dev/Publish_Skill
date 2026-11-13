<div align="center">

<img src="assets/banner.svg" alt="Publish_Skill" width="100%">

<br><br>

<img alt="Agent Skills" src="https://img.shields.io/badge/AGENT%20SKILLS-COMPATIBLE-a855f7?style=for-the-badge&labelColor=0a0a1f">
<img alt="License" src="https://img.shields.io/badge/LICENSE-MIT-22d3ee?style=for-the-badge&labelColor=0a0a1f">
<img alt="Skills" src="https://img.shields.io/badge/SKILLS-1-f472b6?style=for-the-badge&labelColor=0a0a1f">
<img alt="Dependencies" src="https://img.shields.io/badge/DEPENDENCIES-0-34d399?style=for-the-badge&labelColor=0a0a1f">
<a href="https://github.com/koravut-Dev/Publish_Skill/tags"><img alt="Version" src="https://img.shields.io/github/v/tag/koravut-Dev/Publish_Skill?style=for-the-badge&labelColor=0a0a1f&label=VERSION&color=22d3ee"></a>
<a href="https://github.com/koravut-Dev/Publish_Skill/actions"><img alt="Checks" src="https://img.shields.io/github/actions/workflow/status/koravut-Dev/Publish_Skill/validate-skills.yml?style=for-the-badge&labelColor=0a0a1f&label=CHECKS"></a>
<a href="https://github.com/koravut-Dev/Publish_Skill"><img alt="Stars" src="https://img.shields.io/github/stars/koravut-Dev/Publish_Skill?style=for-the-badge&labelColor=0a0a1f&logo=github&color=a855f7"></a>

<br>

**English** &nbsp;·&nbsp; [ไทย](README.th.md)

**[Features](#features)** &nbsp;·&nbsp; **[Skills](#skills)** &nbsp;·&nbsp; **[Install](#install)** &nbsp;·&nbsp; **[How it works](#how-it-works)** &nbsp;·&nbsp; **[Layout](#repo-layout)** &nbsp;·&nbsp; **[Contribute](#contributing)**

<br>

```bash
npx skills add koravut-Dev/Publish_Skill
```

</div>

<!-- intro:start -->
## Features

You wrote a skill. Turning it into a repo that installs cleanly in every agent is the tedious part: layout, README, license, secret checks, versions, CI. `publish-skill` does all of it with one dependency-free script, and refuses to publish anything that leaks a secret.

<img src="assets/demo.svg" alt="Terminal demo: publish-skill packaging a skill into a repo" width="100%">

<table>
<tr>
<td width="33%" valign="top">

#### Secret scan

19 token patterns (AWS, GitHub, Slack, Anthropic, Stripe, JWTs, database URLs and more), reported as `file:line`. A hit stops the publish before anything is written.

</td>
<td width="33%" valign="top">

#### Skill linter

Checks the frontmatter, the description's trigger wording, broken links, agent-specific tool names, Windows-invalid file names and CRLF shell scripts.

</td>
<td width="33%" valign="top">

#### Diff before update

Updating a skill prints every file that will be added, changed or deleted, and waits for `--force`. Identical content is skipped.

</td>
</tr>
<tr>
<td valign="top">

#### Versions and changelog

`--bump patch|minor|major` sets the version and writes a `CHANGELOG.md` entry listing added, changed and removed skills.

</td>
<td valign="top">

#### CI and releases

`--ci` adds GitHub Actions that validate every pull request, then build one zip per skill and attach them to a release when you push a tag.

</td>
<td valign="top">

#### Every install route

`npx skills add`, manual copy, zip download and the Claude Code plugin marketplace all work from the same repo. README in English, Thai or both.

</td>
</tr>
</table>

### Six commands, one script

| Command | What it does |
|---|---|
| `publish` | Validate, copy skills into the repo, regenerate README and metadata |
| `check` | Lint and secret-scan only; this is what CI runs |
| `list` | Show the skills in a repo and its version |
| `unpublish` | Remove a skill and refresh README and metadata (needs `--yes`) |
| `pack` | Build one `.zip` or `.skill` per skill for sharing without git |
| `verify` | Clone the pushed repo and confirm it matches local and validates |

### It stops bad publishes

```text
error: [bad-skill] a.js:1: possible GitHub token
error: [bad-skill] a.js:2: possible connection string with a password
warning: [demo-skill] scripts/run.sh: shell script has CRLF line endings; it will fail on macOS/Linux
warning: [demo-skill] SKILL.md:7: link "references/missing.md" points to a file that does not exist
error: validation failed; nothing was written
```

### Updates show a diff first

```text
[demo-skill] update ./demo-skill -> ./my-skills/skills/demo-skill
    + new.txt
    ~ SKILL.md
    - scripts/run.sh  (deleted from the repo)
[demo-skill] already exists with different content; rerun with --force to apply the changes above.
```

### From folder to release

```mermaid
flowchart LR
    A[Skill folder] --> B[check]
    B --> C[publish dry run]
    C --> D[publish]
    D --> E[git push]
    E --> F[CI validates]
    F --> G[git tag]
    G --> H[Release with zips]
```

### Quick start

Install the skill, then ask your agent: *"publish skill ./my-skill to you/my-skills"*. Or run the script yourself:

```bash
node skills/publish-skill/scripts/publish-skill.mjs publish --skill ./my-skill --repo ./my-skills --github you/my-skills --plugin --ci --dry-run
```

Drop `--dry-run` once the plan looks right. Nothing is ever pushed for you: git steps stay your call.
<!-- intro:end -->

<!-- skills:start -->
<!-- skills:lang=en -->
## Skills

<table>
<tr>
<td colspan="2" valign="top">

#### publish-skill

นำสกิลที่สร้างไว้ (โฟลเดอร์ที่มี SKILL.md) เข้า git repo ตามมาตรฐาน Agent Skills เพื่อให้คนอื่นติดตั้งได้ด้วยคำสั่งเดียว เช่น `npx skills add owner/repo` รวมถึงตรวจสกิลก่อนเผยแพ...

<sub>Try: <code>publish skill</code> · <code>เอาสกิลขึ้น repo</code> · <code>ทำให้ติดตั้งได้ด้วย command</code> · <code>แจกสกิล</code></sub>

```bash
npx skills add koravut-Dev/Publish_Skill --skill publish-skill
```

</td>
</tr>
</table>

## Install

> [!TIP]
> One command installs every skill in this repo into all the agents it detects.

```bash
# every skill in this repo
npx skills add koravut-Dev/Publish_Skill

# a single skill
npx skills add koravut-Dev/Publish_Skill --skill publish-skill
```

<details>
<summary><b>Claude Code plugin marketplace</b></summary>

```text
/plugin marketplace add koravut-Dev/Publish_Skill
```

</details>

<details>
<summary><b>Download a zip</b></summary>

Every [release](https://github.com/koravut-Dev/Publish_Skill/releases) attaches one zip per skill. Unzip it into your agent's skills directory.

</details>

<details>
<summary><b>Manual copy</b></summary>

```bash
git clone https://github.com/koravut-Dev/Publish_Skill.git
cp -r Publish_Skill/skills/publish-skill ~/.claude/skills/
```

```powershell
Copy-Item -Recurse Publish_Skill\skills\publish-skill "$HOME\.claude\skills\"
```

| Agent | Personal | Project |
|---|---|---|
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Codex CLI | `~/.codex/skills/` | `.agents/skills/` |
| Cursor | `~/.cursor/skills/` | `.cursor/skills/` |
| Gemini CLI | `~/.gemini/skills/` | `.gemini/skills/` |
| GitHub Copilot | `~/.copilot/skills/` | `.github/skills/` |
| OpenCode | `~/.config/opencode/skills/` | `.opencode/skills/` |
| Others | see the tool's docs | see the tool's docs |

</details>

> [!IMPORTANT]
> Skills run with the full permissions of your agent. Read a skill before you install it. Directories and CLI flags change over time, so check each tool's current documentation.

## How it works

```mermaid
flowchart LR
    A[npx skills add] --> B[Clone repo]
    B --> C[Find SKILL.md files]
    C --> D[Install for each agent]
    D --> E[Claude Code]
    D --> F[Codex]
    D --> G[Cursor]
    D --> H[Gemini CLI]
```

## Repo layout

```text
Publish_Skill/
├── README.md
├── README.th.md
├── CHANGELOG.md
├── AGENTS.md
├── LICENSE
├── assets/
│   └── banner.svg
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── .github/
│   └── workflows/
└── skills/
    └── publish-skill/SKILL.md
```

Each skill folder name equals the `name` in its `SKILL.md` frontmatter, as the Agent Skills standard requires.

## Contributing

1. Add or edit a skill under `skills/<name>/SKILL.md`.
2. Keep `name` (lowercase-hyphen, equal to the folder) and `description` in the frontmatter.
3. Never commit secrets; the publish script scans for them.
4. Open a pull request.
<!-- skills:end -->

<div align="center">

<sub>Generated with the <code>publish-skill</code> skill &nbsp;·&nbsp; <a href="#">Back to top ↑</a></sub>

</div>
