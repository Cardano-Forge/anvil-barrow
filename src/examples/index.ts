import { spawn } from "node:child_process";
import { join } from "node:path";

const basePath = "src/examples";

const [script] = process.argv.slice(2);

if (!script) {
  console.error("Usage: npm run example <example>\n");
  console.error(`Note: examples are located in ${basePath}`);
  process.exit(1);
}

const scriptPath = join(basePath, `${script}.ts`);

const child = spawn("dotenv", ["-c", "--", "tsx", scriptPath], {
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => {
  process.exit(code);
});
