import sharp from "sharp";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SOURCE = resolve(ROOT, "src/public/madame_logo.png");
const OUT = resolve(ROOT, "src/public/madame_icon.png");

const CANVAS = 1024;
const SQUIRCLE = 824;
const SQUIRCLE_OFFSET = (CANVAS - SQUIRCLE) / 2;
const SQUIRCLE_RADIUS = 184;
const ART_SIZE = 580;
const ART_OFFSET = (CANVAS - ART_SIZE) / 2;

const squircleSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${SQUIRCLE}" height="${SQUIRCLE}">
  <rect x="0" y="0" width="${SQUIRCLE}" height="${SQUIRCLE}"
        rx="${SQUIRCLE_RADIUS}" ry="${SQUIRCLE_RADIUS}" fill="#ffffff"/>
</svg>
`);

const art = await sharp(SOURCE)
  .resize(ART_SIZE, ART_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toBuffer();

await sharp({
  create: {
    width: CANVAS,
    height: CANVAS,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([
    { input: squircleSvg, left: SQUIRCLE_OFFSET, top: SQUIRCLE_OFFSET },
    { input: art, left: ART_OFFSET, top: ART_OFFSET },
  ])
  .png()
  .toFile(OUT);

console.log(`Wrote ${OUT}`);
