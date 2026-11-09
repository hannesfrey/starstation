# Starstation — notes for Claude Code

Read `PROJECT.md` (goal, users, priorities, how much process) and then `PROGRESS.md` (current state, handoff,
release routine) at the start of every session. `AGENTS.md` has the same short version for other AI tools.

- Family + friends app, current phase: stabilize. Data safety first, then day-to-day reliability, controllers,
  weak PCs, then features.
- Ask Hannes before publishing any release. Plain-language explanations for him.
- Toolchain: `. .\env.ps1` in PowerShell (portable Node/gh in `tools\`). Tests: `npx tsc --noEmit -p tsconfig.json`,
  `npx vitest run`, `npx playwright test`.
