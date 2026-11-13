---
name: publish-skill
description: นำสกิลที่สร้างไว้ (โฟลเดอร์ที่มี SKILL.md) เข้า git repo ตามมาตรฐาน Agent Skills เพื่อให้คนอื่นติดตั้งได้ด้วยคำสั่งเดียว เช่น `npx skills add owner/repo` รวมถึงตรวจสกิลก่อนเผยแพร่ ออกเวอร์ชันพร้อม CHANGELOG ตั้ง CI และแพ็กเป็น zip ใช้เมื่อผู้ใช้พูดว่า "publish skill", "เอาสกิลขึ้น repo", "ทำให้ติดตั้งได้ด้วย command", "แจกสกิล", "ทำ repo สกิล", "อัพเดตสกิลใน repo", "ออกเวอร์ชันสกิล", "ลบสกิลออกจาก repo" หรือต้องการแชร์สกิลให้ทีม/สาธารณะ
---

# publish-skill

Package finished skills into a git repo laid out so that the common
installers (`npx skills add`, manual copy, zip download, Claude Code plugin
marketplace) all work from the same repo, and keep that repo healthy
afterwards (updates, versions, CI).

Everything is done by one bundled script with no dependencies:

```bash
node <this-skill-dir>/scripts/publish-skill.mjs <command> [options]
```

| Command | Does |
|---|---|
| `publish` (default) | Validate, copy skills into the repo, regenerate README and metadata |
| `check` | Validate only, write nothing (this is what CI runs) |
| `list` | List the skills in a repo and its version |
| `unpublish` | Remove a skill from the repo and refresh README and metadata |
| `pack` | Build one zip (or `.skill`) per skill for sharing without git |
| `verify` | Clone the pushed GitHub repo and confirm it matches and validates |

Run the script with `--help` for the full option list.

## Target repo layout

```
<repo>/
├── README.md                 # generated skill list + install commands
├── README.th.md              # only with --lang both
├── CHANGELOG.md              # only after --bump / --version
├── LICENSE
├── AGENTS.md                 # only with --agents-md
├── assets/banner.svg
├── skills/
│   └── <skill-name>/SKILL.md # folder name MUST equal frontmatter `name`
├── .claude-plugin/           # only with --plugin
│   ├── plugin.json
│   └── marketplace.json
└── .github/                  # only with --ci / --scaffold
    ├── workflows/validate-skills.yml
    ├── workflows/release.yml
    └── ISSUE_TEMPLATE/, PULL_REQUEST_TEMPLATE.md
```

## Requirements

- `node` 18 or newer. If it is missing, stop and tell the user; do not
  hand-build the repo.
- `git`, only for the git steps and for `verify`.
- `gh` (GitHub CLI), optional: only for `gh repo create`.
- Network, only for `--license` ids other than MIT / ISC / BSD-3-Clause (the
  text is downloaded from the SPDX license list) and for `verify`.

## Workflow: publish

1. **Locate inputs.** Ask for (or infer) the skill folder(s), the target repo
   folder, and the GitHub `owner/repo`. Several skills: repeat `--skill`, or
   pass `--skills-dir <dir>` to take every skill folder inside it. `--github`
   may be omitted when the repo already has a GitHub remote or a generated
   README; the script detects it and says so.
2. **Review first (recommended).** If a skill-review skill is available, run
   it on each skill. In any case run the built-in linter and read the output:

   ```bash
   node <this-skill-dir>/scripts/publish-skill.mjs check --skill <path/to/skill>
   ```

3. **Dry run.** Always run `publish` with `--dry-run` first and show the user
   what will be copied, changed, deleted and generated.
4. **Run for real** once the dry run looks right:

   ```bash
   node <this-skill-dir>/scripts/publish-skill.mjs publish \
     --skill <path/to/skill> [--skill <another>] \
     --repo  <path/to/repo> \
     --github <owner>/<repo> \
     --author "<name>" \
     [--license MIT] [--lang en|th|both] [--plugin] \
     [--ci] [--scaffold] [--agents-md] \
     [--bump patch|minor|major] [--message "<changelog note>"] \
     [--force]
   ```

5. **Relay every warning** the script prints, then report the result and the
   install commands.
6. **Git steps are the user's call.** Offer them, run only on a clear yes:

   ```bash
   cd <repo>
   git init && git add -A && git commit -m "Add <name> skill"
   gh repo create <owner>/<repo> --public --source . --push   # or add a remote and push
   git tag v<version> && git push --tags
   ```

7. **Verify after pushing** (only once the user has pushed):

   ```bash
   node <this-skill-dir>/scripts/publish-skill.mjs verify --repo <path/to/repo>
   ```

   It clones the GitHub repo into a temp folder, validates what is there and
   compares it with the local repo. Add `--npx` to also run
   `npx skills add <owner>/<repo> --list`; that downloads and runs the
   third-party `skills` CLI, so ask first.

## What validation covers

Errors stop the publish; nothing is written.

- Frontmatter: `name` format, length, equal to the folder name;
  `description` present and at most 1024 characters.
- Secrets, reported as `file:line`: AWS, GitHub, GitLab, Slack, Discord,
  Anthropic, OpenAI-style `sk-`, Google, Stripe, npm and SendGrid keys, JWTs,
  private keys, Azure storage keys, database URLs with a real password, and
  hard-coded `password = "..."` style credentials.

Warnings do not stop the publish, but each one must be relayed to the user.

- Description too short, missing a "use when" cue, written in first person,
  or containing XML-like tags.
- Portability: non-standard frontmatter, `allowed-tools`, and tool names
  that only one agent has (Claude Code tools, MCP tool names, and similar).
- Broken relative links and mentions of `scripts/…`, `references/…`,
  `assets/…` files that do not exist; `SKILL.md` over 500 lines.
- Windows and cross-platform problems: file names invalid on Windows, names
  that differ only by case, shell scripts with CRLF line endings.
- Files that are never copied: secrets files (`.env*`, `*.pem`, `*.key`,
  `*.p12`, `*.pfx`, keystores, SSH private keys, `.npmrc`, `.netrc`,
  `credentials.json`, `token.json`, `secrets.*`, service-account JSON) and
  symlinks.
- Files that could not be scanned (binary, or over 1 MB).

A false positive can be silenced by putting `publish-skill:allow` on the
same line. Only do that after the user confirms the value is not a secret.

## Updating a skill that is already in the repo

- Identical content: the script reports "up to date" and copies nothing.
- Different content: the script prints a per-file diff (`+` added, `~`
  changed, `-` deleted from the repo) and stops. Show that diff to the user
  and get a yes before rerunning with `--force`.
- If `--skill` already points at `<repo>/skills/<name>`, nothing is copied
  or deleted; only the README and metadata are refreshed.
- `publish --repo <repo>` with no `--skill` only refreshes README and
  metadata from the skills already in the repo.

## Versions and changelog

- The version lives in `.claude-plugin/plugin.json` when present, otherwise
  in the newest `CHANGELOG.md` heading. A new repo starts at `1.0.0`.
- `--bump patch|minor|major` (or `--version x.y.z`) sets the new version and
  adds a `CHANGELOG.md` entry listing added, changed and removed skills, plus
  `--message` if given. Suggested rule: patch for wording fixes, minor for a
  new skill or new behaviour, major for a removed or renamed skill.
- Without `--bump` / `--version` the version and changelog are left alone.
- Tagging (`git tag v<version>`) is a git step: the user's call.

## Removing a skill

```bash
node <this-skill-dir>/scripts/publish-skill.mjs unpublish --repo <repo> --name <skill> --dry-run
```

Show the file list to the user. Deleting needs `--yes`; add it only after a
clear yes. The files remain in git history; say so if the reason for removal
was a leaked secret (the secret must be rotated, not just deleted).

## CI, scaffolding and zip downloads

- `--ci` writes two GitHub Actions workflows: `validate-skills.yml` runs
  `check` on every pull request and push to main; `release.yml` runs on a
  `v*` tag, packs one zip per skill and attaches them to a GitHub release.
  The workflows need the script inside the repo: if the repo does not
  contain this skill, a copy is written to `.github/scripts/`.
- `--scaffold` writes `.gitignore`, `.gitattributes` (LF line endings) and
  issue / pull request templates. `--agents-md` writes a contributor guide
  for coding agents. Existing files are kept; `--fresh` overwrites them.
- `pack --repo <repo> [--out <dir>] [--format zip|skill]` builds the same
  archives locally. Each archive holds one `<skill-name>/` folder.

## README

- `--lang en` (default), `th`, or `both` (`README.md` in English plus
  `README.th.md` in Thai, linked to each other). Later runs keep the
  language that is already there.
- Each skill card shows the description and, when the description quotes
  example phrases, a "Try" line built from them.
- By default only the block between `<!-- skills:start -->` and
  `<!-- skills:end -->` is regenerated, so hand-written text around it
  survives. `--fresh` regenerates the whole README and the banner.

## Rules

- Never publish a skill the script rejects. Fix the skill first, then rerun.
- Never run `git push`, `gh repo create`, `git tag`, `--force`, or
  `unpublish --yes` without the user's explicit yes for that step.
- Publishing makes content public if the repo is public. Confirm visibility
  (public/private) with the user before pushing.
- Keep the SKILL.md portable: only `name` and `description` are required by
  the open standard. Pass on the script's portability warnings.
- Install-command details (`npx skills add ...`, per-agent directories) can
  change; tell the user to verify them against each tool's current docs
  before announcing the repo.

## Install commands the generated README documents

```bash
npx skills add <owner>/<repo>                 # all skills in the repo
npx skills add <owner>/<repo> --skill <name>  # a single skill
```

The README also lists manual copy commands (bash and PowerShell), the
personal and project skill directories of Claude Code, Codex CLI, Cursor,
Gemini CLI, GitHub Copilot and OpenCode, the zip download when `--ci` is on,
and `/plugin marketplace add <owner>/<repo>` when `--plugin` is on.
