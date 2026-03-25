# OpenClaw Runtime Audit (local evidence)

Date: 2026-03-25
Repo audited: `A:\projects\openclaw-skills\chatgpt-prompt-dispatcher`
Runtime audited: local OpenClaw gateway launched from `A:\projects\openclaw\dist\index.js`

## Evidence summary

### Runtime binary / source of truth

- Local gateway launcher points to the local built runtime, not a packaged binary:
  - `C:\Users\curioustore\.openclaw\gateway.cmd:12`
- Current gateway config file is:
  - `C:\Users\curioustore\.openclaw\openclaw.json`

### Skill search paths actually implemented in runtime

The docs summarize bundled / managed / workspace + extra dirs:
- `A:\projects\openclaw\docs\tools\skills.md:15-26`
- `A:\projects\openclaw\docs\tools\skills.md:32-39`

The runtime code is more specific. It loads from:
- configured extra dirs
- bundled skills dir
- managed skills dir (`~/.openclaw/skills`)
- personal agent skills (`~/.agents/skills`)
- project agent skills (`<workspace>/.agents/skills`)
- workspace skills (`<workspace>/skills`)
- Evidence: `A:\projects\openclaw\src\agents\skills\workspace.ts:464-488`
- Merge precedence: `extra < bundled < managed < agents-skills-personal < agents-skills-project < workspace`
- Evidence: `A:\projects\openclaw\src\agents\skills\workspace.ts:490-509`

Local config currently adds one extra dir:
- `skills.load.extraDirs = ["~/.openclaw/workspace/skills"]`
- Evidence: `C:\Users\curioustore\.openclaw\openclaw.json:234-240`

Main agent workspace path is:
- `A:/projects/openclaw-ops/agents/main/workspace`
- Evidence: `C:\Users\curioustore\.openclaw\openclaw.json:89-95`

### What counts as a discoverable skill

OpenClaw expects AgentSkills-compatible folders with `SKILL.md`:
- `A:\projects\openclaw\docs\tools\skills.md:11`
- `A:\projects\openclaw\docs\tools\skills.md:80-87`

Runtime discovery rules:
- if scanned root itself contains `SKILL.md`, it is loaded directly
  - `A:\projects\openclaw\src\agents\skills\workspace.ts:319-353`
- otherwise immediate child directories are considered only if each child contains `SKILL.md`
  - `A:\projects\openclaw\src\agents\skills\workspace.ts:380-420`
- there is a special heuristic for nested `skills/` roots, specifically plural `skills/`
  - `A:\projects\openclaw\src\agents\skills\workspace.ts:255-276`

### Frontmatter / metadata actually used

Required minimum from docs:
- `name`
- `description`
- Evidence: `A:\projects\openclaw\docs\tools\skills.md:80-87`

Optional frontmatter used by runtime:
- `user-invocable`
- `disable-model-invocation`
- `command-dispatch`
- `command-tool`
- `command-arg-mode`
- Evidence: `A:\projects\openclaw\docs\tools\skills.md:95-104`
- Runtime parser + invocation policy: `A:\projects\openclaw\src\agents\skills\frontmatter.ts:172-184`

Optional `metadata.openclaw` used for gating/install/env:
- docs: `A:\projects\openclaw\docs\tools\skills.md:106-136`
- runtime parser: `A:\projects\openclaw\src\agents\skills\frontmatter.ts:145-170`

### Direct execution hook support

A plain `SKILL.md` teaches the model and can expose a slash command name, but deterministic direct execution requires tool dispatch frontmatter:
- docs: `A:\projects\openclaw\docs\tools\skills.md:99-104`
- runtime command spec builder: `A:\projects\openclaw\src\agents\skills\workspace.ts:775-871`

Important local fact:
- the built-in direct dispatch kind is `tool`
- it requires `command-tool`
- raw args are forwarded as:
  - `{ command: "<raw args>", commandName: "<slash command>", skillName: "<skill name>" }`
- docs evidence: `A:\projects\openclaw\docs\tools\skills.md:99-104`
- runtime type evidence: `A:\projects\openclaw\src\agents\skills\types.ts:32-39`

I did **not** find a runtime feature here that says “discover SKILL.md and then auto-run a package.json bin / Node CLI from that skill folder”. In the audited code path, direct dispatch is to an existing OpenClaw tool, not to an arbitrary skill-local executable.

### Env / working directory behavior

What the docs and runtime explicitly show:
- `skills.entries.<skill>.env` and `skills.entries.<skill>.apiKey` inject into the **host** process for that agent turn
  - `A:\projects\openclaw\docs\tools\skills.md:73-75`
- sandboxed runs do **not** inherit host env automatically
  - `A:\projects\openclaw\docs\tools\skills-config.md:58-64`
- runtime env override code mutates `process.env` for the active turn
  - `A:\projects\openclaw\src\agents\skills\env-overrides.ts:20-58`
  - `A:\projects\openclaw\src\agents\skills\env-overrides.ts:181-224`
- skill instructions can reference `{baseDir}`
  - `A:\projects\openclaw\docs\tools\skills.md:94`

What I could **not** verify in this audit:
- a skill-specific runtime cwd convention for direct CLI execution, because the audited direct-dispatch path is tool-based and does not define a skill-local executable/cwd contract.

### Existing local skill examples

Managed/local installed skill currently present:
- `C:\Users\curioustore\.openclaw\skills\db-proxy-skill\SKILL.md`

That example is a plain skill folder rooted directly at `~/.openclaw/skills/<name>/SKILL.md` and does not need an extra manifest file.

### Current repo shape vs runtime expectations

Current repo stores the portable skill at:
- `A:\projects\openclaw-skills\chatgpt-prompt-dispatcher\skill\SKILL.md`

Current repo root does **not** place `SKILL.md` at the scanned root.
Current repo also uses singular `skill/`, while the runtime nested-root heuristic only recognizes plural `skills/`:
- nested-root heuristic: `A:\projects\openclaw\src\agents\skills\workspace.ts:255-276`

That means the repo root itself is **not** discoverable merely by being present somewhere on disk.

---

## Gap report

### Discoverable

These parts already match OpenClaw skill expectations:
- There is a valid `SKILL.md` with `name` and `description`.
  - `A:\projects\openclaw-skills\chatgpt-prompt-dispatcher\skill\SKILL.md:1-4`
- The portable install layout is compatible **after materialization** into a scanned skill root, because `install-local` copies `skill/` contents so the installed target root gets `SKILL.md` at top level.
- No extra manifest file beyond `SKILL.md` is required for discovery in the audited runtime.

### Runnable

These parts exist but only partially line up with OpenClaw runtime execution:
- The repo has a Node CLI entrypoint and submit command:
  - `A:\projects\openclaw-skills\chatgpt-prompt-dispatcher\package.json:5-18`
- The repo has an OpenClaw adapter wrapper at `adapters/openclaw/index.js`.
- The skill text clearly defines boundaries and intended behavior.

### Missing

These are the concrete gaps against “discover / register / run directly in current local OpenClaw runtime”:
- **Not in any scanned path right now**
  - repo lives at `A:\projects\openclaw-skills\chatgpt-prompt-dispatcher`
  - scanned roots are managed/workspace/extra dirs from the runtime evidence above
- **Repo root is not directly discoverable**
  - because `SKILL.md` is under `skill/`, not repo root
  - and runtime only special-cases nested `skills/`, not `skill/`
- **No audited direct execution hook is wired from the skill to an OpenClaw tool**
  - current `skill/SKILL.md` does not declare `command-dispatch: tool`
  - it also does not declare a `command-tool`
- **OpenClaw adapter exists in the repo, but I found no local runtime registration path that auto-exposes that adapter as an OpenClaw tool just because it exists in `adapters/openclaw/`**
- **No proven runtime contract for “run this skill-local Node CLI with cwd/env X”** was found in the audited discovery/dispatch code

---

## Answers to requested checks

1. **Skill search path**
   - Actual runtime sources: extra dirs, bundled, `~/.openclaw/skills`, `~/.agents/skills`, `<workspace>/.agents/skills`, `<workspace>/skills`
   - Evidence: `workspace.ts:464-509`, docs `skills.md:15-39`, config `openclaw.json:234-240`

2. **Needed manifest / metadata files**
   - Discovery minimum: `SKILL.md` with frontmatter `name` + `description`
   - Optional runtime metadata: `metadata.openclaw`, `user-invocable`, `disable-model-invocation`, `command-dispatch`, `command-tool`, `command-arg-mode`
   - No separate manifest required for discovery was found in this audit

3. **Discovered by `SKILL.md` alone?**
   - **Yes for discovery**, if the folder is inside a scanned skill root and the root/child layout matches runtime rules
   - **No for direct deterministic execution**, because `SKILL.md` alone only provides instructions unless you also use direct tool-dispatch frontmatter

4. **Separate execution hook required?**
   - **Yes**, if the goal is immediate/direct runnable behavior from a slash command without model interpretation
   - Audited direct hook is `command-dispatch: tool` + `command-tool: <existing OpenClaw tool>`

5. **Node / CLI calling convention**
   - I found no built-in “skill-local Node CLI” invocation contract in the audited skill runtime path
   - The explicit direct-dispatch contract I did find is tool invocation with raw args object:
     - `{ command, commandName, skillName }`

6. **Env / working directory passing**
   - Verified: `skills.entries.*.env` / `apiKey` inject into host `process.env` for the turn
   - Verified: sandbox does not inherit host env automatically
   - Not verified: a skill-specific cwd convention for direct skill-local CLI execution

---

## Final answer: can this repo be registered and used immediately as-is?

**No.**

Why:
1. The repo is **not currently located in a scanned skill root**.
2. The repo root is **not directly discoverable**, because the actual `SKILL.md` is in `skill/`, while the audited nested-root heuristic only recognizes `skills/`.
3. The audited OpenClaw runtime does **not** show an automatic path from `adapters/openclaw/` or `package.json` to a runnable skill command.
4. For deterministic direct execution, the current skill is missing audited tool-dispatch frontmatter (`command-dispatch` / `command-tool`) and also lacks proof of a registered backing OpenClaw tool.

Practical implication:
- After materializing `skill/` into a scanned location (for example `~/.openclaw/skills/chatgpt-web-submit/`) it can become **discoverable as a skill**.
- But from the local evidence gathered here, it is **not yet proven directly runnable by the OpenClaw runtime as a command** without additional runtime/tool wiring.
