import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { chromiumLaunchOptions } from "../playwright-browser.mjs";

const directory = mkdtempSync(join(tmpdir(), "mulazama-browser-options-"));
after(() => rmSync(directory, { recursive: true, force: true }));

test("default selection leaves the pinned Playwright browser in control", () => {
  assert.deepEqual(chromiumLaunchOptions({}), { channel: undefined });
  assert.deepEqual(chromiumLaunchOptions({ PW_CHANNEL: "" }), {
    channel: undefined,
  });
});

test("PW_CHANNEL keeps its existing selection semantics without an override", () => {
  assert.deepEqual(chromiumLaunchOptions({ PW_CHANNEL: "chrome" }), {
    channel: "chrome",
  });
});

test("an explicitly selected executable is returned without extra launch flags", () => {
  const environment = Object.freeze({
    MULAZAMA_CHROMIUM_EXECUTABLE_PATH: process.execPath,
  });
  assert.deepEqual(chromiumLaunchOptions(environment), {
    executablePath: process.execPath,
  });
});

test("an executable symlink is valid for system browser entry points", () => {
  const executablePath = join(directory, "browser-link");
  symlinkSync(process.execPath, executablePath);
  assert.deepEqual(
    chromiumLaunchOptions({ MULAZAMA_CHROMIUM_EXECUTABLE_PATH: executablePath }),
    { executablePath },
  );
});

test("relative executable paths are rejected before browser launch", () => {
  assert.throws(
    () => chromiumLaunchOptions({ MULAZAMA_CHROMIUM_EXECUTABLE_PATH: "./chromium" }),
    /must be a nonempty absolute executable file path/,
  );
});

test("an explicitly empty executable path fails instead of silently falling back", () => {
  assert.throws(
    () => chromiumLaunchOptions({ MULAZAMA_CHROMIUM_EXECUTABLE_PATH: "" }),
    /must be a nonempty absolute executable file path/,
  );
});

test("missing executable files are rejected", () => {
  assert.throws(
    () => chromiumLaunchOptions({
      MULAZAMA_CHROMIUM_EXECUTABLE_PATH: join(directory, "missing-browser"),
    }),
    /is not an executable file/,
  );
});

test("directories are rejected even when searchable", () => {
  assert.throws(
    () => chromiumLaunchOptions({ MULAZAMA_CHROMIUM_EXECUTABLE_PATH: directory }),
    /is not an executable file/,
  );
});

test("files without execute permission are rejected", () => {
  const executablePath = join(directory, "not-executable");
  writeFileSync(executablePath, "not a browser");
  chmodSync(executablePath, 0o600);
  assert.throws(
    () => chromiumLaunchOptions({ MULAZAMA_CHROMIUM_EXECUTABLE_PATH: executablePath }),
    /is not an executable file/,
  );
});

test("an explicit path and PW_CHANNEL cannot select different browsers", () => {
  assert.throws(
    () => chromiumLaunchOptions({
      MULAZAMA_CHROMIUM_EXECUTABLE_PATH: process.execPath,
      PW_CHANNEL: "chrome",
    }),
    /cannot be combined with PW_CHANNEL/,
  );
});
