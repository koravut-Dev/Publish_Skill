# AGENTS.md

Guide for coding agents working in this repo.

## What this repo is

A collection of Agent Skills. Each skill is a folder under `skills/` with a
`SKILL.md` (YAML frontmatter with `name` and `description`, then instructions).

## Rules

- The folder name must equal the frontmatter `name` (lowercase, hyphens).
- `description` states what the skill does and when to use it, in third person.
- Keep `SKILL.md` under 500 lines; put detail in `references/` and code in `scripts/`.
- Never add secrets. `.env*`, key files and credential files must stay out of the repo.
- Do not hand-edit the README between `<!-- skills:start -->` and
  `<!-- skills:end -->`; it is generated.
- Do not push, tag or change repo visibility without the owner's explicit yes.

## Layout

```text
Publish_Skill/
├── README.md        generated skill list and install commands
├── CHANGELOG.md     one entry per released version
├── skills/<name>/   one folder per skill
└── .github/         CI: validates every pull request
```
