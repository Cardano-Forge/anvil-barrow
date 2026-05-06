import { copyFile, writeFile } from "node:fs/promises";
import { defineConfig } from "tsup";
import pkgJson from "./package.json" with { type: "json" };

const entry = {
  index: "src/index.ts",
  otel: "src/dep/otel.ts",
  pino: "src/dep/pino.ts",
  ogmios: "src/dep/ogmios/index.ts",
};

export default defineConfig({
  entry,
  dts: true,
  format: ["cjs", "esm"],
  clean: true,
  plugins: [
    {
      name: "Copy package files",
      buildEnd: async () => {
        await copyFile("./README.md", "dist/README.md");
        await writeFile(
          "./dist/package.json",
          JSON.stringify(
            {
              ...pkgJson,
              exports: Object.keys(entry).reduce<Record<string, unknown>>(
                (acc, entry) => {
                  let key: string;
                  if (entry === "index") key = ".";
                  else key = `./${entry}`;

                  acc[key] = {
                    require: {
                      types: `./${entry}.d.ts`,
                      require: `./${entry}.js`,
                    },
                    import: {
                      types: `./${entry}.d.mts`,
                      import: `./${entry}.mjs`,
                    },
                  };

                  return acc;
                },
                { "./package.json": "./package.json" },
              ),
            },
            null,
            2,
          ),
        );
      },
    },
  ],
});
