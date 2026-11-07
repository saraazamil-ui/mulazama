import { readFile } from 'node:fs/promises';
import ts from 'typescript';

/** The audited TS module is import-free. Transpile it in memory without creating
 * a second implementation, changing source, or adding a production dependency. */
export async function loadContentAudit() {
  const source = await readFile(new URL('../src/content/integrity.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
}
