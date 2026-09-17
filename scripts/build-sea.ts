// Builds a Node single-executable application (SEA) binary from this repository's tsdown-bundled dist-sea/sea-entry.cjs (see tsdown.config.ts's seaEntryBuildConfig), for whichever platform this script runs on — one call per platform cell of the CI matrix, never cross-compiled: node --build-sea copies the CURRENT running node binary, so the platform this script runs under is the platform the resulting binary targets. Uses the single `node --build-sea` flag (Node 25.5.0+, https://nodejs.org/api/single-executable-applications.html), not the older two-step --experimental-sea-config-then-postject workflow that flag replaced: --build-sea generates the preparation blob and injects it into a copy of the running binary in one internal step, writing the finished executable straight to sea-config.json's own "output" path.
//
// Pattern follows ExaDev/documents.js's .github/scripts/build-sea-binary.ts, which proved each of the non-obvious steps below in real CI runs.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

export type SeaPlatform = "darwin" | "linux" | "win32";
export type SeaArch = "arm64" | "x64";

/** Node's SEA `mainFormat`, derived from the bundle's own extension — tsdown's seaEntryBuildConfig always writes .cjs (fixedExtension), so the extension is an unambiguous single source of truth. */
function mainFormatFor(bundlePath: string): "commonjs" | "module" {
  return bundlePath.endsWith(".mjs") ? "module" : "commonjs";
}

// Human-readable platform label for the asset name — "macos"/"linux"/ "windows" rather than Node's "darwin"/"linux"/"win32", matching how every other cross-platform release asset on GitHub names itself.
const PLATFORM_LABELS: Record<SeaPlatform, string> = {
  darwin: "macos",
  linux: "linux",
  win32: "windows",
};

/** Platform-and-architecture-qualified file name: every (platform, arch) pair gets a distinct name, not only win32's .exe, because every release leg uploads to the same GitHub Release via `gh release upload --clobber` — a platform-only name shared between the two macOS (or two Linux) legs silently loses one binary to the other's upload. */
function binaryFileName(
  binaryName: string,
  platform: SeaPlatform,
  arch: SeaArch,
): string {
  const suffixed = `${binaryName}-${PLATFORM_LABELS[platform]}-${arch}`;
  return platform === "win32" ? `${suffixed}.exe` : suffixed;
}

/** macOS refuses to run an unsigned binary at all, so an ad-hoc signature (codesign --sign -, no certificate, no Apple Developer account) is required for the binary to launch. --force is load-bearing, not optional: --build-sea copies whichever Node binary built it, and every officially distributed Node build already carries a real code signature — codesign --sign - alone against such a binary exits 1 ("is already signed") without --force. Linux needs no signing; Windows ships unsigned (SmartScreen may warn, as for any unsigned .exe). */
function postBuildCommandsFor(
  platform: SeaPlatform,
  binaryPath: string,
): readonly (readonly [string, readonly string[]])[] {
  if (platform === "darwin") {
    return [["codesign", ["--sign", "-", "--force", binaryPath]]];
  }
  return [];
}

// stdout is redirected to this process's own stderr (fd 2), never inherited directly, so the calling CI step's $(node build-sea.ts ...) capture sees nothing from these child processes, just this file's own final console.log(binaryPath). node --build-sea prints an informational "Generated single executable ..." line to stdout, which corrupts exactly that capture (proven in documents.js CI): the captured value carries two lines, and a bare path line breaks the step's >> "$GITHUB_OUTPUT" write.
function run(command: string, args: readonly string[]): void {
  execFileSync(command, args, { stdio: ["inherit", 2, "inherit"] });
}

const ROOT = join(import.meta.dirname, "..");
const BUNDLE_PATH = join(ROOT, "dist-sea", "sea-entry.cjs");

function assertBundle(): string {
  if (!existsSync(BUNDLE_PATH)) {
    throw new Error(
      `Expected ${BUNDLE_PATH} to exist — run this repository's own build (which produces dist-sea/) first.`,
    );
  }
  return BUNDLE_PATH;
}

function currentPlatform(): SeaPlatform {
  const { platform } = process;
  if (platform === "darwin" || platform === "linux" || platform === "win32") {
    return platform;
  }
  throw new Error(
    `No Node SEA binary target is defined for platform "${platform}".`,
  );
}

function currentArch(): SeaArch {
  const { arch } = process;
  if (arch === "arm64" || arch === "x64") {
    return arch;
  }
  throw new Error(
    `No Node SEA binary target is defined for architecture "${arch}".`,
  );
}

function main(): void {
  const bundlePath = assertBundle();
  const platform = currentPlatform();
  const arch = currentArch();
  const outputDir = join(ROOT, "dist-sea");
  mkdirSync(outputDir, { recursive: true });

  const binaryPath = join(outputDir, binaryFileName("cc-peer", platform, arch));
  const configPath = join(outputDir, "sea-config.json");
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        main: bundlePath,
        output: binaryPath,
        mainFormat: mainFormatFor(bundlePath),
        disableExperimentalSEAWarning: true,
      },
      null,
      2,
    )}\n`,
  );

  run(process.execPath, ["--build-sea", configPath]);
  for (const [command, args] of postBuildCommandsFor(platform, binaryPath)) {
    run(command, args);
  }
  console.log(binaryPath);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
