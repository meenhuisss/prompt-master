# CLAUDE.md — Prompt Master

## Project Overview

**Prompt Master** is a Claude AI skill that generates optimized, production-ready prompts for any AI tool. It is a pure documentation project — no source code, no build system, no dependencies. The entire product lives in Markdown files installed as a Claude skill.

**Core philosophy:** The best prompt is not the longest — it's the one where every word is load-bearing.

**Problem it solves:** AI users waste credits iterating through poorly-written prompts. Prompt Master eliminates re-prompts by generating precise, tool-specific prompts on the first attempt.

---

## Repository Structure

```
prompt-master/
├── CLAUDE.md             # This file — AI assistant conventions
├── LICENSE               # MIT License
├── README.md             # Public documentation and usage guide
├── SKILL.md              # The actual Claude skill specification (runs inside Claude)
└── references/
    ├── patterns.md       # 35 credit-killing anti-patterns reference
    └── templates.md      # 12 prompt template library
```

**That's it.** No `src/`, no `tests/`, no build config. This is a documentation-driven skill.

---

## Key Files

### SKILL.md
The primary artifact. This is the Claude skill specification — it defines exactly how Claude should behave when the skill is invoked. Structured in three zones:

- **PRIMACY ZONE** (lines 1–~80): Identity, hard rules, output format. Read first by the model's attention window.
- **MIDDLE ZONE** (~80–320): Execution logic — intent extraction, tool routing, diagnostic checklist, safe techniques.
- **RECENCY ZONE** (~320–end): Verification checklist and success metrics.

This zone structure is intentional: the most critical constraints live in the first 30% of the file where attention is highest.

### README.md
Public-facing documentation. Contains installation instructions, usage examples, tool profiles, and the full feature list. Not loaded by the skill at runtime — it's for humans browsing GitHub.

### references/templates.md
Library of 12 prompt templates (A–L), each optimized for a specific task category. The skill loads this file **only when needed** to keep context usage low. Templates are silently selected — users never see template names.

### references/patterns.md
Reference guide for 35 credit-killing anti-patterns organized into 6 categories: task, context, format, scope, reasoning, and agentic patterns. Each entry shows the bad example and the fix.

---

## How the Skill Works (Architecture)

The skill follows a strict 7-step pipeline on every invocation:

1. **Detect target tool** — Identify which AI system the prompt is being written for (30+ tool profiles).
2. **Extract 9 dimensions of intent** — task, tool, output format, constraints, input data, context, audience, success criteria, examples.
3. **Ask max 3 clarifying questions** — only if truly critical info is missing. Never more than 3.
4. **Silently route to the right template** — pick from 12 frameworks based on task type. Never announce the template.
5. **Apply safe techniques only** — role assignment, few-shot examples, XML tags, grounding anchors, chain-of-thought (with exceptions).
6. **Run token efficiency audit** — strip every non-load-bearing word.
7. **Deliver one clean, copy-paste-ready prompt.**

### Forbidden techniques (never add these)
- Tree of Thought
- Graph of Thought
- Universal Self-Consistency
- Prompt chaining (unless the user explicitly requests it)

### Reasoning model exception
Never add chain-of-thought to: o3, o4-mini, DeepSeek-R1, Qwen3-thinking. These models reason internally — added CoT wastes tokens and degrades output.

---

## Development Conventions

### Editing SKILL.md
- Preserve the three-zone structure (PRIMACY / MIDDLE / RECENCY).
- Hard rules and identity must stay in the first ~30% of the file.
- Add new tool profiles to the tool routing table in the MIDDLE ZONE.
- Keep the verification checklist in the RECENCY ZONE.
- Every constraint should use **NEVER** or **ALWAYS** — not "should" or "could".

### Editing templates.md
- Templates are indexed A–L. If adding a new template, continue the alphabetical index.
- Each template must include: structure definition, use-case description, and a concrete example.
- Do not add templates for techniques listed as forbidden above.

### Editing patterns.md
- Patterns are grouped by category. Add new patterns to the correct category.
- Every pattern entry must show: pattern name, bad example, and the fix.
- Currently 35 patterns across 6 categories (task, context, format, scope, reasoning, agentic).

### Editing README.md
- README is the public-facing document — keep it accurate with the current skill version.
- The version number in README must match the version in SKILL.md.
- Tool profiles listed in README must match the routing logic in SKILL.md.

---

## Versioning

Current version: **1.5.0**

Version is declared in:
- `README.md` — in the changelog/version history section
- `SKILL.md` — in the skill header/description

When bumping versions:
- Update both files to match.
- Follow semantic versioning: major tool additions = minor bump (1.x), bug fixes = patch (1.x.x).

---

## Git Workflow

- **Default development branch:** `main`
- **Feature branches:** `feature/<description>` (e.g., `feature/add-minimax-provider`)
- **AI assistant branches:** `claude/<description>` (e.g., `claude/add-claude-documentation-UJjXi`)

Commit message conventions observed in this repo:
- `feat:` for new tool profiles, templates, or features
- `fix:` for corrections to routing logic or patterns
- Imperative mood, lowercase after colon

---

## Installation (for context)

**Claude.ai (browser):**
1. Download repo as ZIP
2. Claude.ai → Sidebar → Customize → Skills → Upload a Skill

**Claude Code (local):**
```bash
mkdir -p ~/.claude/skills
git clone https://github.com/meenhuisss/prompt-master.git ~/.claude/skills/prompt-master
```

**Invocation:**
```
/prompt-master I want a prompt for Cursor to refactor my auth module
```

---

## What AI Assistants Should Know

- **Do not add source code files.** This is a documentation-only project. There is no runtime to test against.
- **Do not add a build system, CI/CD config, or dependency manager** unless explicitly requested.
- **Preserve the zone structure** in SKILL.md — moving constraints out of the PRIMACY ZONE will degrade skill performance.
- **Tool routing logic** in SKILL.md must stay synchronized with tool profiles in README.md.
- **No fabrication techniques** — never add Tree of Thought, Graph of Thought, or similar patterns to the skill.
- **Max 3 questions rule** is a hard constraint — do not relax it.
- The `references/` directory files are loaded on-demand to save context. Keep them modular and self-contained.
- When in doubt about whether to add a new template or pattern, prefer editing an existing entry to keep the reference compact.
