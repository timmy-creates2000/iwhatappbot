---
name: libsql native binary fix
description: How to fix @libsql/linux-x64-gnu MODULE_NOT_FOUND when running esbuild-bundled server
---

When the esbuild bundle runs from `artifacts/api-server/dist/`, the `libsql` native binary (`@libsql/linux-x64-gnu`) can't be found because pnpm's virtual store doesn't place it in a discoverable path.

**Fix:** Symlink the native packages directly into `artifacts/api-server/node_modules/`:

```bash
ln -sf /home/runner/workspace/node_modules/.pnpm/libsql@0.4.7/node_modules/libsql \
  /home/runner/workspace/artifacts/api-server/node_modules/libsql

mkdir -p /home/runner/workspace/artifacts/api-server/node_modules/@libsql
ln -sf /home/runner/workspace/node_modules/.pnpm/@libsql+linux-x64-gnu@0.4.7/node_modules/@libsql/linux-x64-gnu \
  /home/runner/workspace/artifacts/api-server/node_modules/@libsql/linux-x64-gnu
```

**Why:** pnpm virtual store keeps native binaries under `.pnpm/<pkg>/node_modules/` with no top-level `node_modules/@libsql` entry. The bundled dist/ can't walk up to find them. Direct symlinks bypass this.

**How to apply:** Run after `pnpm install` if the symlinks are missing (e.g. after a fresh clone). The build.mjs also creates a `dist/node_modules` → workspace root symlink, but that alone isn't sufficient because `@libsql/linux-x64-gnu` isn't at the root level either.
