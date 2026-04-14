# AGENTS.md

Guidance for agents working in this repository.

## Repository intent

This repo contains a single Paperclip plugin package for Micronaut-oriented workflows. Treat the repository root as the package root.

## Package layout

```text
.
├── scripts/
│   └── e2e/
├── src/
│   ├── manifest.ts
│   ├── worker.ts
│   └── ui/
│       └── index.tsx
├── tests/
│   ├── e2e/
│   │   └── results/
│   └── plugin.spec.ts
├── AGENTS.md
├── README.md
├── package.json
└── tsconfig.json
```

## Source-of-truth files

Read these before changing behavior:

- `README.md` - package purpose, setup, and verification workflow
- `src/manifest.ts` - plugin registration and the intentionally minimal installable manifest contract
- `src/worker.ts` - the no-op worker entrypoint
- `src/ui/index.tsx` - placeholder hosted UI entrypoint kept empty until slots are added
- `tests/plugin.spec.ts` - minimum fast contract coverage
- `scripts/e2e/run-paperclip-smoke.mjs` - disposable end-to-end verification harness
- `scripts/e2e/manual-paperclip-verify.mjs` - local manual Paperclip verification harness
- `paperclip-plugin-ui` - global reusable Paperclip plugin UI patterns discovered in this repo
- `paperclip-plugin-development` - global reusable Paperclip plugin backend/worker patterns discovered in this repo

## Working rules

### Manifest changes

- Keep the plugin id stable unless the task explicitly requires a breaking rename.
- Keep manifest entrypoints aligned with the build output in `dist/`.
- Do not add capabilities casually; every capability should correspond to real behavior.

### Worker changes

- Match the existing `definePlugin(...)/runWorker(...)` pattern.
- Keep the worker minimal until the plugin actually needs runtime behavior.
- If you add worker-visible state or registrations later, update both the fast test and any affected e2e assertions in the same change.

### UI changes

- Keep `src/ui/index.tsx` empty until the plugin actually declares UI slots.
- If you add exported UI components, add the matching manifest slot declarations in the same change.
- If you introduce hosted UI later, update the Playwright smoke assertions in the same change.

### Verification harness changes

- Keep `scripts/e2e/*.mjs` self-contained and runnable from the repository root.
- Preserve disposable-state defaults for smoke runs unless the task explicitly requires persistence.
- Keep `tests/e2e/results/` as generated output only; do not treat it as source.
- When the hosted Paperclip flow changes, update both the smoke harness and the manual verification notes in `README.md`.

### Skill maintenance

- If you discover or introduce a reusable Paperclip plugin pattern while working, update the matching global skill in the same change.
- Update `paperclip-plugin-ui` for hosted UI patterns, reusable UI helpers, theme or styling rules, slot behavior, or Paperclip-native interaction conventions.
- Update `paperclip-plugin-development` for worker or backend patterns, manifest or capability rules, state or config behavior, jobs, orchestration, or test strategy.
- If a pattern spans both worker and UI concerns, update both skills so they stay in sync.
- Keep the skill `SKILL.md`, any affected `references/` files, and `agents/openai.yaml` aligned with the latest reusable patterns.

### Packaging changes

- Keep package-specific dependencies in the root `package.json`.
- Do not edit `dist/` by hand; rebuild through the package scripts.
- Keep the published plugin metadata in `package.json` and `src/manifest.ts` aligned.

## Verification

Run the smallest relevant scope first from the repository root:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Use these selectively:

- `pnpm test` for changes in `src/` or `tests/`
- `pnpm test:e2e` when touching manifest contributions, plugin installation flow, hosted UI behavior, or the e2e harness
- `pnpm verify:manual` when the task benefits from visual inspection inside a real Paperclip host

## Documentation expectations

Update `README.md` when any of these change:

- plugin purpose or scope
- manifest capabilities or slots
- worker or UI contract
- e2e or manual verification workflow

Update the matching global skills when any of these change:

- reusable Paperclip plugin UI patterns or helper components
- reusable Paperclip plugin worker or backend patterns or helper functions
- recommended verification or testing patterns for plugins in this repo
