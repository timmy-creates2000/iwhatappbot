import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, symlink, mkdir, readdir } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      // NOTE: @google/genai is a runtime dependency — do NOT externalize it
      // via "@google/*" glob. It must be resolvable at runtime.
      // Only cloud SDK and googleapis (heavy optional) are excluded below.
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  // Symlink workspace root node_modules into dist/ so externalized packages
  // (like @libsql/* with native binaries) can be resolved at runtime.
  const distNodeModules = path.resolve(distDir, "node_modules");
  const workspaceNodeModules = path.resolve(artifactDir, "../../node_modules");
  await symlink(workspaceNodeModules, distNodeModules).catch(() => {});

  // ── libsql native binary fix ──────────────────────────────────────────────
  // pnpm's virtual store keeps @libsql/linux-x64-gnu under
  // .pnpm/<pkg>/node_modules/ with no top-level entry, so the bundled dist/
  // can't find it just from the workspace root symlink above.
  // We also symlink it directly into artifacts/api-server/node_modules/
  // so Node can resolve it when running from this artifact directory.
  await fixLibsqlNativeBinary(artifactDir, workspaceNodeModules);
}

/**
 * Finds the @libsql/linux-x64-gnu (or equivalent platform) native package
 * inside pnpm's virtual store and symlinks it into api-server/node_modules/
 * so the bundled dist can resolve it at runtime.
 */
async function fixLibsqlNativeBinary(artifactDir, workspaceNodeModules) {
  try {
    const pnpmStore = path.resolve(workspaceNodeModules, ".pnpm");
    let storeEntries;
    try {
      storeEntries = await readdir(pnpmStore);
    } catch {
      // No .pnpm dir — likely a flat node_modules (npm/yarn). Nothing to fix.
      return;
    }

    // Find the libsql and @libsql/linux-* entries in the pnpm store
    const libsqlEntry = storeEntries.find(
      (e) => e.startsWith("libsql@") || e.startsWith("libsql+")
    );
    const libsqlNativeEntry = storeEntries.find((e) =>
      /^@libsql\+(linux-(x64|arm64)-(gnu|musl)|win32-x64-msvc|darwin-(x64|arm64))@/.test(e)
    );

    const artifactNodeModules = path.resolve(artifactDir, "node_modules");
    await mkdir(artifactNodeModules, { recursive: true });
    const libsqlAtDir = path.resolve(artifactNodeModules, "@libsql");
    await mkdir(libsqlAtDir, { recursive: true });

    if (libsqlEntry) {
      const src = path.resolve(pnpmStore, libsqlEntry, "node_modules", "libsql");
      const dest = path.resolve(artifactNodeModules, "libsql");
      await symlink(src, dest).catch(() => {}); // ignore if already exists
    }

    if (libsqlNativeEntry) {
      // e.g. "@libsql+linux-x64-gnu@0.4.7" → folder name "@libsql/linux-x64-gnu"
      const folderName = libsqlNativeEntry
        .replace(/^(@libsql\+)/, "@libsql/")
        .replace(/@[\d.]+$/, "");
      const nativePkgName = folderName.replace("@libsql/", ""); // e.g. "linux-x64-gnu"
      const src = path.resolve(
        pnpmStore,
        libsqlNativeEntry,
        "node_modules",
        "@libsql",
        nativePkgName
      );
      const dest = path.resolve(libsqlAtDir, nativePkgName);
      await symlink(src, dest).catch(() => {}); // ignore if already exists
    }
  } catch (err) {
    // Non-fatal — log a warning but don't fail the build.
    // The dist/node_modules symlink may still resolve it on some setups.
    console.warn("[build] Warning: could not symlink libsql native binary:", err?.message ?? err);
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
