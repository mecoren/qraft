const sharp = require('sharp');
const path = require('path');

(async () => {
  for (const f of ['assets/logo-transparent.png', 'assets/logo-inverted.png', 'public/favicon.png']) {
    const file = path.join(process.cwd(), f);
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    let transparent = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 16) transparent += 1;
    }
    const total = info.width * info.height;
    console.log(`${f}: transparent=${transparent}/${total} (${((100 * transparent) / total).toFixed(1)}%)`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
