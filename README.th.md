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

[English](README.md) &nbsp;·&nbsp; **ไทย**

**[ฟีเจอร์](#features)** &nbsp;·&nbsp; **[สกิล](#skills)** &nbsp;·&nbsp; **[ติดตั้ง](#install)** &nbsp;·&nbsp; **[ทำงานอย่างไร](#how-it-works)** &nbsp;·&nbsp; **[โครงสร้าง](#repo-layout)** &nbsp;·&nbsp; **[ร่วมพัฒนา](#contributing)**

<br>

```bash
npx skills add koravut-Dev/Publish_Skill
```

</div>

<!-- intro:start -->
<a id="features"></a>

## ฟีเจอร์

เขียนสกิลเสร็จแล้ว งานที่น่าเบื่อคือทำให้มันเป็น repo ที่ติดตั้งได้กับทุก agent: โครงสร้างโฟลเดอร์ README ใบอนุญาต ตรวจ secret เวอร์ชัน และ CI `publish-skill` ทำทั้งหมดนี้ด้วยสคริปต์เดียวที่ไม่ต้องติดตั้ง package ใดๆ และไม่ยอมเผยแพร่ถ้าเจอ secret หลุด

<img src="assets/demo.svg" alt="ตัวอย่างในเทอร์มินัล: publish-skill แพ็กสกิลเข้า repo" width="100%">

<table>
<tr>
<td width="33%" valign="top">

#### สแกน secret

ตรวจ token 19 รูปแบบ (AWS, GitHub, Slack, Anthropic, Stripe, JWT, URL ฐานข้อมูล และอื่นๆ) รายงานเป็น `ไฟล์:บรรทัด` ถ้าเจอจะหยุดก่อนเขียนไฟล์ใดๆ

</td>
<td width="33%" valign="top">

#### ตรวจคุณภาพสกิล

ตรวจ frontmatter คำบอกเงื่อนไขการใช้ใน description ลิงก์เสีย ชื่อเครื่องมือเฉพาะ agent ชื่อไฟล์ที่ใช้บน Windows ไม่ได้ และสคริปต์ shell ที่เป็น CRLF

</td>
<td width="33%" valign="top">

#### แสดง diff ก่อนอัพเดต

อัพเดตสกิลเดิมจะแสดงทุกไฟล์ที่จะเพิ่ม แก้ หรือลบ แล้วรอ `--force` ถ้าเนื้อหาเหมือนเดิมจะข้ามไป

</td>
</tr>
<tr>
<td valign="top">

#### เวอร์ชันและ changelog

`--bump patch|minor|major` ตั้งเวอร์ชันและเขียน `CHANGELOG.md` ระบุสกิลที่เพิ่ม แก้ และลบ

</td>
<td valign="top">

#### CI และ release

`--ci` เพิ่ม GitHub Actions ที่ตรวจทุก pull request และเมื่อ push tag จะสร้าง zip แยกตามสกิลแนบไปกับ release

</td>
<td valign="top">

#### ติดตั้งได้ทุกช่องทาง

`npx skills add` คัดลอกเอง ดาวน์โหลด zip และ Claude Code plugin marketplace ใช้ได้จาก repo เดียวกัน README เลือกได้ทั้งอังกฤษ ไทย หรือสองภาษา

</td>
</tr>
</table>

### หกคำสั่งในสคริปต์เดียว

| คำสั่ง | ทำอะไร |
|---|---|
| `publish` | ตรวจ คัดลอกสกิลเข้า repo แล้วสร้าง README กับ metadata ใหม่ |
| `check` | ตรวจคุณภาพและสแกน secret อย่างเดียว เป็นคำสั่งที่ CI ใช้ |
| `list` | แสดงสกิลใน repo และเวอร์ชัน |
| `unpublish` | ลบสกิลแล้วรีเฟรช README กับ metadata (ต้องใส่ `--yes`) |
| `pack` | สร้าง `.zip` หรือ `.skill` แยกตามสกิล สำหรับแจกโดยไม่ใช้ git |
| `verify` | clone repo ที่ push แล้วมาตรวจว่าตรงกับ local และผ่านการตรวจ |

### หยุดการเผยแพร่ที่มีปัญหา

```text
error: [bad-skill] a.js:1: possible GitHub token
error: [bad-skill] a.js:2: possible connection string with a password
warning: [demo-skill] scripts/run.sh: shell script has CRLF line endings; it will fail on macOS/Linux
warning: [demo-skill] SKILL.md:7: link "references/missing.md" points to a file that does not exist
error: validation failed; nothing was written
```

### อัพเดตแล้วเห็น diff ก่อนเสมอ

```text
[demo-skill] update ./demo-skill -> ./my-skills/skills/demo-skill
    + new.txt
    ~ SKILL.md
    - scripts/run.sh  (deleted from the repo)
[demo-skill] already exists with different content; rerun with --force to apply the changes above.
```

### จากโฟลเดอร์ถึง release

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

### เริ่มใช้งาน

ติดตั้งสกิล แล้วสั่ง agent ว่า *"publish skill ./my-skill ไปที่ you/my-skills"* หรือรันสคริปต์เอง:

```bash
node skills/publish-skill/scripts/publish-skill.mjs publish --skill ./my-skill --repo ./my-skills --github you/my-skills --plugin --ci --dry-run
```

เมื่อแผนถูกต้องแล้วค่อยเอา `--dry-run` ออก สคริปต์ไม่ push ให้เอง ขั้นตอน git เป็นการตัดสินใจของคุณ
<!-- intro:end -->

<!-- skills:start -->
<!-- skills:lang=th -->
<a id="skills"></a>

## สกิล

<table>
<tr>
<td colspan="2" valign="top">

#### publish-skill

นำสกิลที่สร้างไว้ (โฟลเดอร์ที่มี SKILL.md) เข้า git repo ตามมาตรฐาน Agent Skills เพื่อให้คนอื่นติดตั้งได้ด้วยคำสั่งเดียว เช่น `npx skills add owner/repo` รวมถึงตรวจสกิลก่อนเผยแพ...

<sub>ลองพิมพ์: <code>publish skill</code> · <code>เอาสกิลขึ้น repo</code> · <code>ทำให้ติดตั้งได้ด้วย command</code> · <code>แจกสกิล</code></sub>

```bash
npx skills add koravut-Dev/Publish_Skill --skill publish-skill
```

</td>
</tr>
</table>

<a id="install"></a>

## ติดตั้ง

> [!TIP]
> คำสั่งเดียวติดตั้งทุกสกิลใน repo นี้ให้ทุก agent ที่ตรวจพบในเครื่อง

```bash
# ทุกสกิลใน repo นี้
npx skills add koravut-Dev/Publish_Skill

# เฉพาะสกิลเดียว
npx skills add koravut-Dev/Publish_Skill --skill publish-skill
```

<details>
<summary><b>Claude Code plugin marketplace</b></summary>

```text
/plugin marketplace add koravut-Dev/Publish_Skill
```

</details>

<details>
<summary><b>ดาวน์โหลดเป็น zip</b></summary>

ทุก [release](https://github.com/koravut-Dev/Publish_Skill/releases) แนบไฟล์ zip แยกตามสกิล แตกไฟล์ลงในโฟลเดอร์ skills ของ agent ที่ใช้

</details>

<details>
<summary><b>คัดลอกเอง</b></summary>

```bash
git clone https://github.com/koravut-Dev/Publish_Skill.git
cp -r Publish_Skill/skills/publish-skill ~/.claude/skills/
```

```powershell
Copy-Item -Recurse Publish_Skill\skills\publish-skill "$HOME\.claude\skills\"
```

| Agent | ส่วนตัว | ในโปรเจกต์ |
|---|---|---|
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Codex CLI | `~/.codex/skills/` | `.agents/skills/` |
| Cursor | `~/.cursor/skills/` | `.cursor/skills/` |
| Gemini CLI | `~/.gemini/skills/` | `.gemini/skills/` |
| GitHub Copilot | `~/.copilot/skills/` | `.github/skills/` |
| OpenCode | `~/.config/opencode/skills/` | `.opencode/skills/` |
| อื่นๆ | ดูเอกสารของเครื่องมือ | ดูเอกสารของเครื่องมือ |

</details>

> [!IMPORTANT]
> สกิลทำงานด้วยสิทธิ์เต็มของ agent อ่านสกิลก่อนติดตั้งทุกครั้ง ตำแหน่งโฟลเดอร์และ flag ของ CLI เปลี่ยนได้ตามเวลา ให้ตรวจกับเอกสารล่าสุดของแต่ละเครื่องมือ

<a id="how-it-works"></a>

## ทำงานอย่างไร

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

<a id="repo-layout"></a>

## โครงสร้าง repo

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

ชื่อโฟลเดอร์ของแต่ละสกิลต้องตรงกับ `name` ใน frontmatter ของ `SKILL.md` ตามมาตรฐาน Agent Skills

<a id="contributing"></a>

## ร่วมพัฒนา

1. เพิ่มหรือแก้สกิลใต้ `skills/<name>/SKILL.md`
2. ต้องมี `name` (ตัวพิมพ์เล็กคั่นด้วยขีด และตรงกับชื่อโฟลเดอร์) กับ `description` ใน frontmatter
3. ห้าม commit secret สคริปต์ publish จะสแกนหาให้
4. เปิด pull request
<!-- skills:end -->

<div align="center">

<sub>สร้างด้วยสกิล <code>publish-skill</code> &nbsp;·&nbsp; <a href="#">กลับขึ้นบน ↑</a></sub>

</div>
