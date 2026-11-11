#!/usr/bin/env node
// publish-skill: package a skill folder into a git repo that installs via
// `npx skills add owner/repo` and by manual copy. No dependencies (Node 18+).
import fs from 'node:fs';
import path from 'node:path';

const FLAGS = new Set(['dry-run', 'plugin', 'force', 'help']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) fail(`Unexpected argument: ${a}`);
    const key = a.slice(2);
    if (FLAGS.has(key)) out[key] = true;
    else {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) fail(`Missing value for --${key}`);
      out[key] = v;
    }
  }
  return out;
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const USAGE = `Usage: node publish-skill.mjs --skill <dir> --repo <dir> [options]

  --skill <dir>     skill folder containing SKILL.md (required)
  --repo <dir>      target repo folder; created if missing (required)
  --github <o/r>    GitHub owner/repo, used in install commands
  --author <name>   author name for LICENSE / plugin.json
  --tagline <text>  one-line tagline shown under the README title
  --license <id>    MIT (default) | none
  --plugin          also write .claude-plugin/ for Claude Code marketplace
  --force           overwrite existing skills/<name> without complaint
  --dry-run         show what would happen, write nothing`;

// ---- frontmatter -----------------------------------------------------------
function parseFrontmatter(text) {
  const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const data = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let [, key, val] = kv;
    if (val === '>' || val === '|' || val === '>-' || val === '|-') {
      const buf = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) buf.push(lines[++i].trim());
      val = buf.join(val.startsWith('>') ? ' ' : '\n');
    } else {
      val = val.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    }
    data[key] = val;
  }
  return data;
}

// ---- validation ------------------------------------------------------------
const SECRET_PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/sk-[A-Za-z0-9_-]{20,}/, 'API key (sk-...)'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"\s]{8,}['"]/i, 'hard-coded credential'],
];
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db']);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || SKIP_FILES.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function validateSkill(skillDir) {
  const errors = [];
  const warnings = [];
  const file = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(file)) fail(`No SKILL.md in ${skillDir}`);
  const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  if (!fm) fail('SKILL.md has no YAML frontmatter (--- ... ---)');

  const { name, description } = fm;
  if (!name) errors.push('frontmatter `name` is missing');
  else {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))
      errors.push(`name "${name}" must be lowercase letters/digits separated by single hyphens`);
    if (name.length > 64) errors.push('name is longer than 64 characters');
    if (name !== path.basename(path.resolve(skillDir)))
      errors.push(`folder name "${path.basename(path.resolve(skillDir))}" must equal name "${name}"`);
  }
  if (!description) errors.push('frontmatter `description` is missing');
  else if (description.length > 1024) errors.push('description is longer than 1024 characters');

  for (const k of Object.keys(fm))
    if (!['name', 'description', 'license', 'metadata', 'compatibility'].includes(k))
      warnings.push(`non-standard frontmatter field "${k}" may be ignored by other agents`);

  for (const f of walk(skillDir)) {
    if (fs.statSync(f).size > 1_000_000) continue;
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (text.includes('\u0000')) continue; // binary
    for (const [re, label] of SECRET_PATTERNS)
      if (re.test(text)) errors.push(`possible ${label} in ${path.relative(skillDir, f)}`);
  }
  return { fm, errors, warnings };
}

// ---- generators ------------------------------------------------------------
const START = '<!-- skills:start -->';
const END = '<!-- skills:end -->';

function listSkills(repo) {
  const root = path.join(repo, 'skills');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'SKILL.md')))
    .map((e) => {
      const fm = parseFrontmatter(fs.readFileSync(path.join(root, e.name, 'SKILL.md'), 'utf8')) || {};
      return { name: e.name, description: fm.description || '' };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const FENCE = '```';

function shortDesc(d) {
  let t = d.replace(/\s+/g, ' ').trim();
  const cut = t.search(/\s(ใช้เมื่อ|Use when|Use this when|Trigger)/i);
  if (cut > 20) t = t.slice(0, cut).trim();
  if (t.length > 180) t = t.slice(0, 177).trimEnd() + '...';
  return t.replace(/\|/g, '\\|');
}

function readmeHeader({ title, ref, tagline, license, count }) {
  const lic = license === 'none' ? '' : ` ![License](https://img.shields.io/badge/license-${encodeURIComponent(license.toUpperCase())}-blue.svg)`;
  const gh = ref.includes('<') ? '' : ` [![Stars](https://img.shields.io/github/stars/${ref}?style=social)](https://github.com/${ref})`;
  return `<div align="center">

# ${title}

**${tagline}**

![Agent Skills](https://img.shields.io/badge/Agent%20Skills-compatible-8A2BE2.svg)${lic} ![Skills](https://img.shields.io/badge/skills-${count}-brightgreen.svg) ![Zero dependencies](https://img.shields.io/badge/dependencies-0-lightgrey.svg)${gh}

[Skills](#-skills) · [Install](#-install) · [Layout](#-repo-layout) · [Contributing](#-contributing)

</div>

---

`;
}

function readmeBlock(skills, gh, plugin) {
  const ref = gh || '<owner>/<repo>';
  const base = path.posix.basename(ref);
  const first = skills[0]?.name || '<skill-name>';
  const rows = skills
    .map((s) => `| **${s.name}** | ${shortDesc(s.description)} | <code>npx skills add ${ref} --skill ${s.name}</code> |`)
    .join('\n');
  const tree = [
    `${base}/`,
    '├── README.md',
    '├── LICENSE',
    ...(plugin ? ['├── .claude-plugin/', '│   ├── plugin.json', '│   └── marketplace.json'] : []),
    '└── skills/',
    ...skills.map((s, i) => `    ${i === skills.length - 1 ? '└──' : '├──'} ${s.name}/SKILL.md`),
  ].join('\n');
  const pluginSection = plugin
    ? `
### Option 2 — Claude Code plugin marketplace

${FENCE}
/plugin marketplace add ${ref}
${FENCE}
`
    : '';
  return `${START}
## ✨ Skills

| Skill | What it does | Install just this one |
|---|---|---|
${rows}

## 🚀 Install

### Option 1 — one command (recommended)

${FENCE}bash
# every skill in this repo
npx skills add ${ref}

# a single skill
npx skills add ${ref} --skill ${first}
${FENCE}
${pluginSection}
### ${plugin ? 'Option 3' : 'Option 2'} — manual copy

${FENCE}bash
git clone https://github.com/${ref}.git
cp -r ${base}/skills/${first} ~/.claude/skills/
${FENCE}

<details>
<summary>Where do skills live for each agent?</summary>

| Agent | Personal | Project |
|---|---|---|
| Claude Code | \`~/.claude/skills/\` | \`.claude/skills/\` |
| Codex CLI | \`~/.codex/skills/\` | \`.agents/skills/\` |
| Others | see the tool's docs | see the tool's docs |

Directories and CLI flags can change; check each tool's current documentation.

</details>

## 📁 Repo layout

${FENCE}text
${tree}
${FENCE}

Each skill folder name equals the \`name\` in its \`SKILL.md\` frontmatter, as the Agent Skills standard requires.

## 🤝 Contributing

1. Add or edit a skill under \`skills/<name>/SKILL.md\`.
2. Keep \`name\` (lowercase-hyphen, equal to the folder) and \`description\` in the frontmatter.
3. Never commit secrets; the publish script scans for them.
4. Open a pull request.
${END}`;
}

function licenseMIT(author) {
  return `MIT License

Copyright (c) ${new Date().getFullYear()} ${author || '<author>'}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

// ---- main ------------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log(USAGE); process.exit(0); }
if (!args.skill || !args.repo) { console.error(USAGE); process.exit(1); }
if (args.github && !/^[\w.-]+\/[\w.-]+$/.test(args.github)) fail('--github must look like owner/repo');

const dry = !!args['dry-run'];
const skillDir = path.resolve(args.skill);
const repo = path.resolve(args.repo);
const { fm, errors, warnings } = validateSkill(skillDir);

warnings.forEach((w) => console.warn(`warning: ${w}`));
if (errors.length) {
  errors.forEach((e) => console.error(`error: ${e}`));
  fail('skill failed validation; nothing was written');
}

const dest = path.join(repo, 'skills', fm.name);
const say = (m) => console.log(`${dry ? '[dry-run] ' : ''}${m}`);
const exists = fs.existsSync(dest);

if (exists && !args.force) say(`updating existing skills/${fm.name} (files removed from the source will be removed here)`);
say(`${exists ? 'replace' : 'copy'} ${skillDir} -> ${dest}`);

if (!dry) {
  fs.mkdirSync(path.join(repo, 'skills'), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(skillDir, dest, {
    recursive: true,
    filter: (src) => !SKIP_DIRS.has(path.basename(src)) && !SKIP_FILES.has(path.basename(src)),
  });
}

// README
const skills = dry
  ? [...listSkills(repo).filter((s) => s.name !== fm.name), { name: fm.name, description: fm.description }]
      .sort((a, b) => a.name.localeCompare(b.name))
  : listSkills(repo);
const repoName = path.basename(repo);
const block = readmeBlock(skills, args.github, !!args.plugin);
const readmePath = path.join(repo, 'README.md');
let readme;
if (fs.existsSync(readmePath)) {
  const cur = fs.readFileSync(readmePath, 'utf8');
  readme = cur.includes(START) && cur.includes(END)
    ? cur.replace(new RegExp(`${START}[\\s\\S]*?${END}`), () => block)
    : `${cur.trimEnd()}\n\n${block}\n`;
} else {
  const title = args.github ? args.github.split('/')[1] : repoName;
  const tagline = args.tagline || `Install ${skills.length === 1 ? skills[0].name : 'these agent skills'} with a single command.`;
  readme = `${readmeHeader({ title, ref: args.github || '<owner>/<repo>', tagline, license: (args.license || 'MIT').toLowerCase(), count: skills.length })}${block}\n\n---\n\n<div align="center"><sub>Made with the <code>publish-skill</code> skill</sub></div>\n`;
}
say(`write README.md (${skills.length} skill${skills.length === 1 ? '' : 's'})`);
if (!dry) fs.writeFileSync(readmePath, readme);

// LICENSE
const lic = (args.license || 'MIT').toLowerCase();
if (lic === 'mit' && !fs.existsSync(path.join(repo, 'LICENSE'))) {
  say('write LICENSE (MIT)');
  if (!dry) fs.writeFileSync(path.join(repo, 'LICENSE'), licenseMIT(args.author));
} else if (lic !== 'mit' && lic !== 'none') {
  fail(`unsupported --license "${args.license}" (use MIT or none)`);
}

// Claude Code plugin metadata
if (args.plugin) {
  const pname = args.github ? args.github.split('/')[1] : repoName;
  const meta = path.join(repo, '.claude-plugin');
  const author = args.author ? { name: args.author } : undefined;
  const plugin = {
    name: pname,
    description: `Agent skills: ${skills.map((s) => s.name).join(', ')}`,
    version: '1.0.0',
    ...(author && { author }),
  };
  const market = {
    name: pname,
    owner: { name: args.author || (args.github ? args.github.split('/')[0] : pname) },
    plugins: [{ name: pname, source: './', description: plugin.description }],
  };
  say('write .claude-plugin/plugin.json and marketplace.json');
  if (!dry) {
    fs.mkdirSync(meta, { recursive: true });
    fs.writeFileSync(path.join(meta, 'plugin.json'), JSON.stringify(plugin, null, 2) + '\n');
    fs.writeFileSync(path.join(meta, 'marketplace.json'), JSON.stringify(market, null, 2) + '\n');
  }
}

const ref = args.github || '<owner>/<repo>';
console.log(`
Done${dry ? ' (dry run, nothing written)' : ''}. After you push the repo, others install with:

  npx skills add ${ref} --skill ${fm.name}
${args.plugin ? `  /plugin marketplace add ${ref}   (Claude Code)\n` : ''}
Next (your call): cd "${repo}" && git init && git add -A && git commit -m "Add ${fm.name} skill"`);
