import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute } from "node:path";

/** Keep Playwright's pinned browser unless the caller explicitly selects another. */
export function chromiumLaunchOptions(environment = process.env) {
  const channel = environment.PW_CHANNEL || undefined;
  const executablePath = environment.MULAZAMA_CHROMIUM_EXECUTABLE_PATH;
  if (executablePath === undefined) return { channel };
  if (channel) {
    throw new Error(
      "MULAZAMA_CHROMIUM_EXECUTABLE_PATH cannot be combined with PW_CHANNEL.",
    );
  }
  if (typeof executablePath !== "string" || !isAbsolute(executablePath)) {
    throw new Error(
      "MULAZAMA_CHROMIUM_EXECUTABLE_PATH must be a nonempty absolute executable file path.",
    );
  }
  try {
    if (!statSync(executablePath).isFile()) throw new Error("Not a file");
    accessSync(executablePath, constants.X_OK);
  } catch (cause) {
    throw new Error(
      `MULAZAMA_CHROMIUM_EXECUTABLE_PATH is not an executable file: ${executablePath}`,
      { cause },
    );
  }
  return { executablePath };
}
