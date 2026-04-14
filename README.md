# Micronaut Plugin

Empty Paperclip plugin scaffold for Micronaut workflows.

This repository is bootstrapped as a standalone Paperclip plugin using the published `@paperclipai/plugin-sdk`. It includes:

- a typed manifest
- a no-op worker entrypoint
- an empty UI entrypoint reserved for future slots
- a Vitest harness test
- esbuild and rollup build configs
- Playwright-backed smoke and manual verification scripts

## Development

```bash
pnpm install
pnpm dev
pnpm dev:ui
pnpm test
pnpm test:e2e
```

## Install Into Paperclip

```bash
curl -X POST http://127.0.0.1:3100/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"packageName":"/Users/alvaro/Dev/alvarosanchez/paperclip-micronaut-plugin","isLocalPath":true}'
```

## Scaffold Notes

- `src/manifest.ts` intentionally keeps the smallest installable host contract: empty instance settings registration and no UI slots.
- `src/worker.ts` intentionally registers no data handlers, actions, jobs, or event subscriptions.
- `src/ui/index.tsx` is intentionally empty until this plugin needs a hosted Paperclip UI surface.

## Verification

- `pnpm test:e2e` builds the plugin, boots an isolated Paperclip instance, installs the plugin, and verifies the plugin appears in Paperclip's installed-plugins settings page through Playwright.
- `pnpm verify:manual` builds the plugin, boots a Paperclip instance for manual inspection, installs the plugin, and opens the installed-plugins settings page in your browser.
- The smoke test writes the latest screenshot and page snapshot metadata to `tests/e2e/results/`.
- Set `PAPERCLIP_E2E_PORT` or `PAPERCLIP_E2E_DB_PORT` if you need fixed ports for the disposable instance.
- Set `PAPERCLIP_E2E_STATE_DIR` before `pnpm verify:manual` if you want to keep the Paperclip state directory between runs.
