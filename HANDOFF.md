# Open World MMO Handoff

## Current state

Feature tasks 1-18 are implemented in this TypeScript npm-workspaces monorepo:

- `packages/shared`: deterministic world generation, Colyseus schemas, protocol constants.
- `packages/server`: Colyseus authoritative game room, SQLite persistence, movement, combat, quests, tile physics, trading, crafting, mounts, shops, titles, and offline accumulation.
- `packages/client`: PixiJS rendering, networking, desktop and touch input, gameplay UI, PWA support, and responsive layout.

The idle reward claim path was completed end-to-end. Its focused verification passed 21 tests, and `npm run build --workspaces` passed for all packages.

The replacement-computer verification repaired the production startup path and completed F2. The real 500-client test passed with 500/500 joins, no join failures, bounded cleanup, and captured latency, CPU, and memory evidence. The server uses 100-client room shards and AOI-filtered state replication.

## Remaining work

Final verification was paused because the previous computer had insufficient memory. Rerun all four tasks on the new computer; do not rely on old background task IDs or unavailable results.

1. F1 full-game integration verification: join/auth, movement, combat, quests, crafting, trade, mounts, shops/titles, idle summary and claim, plus invalid paths.
2. F2 complete: real 500-client Colyseus/WebSocket load test with latency, connection errors, CPU, memory, and bounded cleanup evidence.
3. F3 Playwright QA at 390x844, 768x1024, and 1440x900, including touch controls, responsive layout, PWA shell, overlap, clipping, console errors, and network errors.
4. F4 whole-codebase review covering goals, hands-on QA, code quality, security, and missed context.

## Setup on the new computer

Install Node.js, npm, Git, OpenCode, and Playwright/Chromium for browser QA. Then run from the repository root:

```powershell
npm ci
npm run build
npm test
```

Configure OpenCode separately. All 18 agent/category model slots should use:

```text
agentrouter/gpt-5.6-sol
```

Do not store provider credentials, API keys, or tokens in this repository. Restart OpenCode after changing its configuration.

## First OpenCode prompt

```text
Continue from HANDOFF.md.

Feature tasks 1-18 are implemented. The final verification phase was paused because the previous computer had insufficient memory. Do not redo feature implementation unless a verification failure proves a real defect.

Resume in this order:
1. F1: run a real full-game integration test covering join/auth, movement, combat, quests, crafting, trade, mounts, shops/titles, and idle summary/claim.
2. F2: run a real 500-client Colyseus/WebSocket load test with bounded cleanup and documented latency, errors, CPU, and memory.
3. F3: run Playwright QA at 390x844, 768x1024, and 1440x900, checking touch controls, responsive layout, PWA shell, overlap, clipping, console errors, and network errors.
4. F4: run the mandatory whole-codebase review.

Do not claim any final task passed without concrete command output and evidence. Use agentrouter/gpt-5.6-sol for all agents.
```
