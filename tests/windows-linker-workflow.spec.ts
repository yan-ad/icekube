import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("Windows jobs pin the MSVC x86 linker before executing Cargo", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const release = readFileSync(".github/workflows/release-unsigned.yml", "utf8");
  for (const workflow of [ci, release]) {
    const setup = workflow.indexOf("uses: ilammy/msvc-dev-cmd@v1");
    const pin = workflow.indexOf("uses: ./.github/actions/msvc-x86-linker", setup);
    const compile = workflow.indexOf("cargo check --manifest-path src-tauri/Cargo.toml", pin);
    expect(setup).toBeGreaterThanOrEqual(0);
    expect(pin).toBeGreaterThan(setup);
    expect(compile).toBeGreaterThan(pin);
  }
  expect(ci).toContain("shell: bash\n        run: cargo test --manifest-path xtask/Cargo.toml --locked --target i686-pc-windows-msvc verify_update::tests");
  expect(release).toContain("Prove signing key matches configured public key before packaging");
  expect(release).toContain("-- verify-update src-tauri/tauri.conf.json");
});

test("linker selection uses the initialized Visual Studio directory, never PATH lookup", () => {
  const action = readFileSync(".github/actions/msvc-x86-linker/action.yml", "utf8");
  expect(action).toContain("shell: pwsh");
  expect(action).toContain("$env:VCToolsInstallDir");
  expect(action).toContain("$env:VSCMD_ARG_TGT_ARCH -ne 'x86'");
  expect(action).toContain('"bin/Host$hostArch/x86/link.exe"');
  expect(action).toContain("Test-Path -LiteralPath $linker -PathType Leaf");
  expect(action).toContain("CARGO_TARGET_I686_PC_WINDOWS_MSVC_LINKER=$linker");
  expect(action).not.toMatch(/Get-Command\s+link|where(?:\.exe)?\s+link/i);
});
