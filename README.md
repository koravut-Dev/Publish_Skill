<div align="center">

# Publish_Skill

**Package any agent skill into an installable git repo with one command**

![Agent Skills](https://img.shields.io/badge/Agent%20Skills-compatible-8A2BE2.svg) ![License](https://img.shields.io/badge/license-MIT-blue.svg) ![Skills](https://img.shields.io/badge/skills-1-brightgreen.svg) ![Zero dependencies](https://img.shields.io/badge/dependencies-0-lightgrey.svg) [![Stars](https://img.shields.io/github/stars/koravut-Dev/Publish_Skill?style=social)](https://github.com/koravut-Dev/Publish_Skill)

[Skills](#-skills) · [Install](#-install) · [Layout](#-repo-layout) · [Contributing](#-contributing)

</div>

---

<!-- skills:start -->
## ✨ Skills

| Skill | What it does | Install just this one |
|---|---|---|
| **publish-skill** | นำสกิลที่สร้างไว้ (โฟลเดอร์ที่มี SKILL.md) เข้า git repo ตามมาตรฐาน Agent Skills เพื่อให้คนอื่นติดตั้งได้ด้วยคำสั่งเดียว เช่น `npx skills add owner/repo` | <code>npx skills add koravut-Dev/Publish_Skill --skill publish-skill</code> |

## 🚀 Install

### Option 1 — one command (recommended)

```bash
# every skill in this repo
npx skills add koravut-Dev/Publish_Skill

# a single skill
npx skills add koravut-Dev/Publish_Skill --skill publish-skill
```

### Option 2 — manual copy

```bash
git clone https://github.com/koravut-Dev/Publish_Skill.git
cp -r Publish_Skill/skills/publish-skill ~/.claude/skills/
```

<details>
<summary>Where do skills live for each agent?</summary>

| Agent | Personal | Project |
|---|---|---|
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Codex CLI | `~/.codex/skills/` | `.agents/skills/` |
| Others | see the tool's docs | see the tool's docs |

Directories and CLI flags can change; check each tool's current documentation.

</details>

## 📁 Repo layout

```text
Publish_Skill/
├── README.md
├── LICENSE
└── skills/
    └── publish-skill/SKILL.md
```

Each skill folder name equals the `name` in its `SKILL.md` frontmatter, as the Agent Skills standard requires.

## 🤝 Contributing

1. Add or edit a skill under `skills/<name>/SKILL.md`.
2. Keep `name` (lowercase-hyphen, equal to the folder) and `description` in the frontmatter.
3. Never commit secrets; the publish script scans for them.
4. Open a pull request.
<!-- skills:end -->

---

<div align="center"><sub>Made with the <code>publish-skill</code> skill</sub></div>
