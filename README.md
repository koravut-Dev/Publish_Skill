<div align="center">

<img src="assets/banner.svg" alt="Publish_Skill" width="100%">

<br><br>

<img alt="Agent Skills" src="https://img.shields.io/badge/AGENT%20SKILLS-COMPATIBLE-a855f7?style=for-the-badge&labelColor=0a0a1f">
<img alt="License" src="https://img.shields.io/badge/LICENSE-MIT-22d3ee?style=for-the-badge&labelColor=0a0a1f">
<img alt="Skills" src="https://img.shields.io/badge/SKILLS-1-f472b6?style=for-the-badge&labelColor=0a0a1f">
<img alt="Dependencies" src="https://img.shields.io/badge/DEPENDENCIES-0-34d399?style=for-the-badge&labelColor=0a0a1f">
<a href="https://github.com/koravut-Dev/Publish_Skill"><img alt="Stars" src="https://img.shields.io/github/stars/koravut-Dev/Publish_Skill?style=for-the-badge&logo=github&labelColor=0a0a1f&color=a855f7"></a>

<br>

**[Skills](#skills)** &nbsp;·&nbsp; **[Install](#install)** &nbsp;·&nbsp; **[How it works](#how-it-works)** &nbsp;·&nbsp; **[Layout](#repo-layout)** &nbsp;·&nbsp; **[Contribute](#contributing)**

<br>

```bash
npx skills add koravut-Dev/Publish_Skill
```

</div>

<!-- skills:start -->
## Skills

<table>
<tr>
<td colspan="2" valign="top">

#### publish-skill

นำสกิลที่สร้างไว้ (โฟลเดอร์ที่มี SKILL.md) เข้า git repo ตามมาตรฐาน Agent Skills เพื่อให้คนอื่นติดตั้งได้ด้วยคำสั่งเดียว เช่น `npx skills add owner/repo`

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
<summary><b>Manual copy</b></summary>

```bash
git clone https://github.com/koravut-Dev/Publish_Skill.git
cp -r Publish_Skill/skills/publish-skill ~/.claude/skills/
```

| Agent | Personal | Project |
|---|---|---|
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Codex CLI | `~/.codex/skills/` | `.agents/skills/` |
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
├── LICENSE
├── assets/
│   └── banner.svg
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
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
