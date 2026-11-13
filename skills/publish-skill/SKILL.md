---
name: publish-skill
description: นำสกิลที่สร้างไว้ (โฟลเดอร์ที่มี SKILL.md) เข้า git repo ตามมาตรฐาน Agent Skills เพื่อให้คนอื่นติดตั้งได้ด้วยคำสั่งเดียว เช่น `npx skills add owner/repo` ใช้เมื่อผู้ใช้พูดว่า "publish skill", "เอาสกิลขึ้น repo", "ทำให้ติดตั้งได้ด้วย command", "แจกสกิล", "ทำ repo สกิล" หรือต้องการแชร์สกิลให้ทีม/สาธารณะ
---

# publish-skill

Package a finished skill into a git repo laid out so that the common
installers (`npx skills add`, manual copy, Claude Code plugin marketplace)
all work from the same repo.

## Target repo layout

```
<repo>/
├── README.md                 # auto-generated skill list + install commands
├── LICENSE
├── skills/
│   └── <skill-name>/SKILL.md # folder name MUST equal frontmatter `name`
└── .claude-plugin/           # only with --plugin
    ├── plugin.json
    └── marketplace.json
```

## Requirements

- `node` 18 or newer (runs the bundled script; no packages to install).
- `git`, only for the optional git steps.
- `gh` (GitHub CLI), optional: only for `gh repo create`. Without it, the
  user creates the repo on GitHub and adds a remote.

If `node` is missing, stop and tell the user; do not hand-build the repo.

## Workflow

1. **Locate inputs.** Ask for (or infer) the skill folder, the target repo
   folder, and the GitHub `owner/repo` it will live at. If the user has no
   repo yet, the script creates the folder; do not run `git push` or
   `gh repo create` without explicit confirmation.
2. **Dry run first.** Always run with `--dry-run` and show the user what
   will be copied and generated.
3. **Run for real** once the dry run looks right:

   ```bash
   node <this-skill-dir>/scripts/publish-skill.mjs \
     --skill <path/to/skill> \
     --repo  <path/to/repo> \
     --github <owner>/<repo> \
     --author "<name>" \
     [--license MIT] [--plugin] [--force]
   ```

   The script validates the skill (name format, description, folder name
   match, secret scan), copies it into `skills/<name>/`, regenerates the
   README block between `<!-- skills:start -->` and `<!-- skills:end -->`,
   and creates `LICENSE` if missing.

   - If `skills/<name>/` already exists in the repo the script stops.
     `--force` replaces it, deleting files that are no longer in the
     source: show the dry run and get a yes before adding `--force`.
   - If `--skill` already points at `<repo>/skills/<name>`, nothing is
     copied or deleted; only the README and metadata are refreshed.
   - Secrets files (`.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, SSH private
     keys) are never copied. Files the scan could not read (binary, over
     1 MB) are listed as warnings: relay every warning to the user.
4. **Report** the result and the install commands it prints.
5. **Git steps are the user's call.** Offer these, run only on a clear yes:

   ```bash
   cd <repo>
   git init && git add -A && git commit -m "Add <name> skill"
   gh repo create <owner>/<repo> --public --source . --push   # or add a remote and push
   git tag v1.0.0 && git push --tags
   ```

## Rules

- Never publish a skill the script rejects (secret found, bad name). Fix the
  skill first, then rerun.
- Publishing makes content public if the repo is public. Confirm visibility
  (public/private) with the user before pushing.
- Keep the SKILL.md portable: only `name` and `description` are required by
  the open standard. Warn the user if the skill relies on tool-specific
  frontmatter (e.g. `allowed-tools`) or names tool-specific tools in its
  body, since other agents may ignore or misread them.
- Install-command details (`npx skills add ...`, per-agent directories) can
  change; tell the user to verify them against current docs of each tool
  before announcing the repo.

## Install commands the generated README documents

```bash
npx skills add <owner>/<repo>                 # all skills in the repo
npx skills add <owner>/<repo> --skill <name>  # a single skill
```

Manual fallback and per-agent directories (Claude Code, Codex, etc.) are
written into the README by the script. With `--plugin`, Claude Code users
can also use `/plugin marketplace add <owner>/<repo>`.
