import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "src/app/icon.svg"));

await sharp(svg, { density: 384 })
  .resize(180, 180)
  .png()
  .toFile(join(root, "src/app/apple-icon.png"));

console.log("Wrote src/app/apple-icon.png");
