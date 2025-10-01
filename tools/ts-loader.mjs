import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const compilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.Preserve,
  esModuleInterop: true,
};

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === 'next/server') {
    const result = await defaultResolve('next/server.js', context, defaultResolve);
    return { url: result.url, shortCircuit: true };
  }

  try {
    return await defaultResolve(specifier, context, defaultResolve);
  } catch (error) {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const withTs = specifier.endsWith('.ts') ? specifier : `${specifier}.ts`;
      const url = new URL(withTs, context.parentURL);
      return { url: url.href, shortCircuit: true };
    }
    throw error;
  }
}

export async function load(url, context, defaultLoad) {
  if (url.endsWith('.ts')) {
    const source = await readFile(new URL(url));
    const { outputText } = ts.transpileModule(source.toString(), { compilerOptions });
    return { format: 'module', source: outputText, shortCircuit: true };
  }

  return defaultLoad(url, context, defaultLoad);
}
