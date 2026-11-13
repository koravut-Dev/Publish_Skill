#!/usr/bin/env node
// publish-skill: package a skill folder into a git repo that installs via
// `npx skills add owner/repo` and by manual copy. No dependencies (Node 18+).
import fs from 'node:fs';
import path from 'node:path';

const FLAGS = new Set(['dry-run', 'plugin', 'force', 'fresh', 'help']);

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
  --force           replace an existing skills/<name> (without it the script stops)
  --fresh           regenerate the whole README + assets/banner.svg (default keeps
                    an existing README and only refreshes the skills block)
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
// Files that usually hold secrets: never copied into the repo.
const isSensitive = (name) =>
  /^\.env(\..*)?$/i.test(name) || /\.(pem|key|p12|pfx)$/i.test(name) || /^id_(rsa|dsa|ecdsa|ed25519)$/.test(name);
const isSkipped = (name) => SKIP_DIRS.has(name) || SKIP_FILES.has(name) || isSensitive(name);

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
    const rel = path.relative(skillDir, f);
    if (isSensitive(path.basename(f))) {
      warnings.push(`${rel} looks like a secrets file and will NOT be copied`);
      continue;
    }
    if (fs.statSync(f).size > 1_000_000) {
      warnings.push(`${rel} is larger than 1 MB: copied but not scanned for secrets`);
      continue;
    }
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch {
      warnings.push(`${rel} could not be read: copied but not scanned for secrets`);
      continue;
    }
    if (text.includes('\u0000')) { // binary
      warnings.push(`${rel} is binary: copied but not scanned for secrets`);
      continue;
    }
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
  return t;
}

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const html = xml;

// Self-contained animated banner. Dark by default, switches with prefers-color-scheme.
function bannerSvg({ title, tagline, count }) {
  const fs = Math.max(40, Math.min(88, Math.floor(1000 / (Math.max(title.length, 6) * 0.6))));
  const tg = tagline.length > 90 ? tagline.slice(0, 87) + '...' : tagline;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 340" width="1280" height="340" role="img" aria-label="${xml(title)}">
  <title>${xml(title)}</title>
  <style>
    .bg-a{stop-color:#0a0a1f}.bg-b{stop-color:#1b0b3a}
    .o1{fill:#22d3ee}.o2{fill:#a855f7}.o3{fill:#f472b6}
    .grid{stroke:#ffffff;stroke-opacity:.05}
    .t1{stop-color:#67e8f9}.t2{stop-color:#c084fc}.t3{stop-color:#f9a8d4}
    .tag{fill:#c7c9e6;font:400 24px 'Segoe UI',system-ui,-apple-system,'Noto Sans Thai',sans-serif}
    .pill{fill:#ffffff;fill-opacity:.08;stroke:#ffffff;stroke-opacity:.2}
    .pilltxt{fill:#e5e7ff;font:600 14px 'Segoe UI',system-ui,sans-serif;letter-spacing:3px}
    .title{font:800 ${fs}px 'Segoe UI',system-ui,-apple-system,'Noto Sans Thai',sans-serif;letter-spacing:-2px}
    @media (prefers-color-scheme: light){
      .bg-a{stop-color:#f5f3ff}.bg-b{stop-color:#e0f2fe}
      .o1{fill:#06b6d4}.o2{fill:#8b5cf6}.o3{fill:#ec4899}
      .grid{stroke:#4c1d95;stroke-opacity:.07}
      .t1{stop-color:#0891b2}.t2{stop-color:#7c3aed}.t3{stop-color:#db2777}
      .tag{fill:#4b5563}
      .pill{fill:#4c1d95;fill-opacity:.07;stroke:#4c1d95;stroke-opacity:.25}
      .pilltxt{fill:#4c1d95}
    }
    @media (prefers-reduced-motion: reduce){ animateTransform,animate{display:none} }
  </style>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop class="bg-a" offset="0"/><stop class="bg-b" offset="1"/></linearGradient>
    <linearGradient id="tx" x1="0" y1="0" x2="1" y2="0">
      <stop class="t1" offset="0"/><stop class="t2" offset=".55"/><stop class="t3" offset="1"/>
      <animate attributeName="x1" values="0;-0.4;0" dur="9s" repeatCount="indefinite"/>
      <animate attributeName="x2" values="1;0.6;1" dur="9s" repeatCount="indefinite"/>
    </linearGradient>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70"/></filter>
    <pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse"><path class="grid" d="M40 0H0V40" fill="none" stroke-width="1"/></pattern>
    <clipPath id="r"><rect width="1280" height="340" rx="28"/></clipPath>
  </defs>
  <g clip-path="url(#r)">
    <rect width="1280" height="340" fill="url(#bg)"/>
    <g filter="url(#blur)" opacity=".55">
      <circle class="o1" cx="180" cy="80" r="130"><animateTransform attributeName="transform" type="translate" values="0 0;90 50;0 0" dur="14s" repeatCount="indefinite"/></circle>
      <circle class="o2" cx="760" cy="300" r="150"><animateTransform attributeName="transform" type="translate" values="0 0;-120 -40;0 0" dur="17s" repeatCount="indefinite"/></circle>
      <circle class="o3" cx="1120" cy="70" r="120"><animateTransform attributeName="transform" type="translate" values="0 0;-60 70;0 0" dur="12s" repeatCount="indefinite"/></circle>
    </g>
    <rect width="1280" height="340" fill="url(#g)"/>
  </g>
  <g transform="translate(640 0)" text-anchor="middle">
    <rect class="pill" x="-118" y="40" width="236" height="34" rx="17"/>
    <text class="pilltxt" y="62">AGENT SKILLS · ${count}</text>
    <text class="title" y="190" fill="url(#tx)">${xml(title)}</text>
    <text class="tag" y="250">${xml(tg)}</text>
  </g>
</svg>
`;
}

function readmeHeader({ title, ref, license, count }) {
  const real = !ref.includes('<');
  const lic = license === 'none' ? '' : `<img alt="License" src="https://img.shields.io/badge/LICENSE-${encodeURIComponent(license.toUpperCase())}-22d3ee?style=for-the-badge&labelColor=0a0a1f">\n`;
  const star = real
    ? `<a href="https://github.com/${ref}"><img alt="Stars" src="https://img.shields.io/github/stars/${ref}?style=for-the-badge&logo=github&labelColor=0a0a1f&color=a855f7"></a>\n`
    : '';
  return `<div align="center">

<img src="assets/banner.svg" alt="${html(title)}" width="100%">

<br><br>

<img alt="Agent Skills" src="https://img.shields.io/badge/AGENT%20SKILLS-COMPATIBLE-a855f7?style=for-the-badge&labelColor=0a0a1f">
${lic}<img alt="Skills" src="https://img.shields.io/badge/SKILLS-${count}-f472b6?style=for-the-badge&labelColor=0a0a1f">
<img alt="Dependencies" src="https://img.shields.io/badge/DEPENDENCIES-0-34d399?style=for-the-badge&labelColor=0a0a1f">
${star}
<br>

**[Skills](#skills)** &nbsp;·&nbsp; **[Install](#install)** &nbsp;·&nbsp; **[How it works](#how-it-works)** &nbsp;·&nbsp; **[Layout](#repo-layout)** &nbsp;·&nbsp; **[Contribute](#contributing)**

<br>

${FENCE}bash
npx skills add ${ref}
${FENCE}

</div>

`;
}

function readmeBlock(skills, gh, plugin) {
  const ref = gh || '<owner>/<repo>';
  const base = path.posix.basename(ref);
  const first = skills[0]?.name || '<skill-name>';

  const cell = (s, attrs) =>
    `<td ${attrs} valign="top">\n\n#### ${s.name}\n\n${html(shortDesc(s.description))}\n\n${FENCE}bash\nnpx skills add ${ref} --skill ${s.name}\n${FENCE}\n\n</td>`;
  const rowsHtml = [];
  for (let i = 0; i < skills.length; i += 2) {
    // a lone last card spans the full row instead of leaving an empty cell
    const pair = skills[i + 1]
      ? [cell(skills[i], 'width="50%"'), cell(skills[i + 1], 'width="50%"')]
      : [cell(skills[i], 'colspan="2"')];
    rowsHtml.push(`<tr>\n${pair.join('\n')}\n</tr>`);
  }

  const tree = [
    `${base}/`,
    '├── README.md',
    '├── LICENSE',
    '├── assets/',
    '│   └── banner.svg',
    ...(plugin ? ['├── .claude-plugin/', '│   ├── plugin.json', '│   └── marketplace.json'] : []),
    '└── skills/',
    ...skills.map((s, i) => `    ${i === skills.length - 1 ? '└──' : '├──'} ${s.name}/SKILL.md`),
  ].join('\n');

  const n = plugin ? 3 : 2;
  const pluginSection = plugin
    ? `
<details>
<summary><b>Claude Code plugin marketplace</b></summary>

${FENCE}text
/plugin marketplace add ${ref}
${FENCE}

</details>
`
    : '';

  return `${START}
## Skills

<table>
${rowsHtml.join('\n')}
</table>

## Install

> [!TIP]
> One command installs every skill in this repo into all the agents it detects.

${FENCE}bash
# every skill in this repo
npx skills add ${ref}

# a single skill
npx skills add ${ref} --skill ${first}
${FENCE}
${pluginSection}
<details>
<summary><b>Manual copy</b></summary>

${FENCE}bash
git clone https://github.com/${ref}.git
cp -r ${base}/skills/${first} ~/.claude/skills/
${FENCE}

| Agent | Personal | Project |
|---|---|---|
| Claude Code | \`~/.claude/skills/\` | \`.claude/skills/\` |
| Codex CLI | \`~/.codex/skills/\` | \`.agents/skills/\` |
| Others | see the tool's docs | see the tool's docs |

</details>

> [!IMPORTANT]
> Skills run with the full permissions of your agent. Read a skill before you install it. Directories and CLI flags change over time, so check each tool's current documentation.

## How it works

${FENCE}mermaid
flowchart LR
    A[npx skills add] --> B[Clone repo]
    B --> C[Find SKILL.md files]
    C --> D[Install for each agent]
    D --> E[Claude Code]
    D --> F[Codex]
    D --> G[Cursor]
    D --> H[Gemini CLI]
${FENCE}

## Repo layout

${FENCE}text
${tree}
${FENCE}

Each skill folder name equals the \`name\` in its \`SKILL.md\` frontmatter, as the Agent Skills standard requires.

## Contributing

1. Add or edit a skill under \`skills/<name>/SKILL.md\`.
2. Keep \`name\` (lowercase-hyphen, equal to the folder) and \`description\` in the frontmatter.
3. Never commit secrets; the publish script scans for them.
4. Open a pull request.
${END}`;
}

function readmeFooter() {
  return `<div align="center">

<sub>Generated with the <code>publish-skill</code> skill &nbsp;·&nbsp; <a href="#">Back to top ↑</a></sub>

</div>
`;
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

// Never delete the source: the skill may already live at its destination.
const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const real = (p) => norm(fs.existsSync(p) ? fs.realpathSync(p) : p);
const isInside = (child, parent) => {
  const r = path.relative(parent, child);
  return r !== '' && !r.startsWith('..') && !path.isAbsolute(r);
};
const srcReal = real(skillDir);
const destReal = real(dest);
const inPlace = srcReal === destReal;
if (!inPlace && (isInside(destReal, srcReal) || isInside(srcReal, destReal)))
  fail(`skill folder and destination overlap (${skillDir} vs ${dest}); nothing was written`);

if (inPlace) {
  say(`skill already lives at ${dest}; skipping copy`);
  for (const f of walk(skillDir))
    if (isSensitive(path.basename(f)))
      fail(`${path.relative(skillDir, f)} looks like a secrets file inside the repo; remove it first. Nothing was written`);
} else {
  if (exists && !args.force)
    fail(`skills/${fm.name} already exists in the repo; rerun with --force to replace it (files missing from the source are removed). Nothing was written`);
  say(`${exists ? 'replace' : 'copy'} ${skillDir} -> ${dest}`);
  if (!dry) {
    fs.mkdirSync(path.join(repo, 'skills'), { recursive: true });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(skillDir, dest, {
      recursive: true,
      filter: (src) => src === skillDir || !isSkipped(path.basename(src)),
    });
  }
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
const full = !fs.existsSync(readmePath) || !!args.fresh;
if (!full) {
  const cur = fs.readFileSync(readmePath, 'utf8');
  readme = cur.includes(START) && cur.includes(END)
    ? cur.replace(new RegExp(`${START}[\\s\\S]*?${END}`), () => block)
    : `${cur.trimEnd()}\n\n${block}\n`;
} else {
  const title = args.github ? args.github.split('/')[1] : repoName;
  const tagline = args.tagline || `Install ${skills.length === 1 ? skills[0].name : 'these agent skills'} with a single command`;
  const license = (args.license || 'MIT').toLowerCase();
  readme = `${readmeHeader({ title, ref: args.github || '<owner>/<repo>', license, count: skills.length })}${block}\n\n${readmeFooter()}`;
  say('write assets/banner.svg');
  if (!dry) {
    fs.mkdirSync(path.join(repo, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'assets', 'banner.svg'), bannerSvg({ title, tagline, count: skills.length }));
  }
}
say(`write README.md (${skills.length} skill${skills.length === 1 ? '' : 's'}${full ? ', full' : ', block only'})`);
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
