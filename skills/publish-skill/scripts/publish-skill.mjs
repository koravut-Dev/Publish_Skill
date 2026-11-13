#!/usr/bin/env node
// publish-skill: package skill folders into a git repo that installs via
// `npx skills add owner/repo`, by manual copy, as a zip, or as a Claude Code
// plugin marketplace. No dependencies (Node 18+).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---- cli -------------------------------------------------------------------
const COMMANDS = new Set(['publish', 'check', 'list', 'unpublish', 'pack', 'verify']);
const FLAGS = new Set([
  'dry-run', 'plugin', 'force', 'fresh', 'help', 'strict', 'ci', 'scaffold',
  'agents-md', 'interactive', 'json', 'yes', 'npx',
]);
const VALUES = new Set([
  'skill', 'skills-dir', 'repo', 'github', 'author', 'tagline', 'license',
  'bump', 'version', 'message', 'lang', 'name', 'out', 'format',
]);
const MULTI = new Set(['skill', 'name']);

const USAGE = `Usage: node publish-skill.mjs [command] [options]

Commands
  publish (default)  copy skills into a repo and regenerate README + metadata
  check              validate skills only (used by CI); writes nothing
  list               list the skills in a repo
  unpublish          remove a skill from a repo (needs --name and --yes)
  pack               build one zip per skill for distribution without git
  verify             clone the pushed GitHub repo and check what installs

Common options
  --repo <dir>        target repo folder (publish creates it if missing)
  --skill <dir>       skill folder containing SKILL.md; repeat for several
  --skills-dir <dir>  publish every skill folder found inside <dir>
  --github <o/r>      GitHub owner/repo (default: detected from git remote or README)
  --dry-run           show what would happen, write nothing
  --json              machine-readable output (check, list)

publish options
  --author <name>     author for LICENSE / plugin.json
  --tagline <text>    one-line tagline under the README title
  --license <id>      MIT (default), ISC, BSD-3-Clause, any SPDX id, or none
  --lang <l>          README language: en (default), th, or both
  --plugin            write .claude-plugin/ for the Claude Code marketplace
  --bump <kind>       patch | minor | major: bump the version, add CHANGELOG entry
  --version <x.y.z>   set an explicit version instead of bumping
  --message <text>    extra line for the CHANGELOG entry
  --ci                write GitHub Actions: validate on PR, release on tag
  --scaffold          write .gitignore, .gitattributes, issue / PR templates
  --agents-md         write AGENTS.md (contributor guide for coding agents)
  --force             replace a skill that already exists with different content
  --fresh             regenerate whole README, banner and scaffolded files
  --interactive       ask for missing values (default when run in a terminal)

check options
  --strict            treat warnings as errors

unpublish options
  --name <skill>      skill to remove; repeat for several
  --yes               required to actually delete

pack options
  --name <skill>      only this skill (default: all); repeat for several
  --out <dir>         output folder (default: <repo>/dist)
  --format <f>        zip (default) or skill (same archive, .skill extension)

verify options
  --npx               also run \`npx skills add <o/r> --list\` (downloads the CLI)

A line containing "publish-skill:allow" is skipped by the secret scan.`;

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { command: 'publish' };
  let i = 0;
  if (argv[0] && !argv[0].startsWith('--')) {
    if (!COMMANDS.has(argv[0])) fail(`Unknown command "${argv[0]}". Run with --help`);
    out.command = argv[0];
    i = 1;
  }
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) fail(`Unexpected argument: ${a}`);
    const key = a.slice(2);
    if (FLAGS.has(key)) out[key] = true;
    else if (VALUES.has(key)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) fail(`Missing value for --${key}`);
      if (MULTI.has(key)) (out[key] ||= []).push(v);
      else out[key] = v;
    } else fail(`Unknown option --${key}. Run with --help`);
  }
  return out;
}

// ---- frontmatter -----------------------------------------------------------
function parseFrontmatter(text) {
  const m = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
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
  return { data, lines: m[0].split(/\r?\n/).length };
}

// ---- validation ------------------------------------------------------------
const ALLOW = 'publish-skill:allow';
const PLACEHOLDER = /^(your|my|xxx+|example|sample|dummy|test|changeme|change_me|placeholder|redacted|\*+|\.{3,}|<|\$\{|\{\{|%)/i;
const SECRET_PATTERNS = [
  { re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, label: 'AWS access key id' },
  { re: /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}\b/i, label: 'AWS secret access key' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{36,}/, label: 'GitHub token' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{60,}/, label: 'GitHub fine-grained token' },
  { re: /\bglpat-[A-Za-z0-9_-]{20,}/, label: 'GitLab token' },
  { re: /\bxox[abeprs]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
  { re: /hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]+/, label: 'Slack webhook URL' },
  { re: /discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/, label: 'Discord webhook URL' },
  { re: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}/, label: 'Anthropic API key' },
  { re: /(?<![A-Za-z0-9_-])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/, label: 'API key (sk-...)', ok: (m) => /\d/.test(m[0]) && /[A-Z]/.test(m[0]) },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, label: 'Google API key' },
  { re: /\b[sr]k_live_[0-9A-Za-z]{20,}/, label: 'Stripe live key' },
  { re: /\bnpm_[A-Za-z0-9]{36}\b/, label: 'npm token' },
  { re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/, label: 'SendGrid key' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, label: 'JSON Web Token' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key' },
  {
    re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver):\/\/[^\s:/@'"]+:([^\s@'"]+)@/i,
    label: 'connection string with a password',
    ok: (m) => !PLACEHOLDER.test(m[1]) && !/^(pass(word)?|pwd|secret)$/i.test(m[1]),
  },
  { re: /AccountKey=[A-Za-z0-9+/=]{40,}/, label: 'Azure storage account key' },
  {
    re: /(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*(['"])([^'"\s]{8,})\1/i,
    label: 'hard-coded credential',
    ok: (m) => !PLACEHOLDER.test(m[2]),
  },
];

const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', '.idea', '.vscode']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
// Files that usually hold secrets: never copied into the repo.
const isSensitive = (name) =>
  /^\.env(\..*)?$/i.test(name) ||
  /\.(pem|key|p12|pfx|jks|keystore|kdbx)$/i.test(name) ||
  /^id_(rsa|dsa|ecdsa|ed25519)$/.test(name) ||
  /^(\.npmrc|\.pypirc|\.netrc|\.htpasswd|credentials|credentials\.json|token\.json|secrets?\.(json|ya?ml|toml))$/i.test(name) ||
  /^service[-_]?account.*\.json$/i.test(name);

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const STANDARD_FIELDS = new Set(['name', 'description', 'license', 'metadata', 'compatibility', 'allowed-tools']);
const TOOL_HINTS = [
  [/\b(AskUserQuestion|TodoWrite|ExitPlanMode|NotebookEdit|WebFetch|WebSearch)\b/, 'a Claude Code tool name'],
  [/\bmcp__[A-Za-z0-9_-]+/, 'an MCP tool name'],
  [/\bsubagent_type\b/, 'a Claude Code subagent parameter'],
  [/\$ARGUMENTS\b/, 'the Claude Code $ARGUMENTS placeholder'],
  [/\bapply_patch\b/, 'a Codex tool name'],
];
const TRIGGER_CUE = /(use (this )?(skill )?when|use for|when the user|when asked|trigger|ใช้เมื่อ|ใช้สำหรับ|เมื่อผู้ใช้)/i;

const posix = (p) => p.split(path.sep).join('/');

function* walk(dir, base = dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || SKIP_FILES.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    const rel = posix(path.relative(base, abs));
    if (e.isSymbolicLink()) yield { abs, rel, name: e.name, symlink: true };
    else if (e.isDirectory()) yield* walk(abs, base);
    else if (e.isFile()) yield { abs, rel, name: e.name };
  }
}

// Blank out fenced code blocks but keep line numbers.
function stripFences(lines) {
  let open = false;
  return lines.map((ln) => {
    if (/^\s*(```|~~~)/.test(ln)) { open = !open; return ''; }
    return open ? '' : ln;
  });
}

function checkLinks(lines, fileDir, skillDir, add) {
  stripFences(lines).forEach((ln, i) => {
    for (const m of ln.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      let target = m[1];
      if (/^(https?:|mailto:|tel:|#|\/)/i.test(target) || /[<>{}$]/.test(target)) continue;
      target = target.replace(/[#?].*$/, '');
      if (!target) continue;
      try { target = decodeURIComponent(target); } catch { /* keep raw */ }
      const abs = path.resolve(fileDir, target);
      const inside = !path.relative(skillDir, abs).startsWith('..');
      if (!inside) add(`link "${m[1]}" points outside the skill folder; it will break after install`, i + 1);
      else if (!fs.existsSync(abs)) add(`link "${m[1]}" points to a file that does not exist`, i + 1);
    }
  });
}

// Returns { name, fm, errors, warnings, files }. Each finding is { msg, rel, line }.
// inRepo: the skill already lives in the repo, so sensitive files are errors
// (they would be committed) rather than "skipped" warnings.
function validateSkill(skillDir, { inRepo = false } = {}) {
  const errors = [];
  const warnings = [];
  const err = (msg, rel, line) => errors.push({ msg, rel, line });
  const warn = (msg, rel, line) => warnings.push({ msg, rel, line });
  const folder = path.basename(path.resolve(skillDir));
  const result = { name: folder, fm: {}, errors, warnings, files: [] };

  const file = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(file)) { err(`no SKILL.md in ${skillDir}`); return result; }
  const skillText = fs.readFileSync(file, 'utf8');
  const parsed = parseFrontmatter(skillText);
  if (!parsed) { err('SKILL.md has no YAML frontmatter (--- ... ---)', 'SKILL.md', 1); return result; }
  const fm = (result.fm = parsed.data);

  // --- frontmatter
  const { name, description } = fm;
  if (!name) err('frontmatter `name` is missing', 'SKILL.md', 1);
  else {
    result.name = name;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))
      err(`name "${name}" must be lowercase letters/digits separated by single hyphens`, 'SKILL.md', 1);
    if (name.length > 64) err('name is longer than 64 characters', 'SKILL.md', 1);
    if (name !== folder) err(`folder name "${folder}" must equal name "${name}"`, 'SKILL.md', 1);
    if (/(anthropic|claude)/.test(name))
      warn(`name "${name}" contains a reserved word (anthropic / claude); some hosts reject it`, 'SKILL.md', 1);
  }
  if (!description) err('frontmatter `description` is missing', 'SKILL.md', 1);
  else {
    if (description.length > 1024) err(`description is ${description.length} characters (limit 1024)`, 'SKILL.md', 1);
    if (description.length < 40)
      warn('description is very short; say what the skill does and when to use it', 'SKILL.md', 1);
    if (!TRIGGER_CUE.test(description))
      warn('description has no "use when ..." cue; agents may not know when to load the skill', 'SKILL.md', 1);
    if (/<[A-Za-z/][^>]*>/.test(description))
      warn('description contains an XML/HTML-like tag; some hosts reject it', 'SKILL.md', 1);
    if (/^\s*(I|We)\s+(can|will|help)\b/.test(description))
      warn('description is written in first person; third person triggers more reliably', 'SKILL.md', 1);
  }
  for (const k of Object.keys(fm)) {
    if (k === 'allowed-tools')
      warn('frontmatter `allowed-tools` is experimental; agents other than Claude Code may ignore it', 'SKILL.md', 1);
    else if (!STANDARD_FIELDS.has(k))
      warn(`non-standard frontmatter field "${k}" may be ignored by other agents`, 'SKILL.md', 1);
  }

  // --- body
  const skillLines = skillText.split(/\r?\n/);
  const body = skillLines.slice(parsed.lines).join('\n').trim();
  if (!body) warn('SKILL.md has no instructions after the frontmatter', 'SKILL.md', parsed.lines);
  if (skillLines.length > 500)
    warn(`SKILL.md is ${skillLines.length} lines; move detail into reference files (aim for under 500)`, 'SKILL.md', 1);
  for (const [re, what] of TOOL_HINTS) {
    const i = skillLines.findIndex((ln, n) => n >= parsed.lines && !ln.includes(ALLOW) && re.test(ln));
    if (i >= 0) warn(`mentions ${what}; other agents may not have it`, 'SKILL.md', i + 1);
  }
  stripFences(skillLines).forEach((ln, i) => {
    for (const m of ln.matchAll(/`((?:scripts|references|assets)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)`/g))
      if (!fs.existsSync(path.join(skillDir, m[1])))
        warn(`mentions \`${m[1]}\` but that file does not exist`, 'SKILL.md', i + 1);
  });

  // --- files
  const seen = new Map();
  for (const f of walk(skillDir)) {
    if (f.symlink) { warn('symlink: NOT copied (it may point outside the skill)', f.rel); continue; }
    if (isSensitive(f.name)) {
      if (inRepo) err('looks like a secrets file inside the repo; remove it', f.rel);
      else warn('looks like a secrets file and will NOT be copied', f.rel);
      continue;
    }
    for (const seg of f.rel.split('/')) {
      if (/[<>:"|?*\\]/.test(seg) || WIN_RESERVED.test(seg) || /[. ]$/.test(seg)) {
        warn('file name is not valid on Windows; installs there will fail', f.rel);
        break;
      }
    }
    const lower = f.rel.toLowerCase();
    if (seen.has(lower)) warn(`differs only by letter case from ${seen.get(lower)}; they collide on Windows/macOS`, f.rel);
    else seen.set(lower, f.rel);
    result.files.push(f);

    if (fs.statSync(f.abs).size > 1_000_000) { warn('larger than 1 MB: not scanned for secrets', f.rel); continue; }
    let text;
    try { text = fs.readFileSync(f.abs, 'utf8'); } catch { warn('could not be read: not scanned for secrets', f.rel); continue; }
    if (text.includes('\u0000')) { warn('binary: not scanned for secrets', f.rel); continue; }

    const lines = text.split(/\r?\n/);
    lines.forEach((ln, i) => {
      if (ln.includes(ALLOW)) return;
      for (const p of SECRET_PATTERNS) {
        const m = p.re.exec(ln);
        if (m && (!p.ok || p.ok(m))) { err(`possible ${p.label}`, f.rel, i + 1); break; }
      }
    });
    if ((/\.(sh|bash)$/i.test(f.name) || /^#!.*\b(ba)?sh\b/.test(lines[0])) && text.includes('\r\n'))
      warn('shell script has CRLF line endings; it will fail on macOS/Linux', f.rel);
    if (/\.(md|mdx)$/i.test(f.name)) checkLinks(lines, path.dirname(f.abs), skillDir, (msg, line) => warn(msg, f.rel, line));
  }
  return result;
}

// Print findings; returns true when publishing may continue.
function report(results, { strict = false, baseDir = process.cwd() } = {}) {
  const gha = !!process.env.GITHUB_ACTIONS;
  let nErr = 0;
  let nWarn = 0;
  for (const r of results) {
    const emit = (level, f) => {
      const where = f.rel ? `${f.rel}${f.line ? `:${f.line}` : ''}: ` : '';
      console.error(`${level}: [${r.name}] ${where}${f.msg}`);
      if (gha) {
        const file = f.rel ? posix(path.relative(baseDir, path.join(r.dir, f.rel))) : '';
        const props = [file && `file=${file}`, f.line && `line=${f.line}`].filter(Boolean).join(',');
        console.log(`::${level}${props ? ` ${props}` : ''}::[${r.name}] ${f.msg}`);
      }
    };
    r.warnings.forEach((f) => { nWarn++; emit('warning', f); });
    r.errors.forEach((f) => { nErr++; emit('error', f); });
  }
  return { ok: nErr === 0 && (!strict || nWarn === 0), nErr, nWarn };
}

// ---- small helpers ---------------------------------------------------------
const hashFile = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const real = (p) => norm(fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p));
const isInside = (child, parent) => {
  const r = path.relative(parent, child);
  return r !== '' && !r.startsWith('..') && !path.isAbsolute(r);
};

function run(cmd, cmdArgs, opts = {}) {
  return spawnSync(cmd, cmdArgs, { encoding: 'utf8', shell: process.platform === 'win32' && cmd === 'npx', ...opts });
}

// owner/repo from the git remote, else from install commands in an existing README.
function detectGithub(repo) {
  if (fs.existsSync(path.join(repo, '.git'))) {
    const r = run('git', ['-C', repo, 'config', '--get', 'remote.origin.url']);
    const m = r.status === 0 && r.stdout.trim().match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
    if (m) return `${m[1]}/${m[2]}`;
  }
  const readme = path.join(repo, 'README.md');
  const m = fs.existsSync(readme) && fs.readFileSync(readme, 'utf8').match(/npx skills add ([\w.-]+\/[\w.-]+)/);
  return m ? m[1] : null;
}

function listSkills(repo) {
  const root = path.join(repo, 'skills');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'SKILL.md')))
    .map((e) => {
      const fm = parseFrontmatter(fs.readFileSync(path.join(root, e.name, 'SKILL.md'), 'utf8'))?.data || {};
      return { name: e.name, description: fm.description || '', dir: path.join(root, e.name) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function diffSkill(files, dest) {
  const src = new Map(files.map((f) => [f.rel, hashFile(f.abs)]));
  const dst = new Map();
  if (fs.existsSync(dest)) for (const f of walk(dest)) if (!f.symlink) dst.set(f.rel, hashFile(f.abs));
  const added = [...src.keys()].filter((k) => !dst.has(k));
  const changed = [...src.keys()].filter((k) => dst.has(k) && dst.get(k) !== src.get(k));
  const removed = [...dst.keys()].filter((k) => !src.has(k));
  return { added, changed, removed, same: !added.length && !changed.length && !removed.length };
}

// Copy exactly the files that were validated, via a temp folder so a failed
// copy never leaves a half-written skill behind.
function copySkill(files, dest) {
  const tmp = `${dest}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of files) {
    const to = path.join(tmp, f.rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(f.abs, to);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  try { fs.renameSync(tmp, dest); } catch {
    fs.cpSync(tmp, dest, { recursive: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- zip (store + deflate, no dependencies) --------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// entries: [{ name, data: Buffer, exec: boolean }]. Fixed timestamp => reproducible archives.
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const comp = zlib.deflateRawSync(e.data, { level: 9 });
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made on unix, so the mode below is honoured
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((e.exec ? 0o100755 : 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, comp);
    centrals.push(central, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---- versions --------------------------------------------------------------
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
function bumpVersion(v, kind) {
  const m = (v || '0.0.0').match(SEMVER);
  if (!m) fail(`current version "${v}" is not x.y.z; pass --version instead of --bump`);
  let [maj, min, pat] = m.slice(1).map(Number);
  if (kind === 'major') { maj++; min = 0; pat = 0; }
  else if (kind === 'minor') { min++; pat = 0; }
  else if (kind === 'patch') pat++;
  else fail('--bump must be patch, minor or major');
  return `${maj}.${min}.${pat}`;
}
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function currentVersion(repo) {
  const pj = readJson(path.join(repo, '.claude-plugin', 'plugin.json'));
  if (pj?.version) return pj.version;
  const cl = path.join(repo, 'CHANGELOG.md');
  const m = fs.existsSync(cl) && fs.readFileSync(cl, 'utf8').match(/^## \[(\d+\.\d+\.\d+)\]/m);
  return m ? m[1] : null;
}
function changelogEntry(version, changes, message) {
  const date = new Date().toISOString().slice(0, 10);
  const sec = (title, items) => (items.length ? `### ${title}\n${items.map((n) => `- \`${n}\` skill`).join('\n')}\n\n` : '');
  let body = sec('Added', changes.added) + sec('Changed', changes.changed) + sec('Removed', changes.removed);
  if (message) body += `### Notes\n- ${message}\n\n`;
  if (!body) body = '- Maintenance release\n\n';
  return `## [${version}] - ${date}\n\n${body}`;
}
function updateChangelog(cur, entry) {
  if (!cur) return `# Changelog\n\nAll notable changes to the skills in this repo. Versions follow [semver](https://semver.org).\n\n${entry}`;
  const i = cur.search(/^## \[/m);
  return i >= 0 ? `${cur.slice(0, i)}${entry}${cur.slice(i)}` : `${cur.trimEnd()}\n\n${entry}`;
}

// ---- generators ------------------------------------------------------------
const START = '<!-- skills:start -->';
const END = '<!-- skills:end -->';
const FENCE = '```';
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const html = xml;

const AGENT_DIRS = [
  ['Claude Code', '~/.claude/skills/', '.claude/skills/'],
  ['Codex CLI', '~/.codex/skills/', '.agents/skills/'],
  ['Cursor', '~/.cursor/skills/', '.cursor/skills/'],
  ['Gemini CLI', '~/.gemini/skills/', '.gemini/skills/'],
  ['GitHub Copilot', '~/.copilot/skills/', '.github/skills/'],
  ['OpenCode', '~/.config/opencode/skills/', '.opencode/skills/'],
];

const STRINGS = {
  en: {
    skills: 'Skills', install: 'Install', how: 'How it works', layout: 'Repo layout', contrib: 'Contributing',
    navLayout: 'Layout', navContrib: 'Contribute',
    tip: 'One command installs every skill in this repo into all the agents it detects.',
    every: 'every skill in this repo', single: 'a single skill',
    market: 'Claude Code plugin marketplace', manual: 'Manual copy', zip: 'Download a zip',
    zipText: (ref) => `Every [release](https://github.com/${ref}/releases) attaches one zip per skill. Unzip it into your agent's skills directory.`,
    agent: 'Agent', personal: 'Personal', project: 'Project', others: 'Others', docs: "see the tool's docs",
    important: 'Skills run with the full permissions of your agent. Read a skill before you install it. Directories and CLI flags change over time, so check each tool\'s current documentation.',
    folderRule: 'Each skill folder name equals the `name` in its `SKILL.md` frontmatter, as the Agent Skills standard requires.',
    steps: [
      'Add or edit a skill under `skills/<name>/SKILL.md`.',
      'Keep `name` (lowercase-hyphen, equal to the folder) and `description` in the frontmatter.',
      'Never commit secrets; the publish script scans for them.',
      'Open a pull request.',
    ],
    tryIt: 'Try',
    footer: 'Generated with the <code>publish-skill</code> skill', top: 'Back to top ↑',
    tagline: (skills) => `Install ${skills.length === 1 ? skills[0].name : 'these agent skills'} with a single command`,
  },
  th: {
    skills: 'สกิล', install: 'ติดตั้ง', how: 'ทำงานอย่างไร', layout: 'โครงสร้าง repo', contrib: 'ร่วมพัฒนา',
    navLayout: 'โครงสร้าง', navContrib: 'ร่วมพัฒนา',
    tip: 'คำสั่งเดียวติดตั้งทุกสกิลใน repo นี้ให้ทุก agent ที่ตรวจพบในเครื่อง',
    every: 'ทุกสกิลใน repo นี้', single: 'เฉพาะสกิลเดียว',
    market: 'Claude Code plugin marketplace', manual: 'คัดลอกเอง', zip: 'ดาวน์โหลดเป็น zip',
    zipText: (ref) => `ทุก [release](https://github.com/${ref}/releases) แนบไฟล์ zip แยกตามสกิล แตกไฟล์ลงในโฟลเดอร์ skills ของ agent ที่ใช้`,
    agent: 'Agent', personal: 'ส่วนตัว', project: 'ในโปรเจกต์', others: 'อื่นๆ', docs: 'ดูเอกสารของเครื่องมือ',
    important: 'สกิลทำงานด้วยสิทธิ์เต็มของ agent อ่านสกิลก่อนติดตั้งทุกครั้ง ตำแหน่งโฟลเดอร์และ flag ของ CLI เปลี่ยนได้ตามเวลา ให้ตรวจกับเอกสารล่าสุดของแต่ละเครื่องมือ',
    folderRule: 'ชื่อโฟลเดอร์ของแต่ละสกิลต้องตรงกับ `name` ใน frontmatter ของ `SKILL.md` ตามมาตรฐาน Agent Skills',
    steps: [
      'เพิ่มหรือแก้สกิลใต้ `skills/<name>/SKILL.md`',
      'ต้องมี `name` (ตัวพิมพ์เล็กคั่นด้วยขีด และตรงกับชื่อโฟลเดอร์) กับ `description` ใน frontmatter',
      'ห้าม commit secret สคริปต์ publish จะสแกนหาให้',
      'เปิด pull request',
    ],
    tryIt: 'ลองพิมพ์',
    footer: 'สร้างด้วยสกิล <code>publish-skill</code>', top: 'กลับขึ้นบน ↑',
    tagline: (skills) => `ติดตั้ง${skills.length === 1 ? ` ${skills[0].name} ` : 'สกิลชุดนี้'}ได้ด้วยคำสั่งเดียว`,
  },
};

function shortDesc(d) {
  let t = d.replace(/\s+/g, ' ').trim();
  const cut = t.search(/\s(ใช้เมื่อ|Use when|Use this when|Trigger)/i);
  if (cut > 20) t = t.slice(0, cut).trim();
  if (t.length > 180) t = t.slice(0, 177).trimEnd() + '...';
  return t;
}

// Quoted phrases in a description are usually trigger examples.
function examples(d) {
  const out = [];
  for (const m of d.matchAll(/["“]([^"“”]{2,40})["”]/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out.slice(0, 4);
}

// Self-contained animated banner. Dark by default, switches with prefers-color-scheme.
function bannerSvg({ title, tagline, count }) {
  const size = Math.max(40, Math.min(88, Math.floor(1000 / (Math.max(title.length, 6) * 0.6))));
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
    .title{font:800 ${size}px 'Segoe UI',system-ui,-apple-system,'Noto Sans Thai',sans-serif;letter-spacing:-2px}
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

function readmeHeader({ title, ref, license, count, lang, both, feat }) {
  const t = STRINGS[lang];
  const realRef = !ref.includes('<');
  const badge = (alt, src, href) => {
    const img = `<img alt="${alt}" src="${src}">`;
    return `${href ? `<a href="${href}">${img}</a>` : img}\n`;
  };
  const S = 'style=for-the-badge&labelColor=0a0a1f';
  let badges = badge('Agent Skills', `https://img.shields.io/badge/AGENT%20SKILLS-COMPATIBLE-a855f7?${S}`);
  if (license !== 'none')
    badges += badge('License', `https://img.shields.io/badge/LICENSE-${encodeURIComponent(license.toUpperCase()).replace(/-/g, '--')}-22d3ee?${S}`);
  badges += badge('Skills', `https://img.shields.io/badge/SKILLS-${count}-f472b6?${S}`);
  badges += badge('Dependencies', `https://img.shields.io/badge/DEPENDENCIES-0-34d399?${S}`);
  if (realRef) {
    badges += badge('Version', `https://img.shields.io/github/v/tag/${ref}?${S}&label=VERSION&color=22d3ee`, `https://github.com/${ref}/tags`);
    if (feat.ci)
      badges += badge('Checks', `https://img.shields.io/github/actions/workflow/status/${ref}/validate-skills.yml?${S}&label=CHECKS`, `https://github.com/${ref}/actions`);
    badges += badge('Stars', `https://img.shields.io/github/stars/${ref}?${S}&logo=github&color=a855f7`, `https://github.com/${ref}`);
  }
  const switcher = both
    ? `${lang === 'en' ? '**English** &nbsp;·&nbsp; [ไทย](README.th.md)' : '[English](README.md) &nbsp;·&nbsp; **ไทย**'}\n\n`
    : '';
  return `<div align="center">

<img src="assets/banner.svg" alt="${html(title)}" width="100%">

<br><br>

${badges}
<br>

${switcher}**[${t.skills}](#skills)** &nbsp;·&nbsp; **[${t.install}](#install)** &nbsp;·&nbsp; **[${t.how}](#how-it-works)** &nbsp;·&nbsp; **[${t.navLayout}](#repo-layout)** &nbsp;·&nbsp; **[${t.navContrib}](#contributing)**

<br>

${FENCE}bash
npx skills add ${ref}
${FENCE}

</div>

`;
}

function readmeBlock({ skills, ref, base, lang, feat }) {
  const t = STRINGS[lang];
  const first = skills[0]?.name || '<skill-name>';
  // Thai headings do not produce the #skills style anchors the nav links use.
  const h = (id, text) => (lang === 'en' ? `## ${text}` : `<a id="${id}"></a>\n\n## ${text}`);

  const cell = (s, attrs) => {
    const ex = examples(s.description);
    const tryLine = ex.length ? `<sub>${t.tryIt}: ${ex.map((e) => `<code>${html(e)}</code>`).join(' · ')}</sub>\n\n` : '';
    return `<td ${attrs} valign="top">\n\n#### ${s.name}\n\n${html(shortDesc(s.description))}\n\n${tryLine}${FENCE}bash\nnpx skills add ${ref} --skill ${s.name}\n${FENCE}\n\n</td>`;
  };
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
    ...(feat.th ? ['├── README.th.md'] : []),
    ...(feat.changelog ? ['├── CHANGELOG.md'] : []),
    ...(feat.agents ? ['├── AGENTS.md'] : []),
    ...(feat.license ? ['├── LICENSE'] : []),
    '├── assets/',
    '│   └── banner.svg',
    ...(feat.plugin ? ['├── .claude-plugin/', '│   ├── plugin.json', '│   └── marketplace.json'] : []),
    ...(feat.ci ? ['├── .github/', '│   └── workflows/'] : []),
    '└── skills/',
    ...skills.map((s, i) => `    ${i === skills.length - 1 ? '└──' : '├──'} ${s.name}/SKILL.md`),
  ].join('\n');

  const details = (title, body) => `<details>\n<summary><b>${title}</b></summary>\n\n${body}\n\n</details>\n`;
  const sections = [];
  if (feat.plugin) sections.push(details(t.market, `${FENCE}text\n/plugin marketplace add ${ref}\n${FENCE}`));
  if (feat.ci && !ref.includes('<')) sections.push(details(t.zip, t.zipText(ref)));
  sections.push(details(t.manual, `${FENCE}bash
git clone https://github.com/${ref}.git
cp -r ${base}/skills/${first} ~/.claude/skills/
${FENCE}

${FENCE}powershell
Copy-Item -Recurse ${base}\\skills\\${first} "$HOME\\.claude\\skills\\"
${FENCE}

| ${t.agent} | ${t.personal} | ${t.project} |
|---|---|---|
${AGENT_DIRS.map(([a, p, q]) => `| ${a} | \`${p}\` | \`${q}\` |`).join('\n')}
| ${t.others} | ${t.docs} | ${t.docs} |`));

  return `${START}
<!-- skills:lang=${lang} -->
${h('skills', t.skills)}

<table>
${rowsHtml.join('\n')}
</table>

${h('install', t.install)}

> [!TIP]
> ${t.tip}

${FENCE}bash
# ${t.every}
npx skills add ${ref}

# ${t.single}
npx skills add ${ref} --skill ${first}
${FENCE}

${sections.join('\n')}
> [!IMPORTANT]
> ${t.important}

${h('how-it-works', t.how)}

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

${h('repo-layout', t.layout)}

${FENCE}text
${tree}
${FENCE}

${t.folderRule}

${h('contributing', t.contrib)}

${t.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
${END}`;
}

function readmeFooter(lang) {
  const t = STRINGS[lang];
  return `<div align="center">

<sub>${t.footer} &nbsp;·&nbsp; <a href="#">${t.top}</a></sub>

</div>
`;
}

const LICENSES = {
  mit: (year, author) => `MIT License

Copyright (c) ${year} ${author}

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
`,
  isc: (year, author) => `ISC License

Copyright (c) ${year} ${author}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
`,
  'bsd-3-clause': (year, author) => `BSD 3-Clause License

Copyright (c) ${year}, ${author}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`,
};

// Built-in texts for the short licenses; anything else comes from the SPDX list.
async function licenseText(id, author) {
  const builtin = LICENSES[id.toLowerCase()];
  if (builtin) return builtin(new Date().getFullYear(), author || '<author>');
  if (!/^[A-Za-z0-9.+-]+$/.test(id)) fail(`--license "${id}" is not a valid SPDX id`);
  try {
    const res = await fetch(`https://raw.githubusercontent.com/spdx/license-list-data/main/text/${id}.txt`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    console.error(`warning: could not download the ${id} license text (${e.message}). Add LICENSE yourself; SPDX ids are case-sensitive (e.g. Apache-2.0).`);
    return null;
  }
}

function workflowValidate(script) {
  return `name: Validate skills

on:
  pull_request:
  push:
    branches: [main, master]

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Lint skills and scan for secrets
        run: node ${script} check --repo .
`;
}

function workflowRelease(script) {
  return `name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Lint skills and scan for secrets
        run: node ${script} check --repo .
      - name: Build one zip per skill
        run: node ${script} pack --repo . --out dist
      - name: Create GitHub release
        env:
          GH_TOKEN: \${{ github.token }}
        run: gh release create "$GITHUB_REF_NAME" dist/*.zip --title "$GITHUB_REF_NAME" --generate-notes
`;
}

const GITIGNORE = `node_modules/
dist/
*.tmp-*

# never commit secrets
.env
.env.*
*.pem
*.key
*.p12
*.pfx
credentials.json
token.json

# OS / editor noise
.DS_Store
Thumbs.db
desktop.ini
.idea/
.vscode/
`;

const GITATTRIBUTES = `# Keep LF everywhere so scripts run on macOS/Linux even when edited on Windows.
* text=auto eol=lf
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.pdf binary
*.zip binary
*.skill binary
`;

const PR_TEMPLATE = `## What changed

<!-- Which skill, and what it now does differently. -->

## Checklist

- [ ] Folder name equals \`name\` in the SKILL.md frontmatter
- [ ] \`description\` says what the skill does and when to use it
- [ ] No secrets, tokens or private URLs in any file
- [ ] Tested the skill in at least one agent
`;

const ISSUE_BUG = `---
name: Skill bug
about: A skill does the wrong thing or fails to trigger
labels: bug
---

**Skill**

**Agent and version** (Claude Code, Codex, Cursor, ...)

**What you asked**

**What happened**

**What you expected**
`;

const ISSUE_REQUEST = `---
name: Skill request
about: Suggest a new skill or an improvement
labels: enhancement
---

**What should the skill do?**

**When should it trigger?** (example phrases)

**Anything it must never do?**
`;

function agentsMd(base) {
  return `# AGENTS.md

Guide for coding agents working in this repo.

## What this repo is

A collection of Agent Skills. Each skill is a folder under \`skills/\` with a
\`SKILL.md\` (YAML frontmatter with \`name\` and \`description\`, then instructions).

## Rules

- The folder name must equal the frontmatter \`name\` (lowercase, hyphens).
- \`description\` states what the skill does and when to use it, in third person.
- Keep \`SKILL.md\` under 500 lines; put detail in \`references/\` and code in \`scripts/\`.
- Never add secrets. \`.env*\`, key files and credential files must stay out of the repo.
- Do not hand-edit the README between \`<!-- skills:start -->\` and
  \`<!-- skills:end -->\`; it is generated.
- Do not push, tag or change repo visibility without the owner's explicit yes.

## Layout

\`\`\`text
${base}/
├── README.md        generated skill list and install commands
├── CHANGELOG.md     one entry per released version
├── skills/<name>/   one folder per skill
└── .github/         CI: validates every pull request
\`\`\`
`;
}

// ---- repo refresh (README, metadata, extras) -------------------------------
// ctx: { repo, args, dry, say, skills, changes, github }
async function refreshRepo(ctx) {
  const { repo, args, dry, say, skills, changes } = ctx;
  const has = (rel) => fs.existsSync(path.join(repo, rel));
  const write = (rel, content, { ifMissing = false } = {}) => {
    if (ifMissing && has(rel) && !args.fresh) { say(`keep  ${rel} (exists; --fresh overwrites)`); return false; }
    say(`write ${rel}`);
    if (!dry) {
      const p = path.join(repo, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
    return true;
  };

  const repoName = path.basename(repo);
  const ref = ctx.github || '<owner>/<repo>';
  const base = ctx.github ? ctx.github.split('/')[1] : repoName;

  // --- version + changelog
  const before = currentVersion(repo);
  let version = before || '1.0.0';
  if (args.version) {
    if (!SEMVER.test(args.version)) fail('--version must look like 1.2.3');
    version = args.version;
  } else if (args.bump) version = before ? bumpVersion(before, args.bump) : '1.0.0';
  const released = !!(args.version || args.bump);
  if (released) {
    const cur = has('CHANGELOG.md') ? fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8') : '';
    if (cur.includes(`## [${version}]`)) fail(`CHANGELOG.md already has an entry for ${version}; pick another version`);
    say(`version ${before || '(none)'} -> ${version}`);
    write('CHANGELOG.md', updateChangelog(cur, changelogEntry(version, changes, args.message)));
  }

  // --- license
  const license = args.license || 'MIT';
  let licenseOn = has('LICENSE');
  if (license.toLowerCase() !== 'none' && !licenseOn) {
    if (dry) { say(`write LICENSE (${license})`); licenseOn = true; }
    else {
      const text = await licenseText(license, args.author);
      if (text) { write('LICENSE', text); licenseOn = true; }
    }
  }

  // --- what the repo contains, for the README tree and optional sections
  const pluginOn = !!args.plugin || has('.claude-plugin/plugin.json');
  const prevLang = has('README.md') && fs.readFileSync(path.join(repo, 'README.md'), 'utf8').match(/<!-- skills:lang=(\w+) -->/)?.[1];
  let lang = args.lang || (has('README.th.md') ? 'both' : prevLang) || 'en';
  if (!['en', 'th', 'both'].includes(lang)) fail('--lang must be en, th or both');
  const feat = {
    plugin: pluginOn,
    ci: !!args.ci || has('.github/workflows/validate-skills.yml'),
    changelog: released || has('CHANGELOG.md'),
    agents: !!args['agents-md'] || has('AGENTS.md'),
    license: licenseOn,
    th: lang === 'both',
  };

  // --- README(s)
  const targets = lang === 'both' ? [['README.md', 'en'], ['README.th.md', 'th']] : [['README.md', lang]];
  const title = base;
  let bannerDone = false;
  for (const [file, l] of targets) {
    const block = readmeBlock({ skills, ref, base, lang: l, feat });
    const full = !has(file) || !!args.fresh;
    let readme;
    if (full) {
      const tagline = args.tagline || STRINGS[l].tagline(skills);
      readme = `${readmeHeader({ title, ref, license, count: skills.length, lang: l, both: lang === 'both', feat })}${block}\n\n${readmeFooter(l)}`;
      if (!bannerDone) {
        write('assets/banner.svg', bannerSvg({ title, tagline: args.tagline || STRINGS.en.tagline(skills), count: skills.length }));
        bannerDone = true;
      }
    } else {
      const cur = fs.readFileSync(path.join(repo, file), 'utf8');
      readme = cur.includes(START) && cur.includes(END)
        ? cur.replace(new RegExp(`${START}[\\s\\S]*?${END}`), () => block)
        : `${cur.trimEnd()}\n\n${block}\n`;
    }
    say(`write ${file} (${skills.length} skill${skills.length === 1 ? '' : 's'}, ${l}, ${full ? 'full' : 'skills block only'})`);
    if (!dry) fs.writeFileSync(path.join(repo, file), readme);
  }

  // --- Claude Code plugin metadata (merged, so hand-added fields survive)
  if (pluginOn) {
    const description = `Agent skills: ${skills.map((s) => s.name).join(', ')}`;
    const pj = readJson(path.join(repo, '.claude-plugin', 'plugin.json')) || {};
    const plugin = { ...pj, name: pj.name || base, description, version };
    if (args.author) plugin.author = { ...(pj.author || {}), name: args.author };
    const mj = readJson(path.join(repo, '.claude-plugin', 'marketplace.json')) || {};
    const owner = mj.owner || { name: args.author || (ctx.github ? ctx.github.split('/')[0] : base) };
    const entry = { ...(mj.plugins?.[0] || {}), name: plugin.name, source: mj.plugins?.[0]?.source || './', description };
    const market = { ...mj, name: mj.name || plugin.name, owner, plugins: [entry, ...(mj.plugins || []).slice(1)] };
    write('.claude-plugin/plugin.json', JSON.stringify(plugin, null, 2) + '\n');
    write('.claude-plugin/marketplace.json', JSON.stringify(market, null, 2) + '\n');
  }

  // --- CI
  if (args.ci) {
    const own = 'skills/publish-skill/scripts/publish-skill.mjs';
    let script = own;
    if (!skills.some((s) => s.name === 'publish-skill') || (!dry && !has(own))) {
      script = '.github/scripts/publish-skill.mjs';
      write(script, fs.readFileSync(fileURLToPath(import.meta.url)));
    }
    write('.github/workflows/validate-skills.yml', workflowValidate(script), { ifMissing: true });
    write('.github/workflows/release.yml', workflowRelease(script), { ifMissing: true });
  }

  // --- scaffolding
  if (args.scaffold) {
    write('.gitignore', GITIGNORE, { ifMissing: true });
    write('.gitattributes', GITATTRIBUTES, { ifMissing: true });
    write('.github/PULL_REQUEST_TEMPLATE.md', PR_TEMPLATE, { ifMissing: true });
    write('.github/ISSUE_TEMPLATE/skill-bug.md', ISSUE_BUG, { ifMissing: true });
    write('.github/ISSUE_TEMPLATE/skill-request.md', ISSUE_REQUEST, { ifMissing: true });
  }
  if (args['agents-md']) write('AGENTS.md', agentsMd(base), { ifMissing: true });

  return { version, released, ref, pluginOn };
}

// ---- interactive -----------------------------------------------------------
async function askMissing(args) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Queue lines ourselves so piped answers (several lines at once) are not lost.
  const lines = [];
  const waiting = [];
  let closed = false;
  rl.on('line', (ln) => (waiting.length ? waiting.shift()(ln) : lines.push(ln)));
  rl.on('close', () => { closed = true; waiting.splice(0).forEach((w) => w('')); });
  const nextLine = () => (lines.length ? Promise.resolve(lines.shift()) : closed ? Promise.resolve('') : new Promise((r) => waiting.push(r)));
  const ask = async (q, def) => {
    process.stdout.write(`${q}${def ? ` [${def}]` : ''}: `);
    return (await nextLine()).trim() || def || '';
  };
  const yes = async (q, def = false) => /^y/i.test(await ask(`${q} (y/n)`, def ? 'y' : 'n'));
  try {
    if (!args.skill && !args['skills-dir']) {
      const s = await ask('Skill folder(s), comma separated (blank = only refresh the repo)');
      if (s) args.skill = s.split(',').map((x) => x.trim()).filter(Boolean);
    }
    if (!args.repo) args.repo = await ask('Target repo folder', '.');
    if (!args.github) {
      const g = await ask('GitHub owner/repo', detectGithub(path.resolve(args.repo)) || '');
      if (g) args.github = g;
    }
    if (!args.author) { const a = await ask('Author name (for LICENSE)'); if (a) args.author = a; }
    if (!args.license) args.license = await ask('License (MIT, ISC, BSD-3-Clause, Apache-2.0, none)', 'MIT');
    if (!args.lang) args.lang = await ask('README language (en, th, both)', 'en');
    if (!args.plugin) args.plugin = await yes('Add Claude Code plugin marketplace metadata?');
    if (!args.ci) args.ci = await yes('Add GitHub Actions (validate PRs, release on tag)?');
    if (!args.scaffold) args.scaffold = await yes('Add .gitignore, .gitattributes and issue/PR templates?');
    if (!args['dry-run']) args['dry-run'] = !(await yes('Write files now? (n = dry run)', false));
  } finally {
    rl.close();
  }
}

// ---- commands --------------------------------------------------------------
function resolveSkillDirs(args) {
  const dirs = [];
  for (const s of args.skill || []) {
    const p = path.resolve(s);
    dirs.push(path.basename(p).toLowerCase() === 'skill.md' ? path.dirname(p) : p);
  }
  if (args['skills-dir']) {
    const root = path.resolve(args['skills-dir']);
    if (!fs.existsSync(root)) fail(`--skills-dir ${root} does not exist`);
    const found = fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'SKILL.md')))
      .map((e) => path.join(root, e.name));
    if (!found.length) fail(`no skill folders (with SKILL.md) found in ${root}`);
    dirs.push(...found);
  }
  return dirs;
}

async function cmdPublish(args) {
  const wantPrompt = args.interactive || (process.stdin.isTTY && process.stdout.isTTY && !args.repo);
  if (wantPrompt) await askMissing(args);
  if (!args.repo) { console.error(USAGE); process.exit(1); }

  const dry = !!args['dry-run'];
  const repo = path.resolve(args.repo);
  const say = (m) => console.log(`${dry ? '[dry-run] ' : ''}${m}`);
  const github = args.github || detectGithub(repo);
  if (github && !/^[\w.-]+\/[\w.-]+$/.test(github)) fail('--github must look like owner/repo');
  if (github && !args.github) say(`using GitHub repo ${github} (detected from the git remote or README)`);

  const dirs = resolveSkillDirs(args);
  if (!dirs.length && !listSkills(repo).length)
    fail('nothing to publish: pass --skill or --skills-dir (the repo has no skills yet)');

  // 1. validate everything before touching the repo
  const results = dirs.map((dir) => {
    const dest = path.join(repo, 'skills', path.basename(dir));
    return { dir, ...validateSkill(dir, { inRepo: real(dir) === real(dest) }) };
  });
  const names = results.map((r) => r.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) fail(`skill "${dup}" was given more than once`);
  const { ok, nWarn } = report(results);
  if (!ok) fail('validation failed; nothing was written');
  if (nWarn) console.error(`${nWarn} warning${nWarn === 1 ? '' : 's'} above: relay each one to the user.`);

  // 2. plan
  const changes = { added: [], changed: [], removed: [] };
  const plans = [];
  let blocked = false;
  for (const r of results) {
    const dest = path.join(repo, 'skills', r.name);
    const srcReal = real(r.dir);
    const destReal = real(dest);
    if (srcReal === destReal) { say(`[${r.name}] already lives in the repo; nothing to copy`); continue; }
    if (isInside(destReal, srcReal) || isInside(srcReal, destReal))
      fail(`[${r.name}] skill folder and destination overlap (${r.dir} vs ${dest}); nothing was written`);
    const exists = fs.existsSync(dest);
    const d = diffSkill(r.files, dest);
    if (exists && d.same) { say(`[${r.name}] up to date; nothing to copy`); continue; }
    say(`[${r.name}] ${exists ? 'update' : 'add'} ${r.dir} -> ${dest}`);
    for (const f of d.added) say(`    + ${f}`);
    for (const f of d.changed) say(`    ~ ${f}`);
    for (const f of d.removed) say(`    - ${f}  (deleted from the repo)`);
    if (exists && !args.force) {
      blocked = true;
      console.error(`[${r.name}] already exists with different content; rerun with --force to apply the changes above.`);
    }
    (exists ? changes.changed : changes.added).push(r.name);
    plans.push({ r, dest });
  }
  if (blocked && !dry) fail('nothing was written');

  // 3. copy
  if (!dry) {
    fs.mkdirSync(path.join(repo, 'skills'), { recursive: true });
    for (const { r, dest } of plans) copySkill(r.files, dest);
  }

  // 4. README, metadata, extras
  const incoming = results.map((r) => ({ name: r.name, description: r.fm.description || '' }));
  const skills = dry
    ? [...listSkills(repo).filter((s) => !names.includes(s.name)), ...incoming].sort((a, b) => a.name.localeCompare(b.name))
    : listSkills(repo);
  const out = await refreshRepo({ repo, args, dry, say, skills, changes, github });

  const tag = `v${out.version}`;
  console.log(`
Done${dry ? ' (dry run, nothing written)' : ''}. ${skills.length} skill${skills.length === 1 ? '' : 's'} in the repo, version ${out.version}.${blocked ? '\nSome skills need --force (see above).' : ''}
After you push, others install with:

  npx skills add ${out.ref}
${names.map((n) => `  npx skills add ${out.ref} --skill ${n}`).join('\n')}
${out.pluginOn ? `  /plugin marketplace add ${out.ref}   (Claude Code)\n` : ''}
Next (your call, nothing below was run):
  cd "${repo}"
  git add -A && git commit -m "${changes.added.length || changes.changed.length ? `Publish ${[...changes.added, ...changes.changed].join(', ')}` : 'Refresh skill repo'}"
  git tag ${tag} && git push && git push --tags
  node "${fileURLToPath(import.meta.url)}" verify --repo "${repo}"   (after pushing)`);
}

function cmdCheck(args) {
  let targets;
  let baseDir = process.cwd();
  if (args.skill || args['skills-dir']) targets = resolveSkillDirs(args).map((dir) => ({ dir, inRepo: false }));
  else {
    if (!args.repo) fail('check needs --repo or --skill');
    baseDir = path.resolve(args.repo);
    const root = path.join(baseDir, 'skills');
    if (!fs.existsSync(root)) fail(`no skills/ folder in ${baseDir}`);
    targets = fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.includes('.tmp-'))
      .map((e) => ({ dir: path.join(root, e.name), inRepo: true }));
    if (!targets.length) fail(`no skills in ${root}`);
  }
  const results = targets.map((t) => ({ dir: t.dir, ...validateSkill(t.dir, { inRepo: t.inRepo }) }));
  if (args.json) {
    console.log(JSON.stringify(results.map((r) => ({ name: r.name, dir: r.dir, errors: r.errors, warnings: r.warnings })), null, 2));
    const bad = results.some((r) => r.errors.length || (args.strict && r.warnings.length));
    process.exit(bad ? 1 : 0);
  }
  const { ok, nErr, nWarn } = report(results, { strict: !!args.strict, baseDir });
  console.log(`${results.length} skill${results.length === 1 ? '' : 's'} checked: ${nErr} error${nErr === 1 ? '' : 's'}, ${nWarn} warning${nWarn === 1 ? '' : 's'}${args.strict ? ' (strict)' : ''}`);
  process.exit(ok ? 0 : 1);
}

function cmdList(args) {
  if (!args.repo) fail('list needs --repo');
  const repo = path.resolve(args.repo);
  const skills = listSkills(repo).map((s) => ({
    name: s.name,
    files: [...walk(s.dir)].filter((f) => !f.symlink).length,
    description: s.description,
  }));
  const version = currentVersion(repo);
  if (args.json) { console.log(JSON.stringify({ repo, version, skills }, null, 2)); return; }
  console.log(`${skills.length} skill${skills.length === 1 ? '' : 's'} in ${repo}${version ? ` (version ${version})` : ''}`);
  const w = Math.max(4, ...skills.map((s) => s.name.length));
  for (const s of skills) console.log(`  ${s.name.padEnd(w)}  ${String(s.files).padStart(3)} file${s.files === 1 ? ' ' : 's'}  ${shortDesc(s.description)}`);
}

async function cmdUnpublish(args) {
  if (!args.repo || !args.name) fail('unpublish needs --repo and --name');
  const dry = !!args['dry-run'];
  const repo = path.resolve(args.repo);
  const say = (m) => console.log(`${dry ? '[dry-run] ' : ''}${m}`);
  const root = path.join(repo, 'skills');
  const targets = args.name.map((n) => {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n)) fail(`"${n}" is not a valid skill name`);
    const dir = path.join(root, n);
    if (!fs.existsSync(dir)) fail(`skills/${n} does not exist in ${repo}`);
    if (fs.lstatSync(dir).isSymbolicLink() || !isInside(real(dir), real(root)))
      fail(`skills/${n} is a link that leaves the repo; remove it by hand`);
    return { name: n, dir, files: [...walk(dir)] };
  });
  for (const t of targets) {
    say(`remove skills/${t.name} (${t.files.length} file${t.files.length === 1 ? '' : 's'})`);
    for (const f of t.files) say(`    - ${f.rel}`);
  }
  if (!dry && !args.yes) fail('this deletes the folders above from the repo. Rerun with --yes to confirm. Nothing was removed');
  if (!dry) for (const t of targets) fs.rmSync(t.dir, { recursive: true, force: true });

  const gone = targets.map((t) => t.name);
  const skills = listSkills(repo).filter((s) => !gone.includes(s.name));
  const github = args.github || detectGithub(repo);
  const out = await refreshRepo({ repo, args, dry, say, skills, changes: { added: [], changed: [], removed: gone }, github });
  console.log(`\nDone${dry ? ' (dry run, nothing removed)' : ''}. ${skills.length} skill${skills.length === 1 ? '' : 's'} left, version ${out.version}. Git history still contains the removed files.`);
}

function cmdPack(args) {
  if (!args.repo) fail('pack needs --repo');
  const dry = !!args['dry-run'];
  const repo = path.resolve(args.repo);
  const format = (args.format || 'zip').toLowerCase();
  if (!['zip', 'skill'].includes(format)) fail('--format must be zip or skill');
  const outDir = path.resolve(args.out || path.join(repo, 'dist'));
  let skills = listSkills(repo);
  if (args.name) {
    const missing = args.name.filter((n) => !skills.some((s) => s.name === n));
    if (missing.length) fail(`not in the repo: ${missing.join(', ')}`);
    skills = skills.filter((s) => args.name.includes(s.name));
  }
  if (!skills.length) fail(`no skills in ${repo}`);
  const results = skills.map((s) => ({ dir: s.dir, ...validateSkill(s.dir, { inRepo: true }) }));
  if (!report(results, { baseDir: repo }).ok) fail('validation failed; nothing was packed');
  if (!dry) fs.mkdirSync(outDir, { recursive: true });
  for (const r of results) {
    const entries = r.files
      .sort((a, b) => a.rel.localeCompare(b.rel))
      .map((f) => {
        const data = fs.readFileSync(f.abs);
        return { name: `${r.name}/${f.rel}`, data, exec: data.subarray(0, 2).toString() === '#!' };
      });
    const file = path.join(outDir, `${r.name}.${format}`);
    if (dry) { console.log(`[dry-run] pack ${file} (${entries.length} files)`); continue; }
    const buf = makeZip(entries);
    fs.writeFileSync(file, buf);
    console.log(`packed ${file} (${entries.length} files, ${buf.length} bytes)`);
  }
}

function cmdVerify(args) {
  const repo = args.repo ? path.resolve(args.repo) : null;
  const github = args.github || (repo && detectGithub(repo));
  if (!github) fail('verify needs --github <owner>/<repo> (or --repo with a GitHub remote)');
  if (!/^[\w.-]+\/[\w.-]+$/.test(github)) fail('--github must look like owner/repo');
  if (run('git', ['--version']).status !== 0) fail('git is required for verify');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-skill-verify-'));
  let failed = false;
  try {
    console.log(`cloning https://github.com/${github} ...`);
    const c = run('git', ['clone', '--depth', '1', '--quiet', `https://github.com/${github}.git`, tmp]);
    if (c.status !== 0) fail(`could not clone ${github}: ${(c.stderr || '').trim() || 'unknown error'}\n(is the repo pushed, and public or reachable with your git credentials?)`);
    const remote = listSkills(tmp);
    if (!remote.length) { console.error('error: the pushed repo has no skills/<name>/SKILL.md'); failed = true; }
    const results = remote.map((s) => ({ dir: s.dir, ...validateSkill(s.dir, { inRepo: true }) }));
    if (!report(results, { baseDir: tmp }).ok) failed = true;
    console.log(`remote skills: ${remote.map((s) => s.name).join(', ') || '(none)'}`);

    if (repo) {
      const local = listSkills(repo);
      for (const s of local) {
        const r = remote.find((x) => x.name === s.name);
        if (!r) { console.error(`error: [${s.name}] is in the local repo but not on GitHub (not pushed?)`); failed = true; continue; }
        const files = [...walk(s.dir)].filter((f) => !f.symlink);
        if (!diffSkill(files, r.dir).same) { console.error(`error: [${s.name}] differs between local and GitHub (commit and push pending?)`); failed = true; }
        else console.log(`ok: [${s.name}] GitHub matches local`);
      }
      for (const r of remote)
        if (!local.some((s) => s.name === r.name)) console.error(`warning: [${r.name}] is on GitHub but not in the local repo`);
    }

    if (args.npx) {
      console.log(`running: npx --yes skills add ${github} --list`);
      const n = run('npx', ['--yes', 'skills', 'add', github, '--list'], { timeout: 180_000 });
      process.stdout.write(n.stdout || '');
      if (n.status !== 0) {
        process.stderr.write(n.stderr || '');
        console.error('warning: the skills CLI did not exit cleanly; its flags may have changed. Check its current docs.');
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failed ? '\nverify FAILED' : `\nverify passed: npx skills add ${github}`);
  process.exit(failed ? 1 : 0);
}

// ---- main ------------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log(USAGE); process.exit(0); }
if (parseInt(process.versions.node, 10) < 18) fail(`Node 18 or newer is required (found ${process.versions.node})`);

switch (args.command) {
  case 'check': cmdCheck(args); break;
  case 'list': cmdList(args); break;
  case 'unpublish': await cmdUnpublish(args); break;
  case 'pack': cmdPack(args); break;
  case 'verify': cmdVerify(args); break;
  default: await cmdPublish(args);
}
