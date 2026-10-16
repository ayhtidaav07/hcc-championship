import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "vitest") {
    const shimPath = path.resolve(process.cwd(), "scripts/vitest-shim.mjs");
    return nextResolve(pathToFileURL(shimPath).href, context);
  }

  if (specifier.startsWith("@/")) {
    const sub = specifier.slice(2);
    const basePath = path.resolve(process.cwd(), "src", sub);
    for (const ext of [".ts", ".tsx", ".js", "/index.ts", "/index.tsx"]) {
      const candidate = basePath + ext;
      if (fs.existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
  }

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      const parent = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
      const basePath = path.resolve(path.dirname(parent), specifier);
      for (const ext of [".ts", ".tsx", ".js", "/index.ts", "/index.tsx"]) {
        const candidate = basePath + ext;
        if (fs.existsSync(candidate)) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
    }
    throw err;
  }
}
