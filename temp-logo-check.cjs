const fs = require('node:fs');
const svg = fs.readFileSync('assets/app-icon.svg', 'utf8');
const tsx = fs.readFileSync('src/components/Logo.tsx', 'utf8');

const grabAll = (s, re) => [...s.matchAll(re)].map((m) => (m[1] === undefined ? m[0] : m[1]));

function compare(name, svgList, tsxList) {
  const same = svgList.length === tsxList.length && svgList.every((v, i) => v === tsxList[i]);
  console.log(name + ':', same ? 'IDENTICAL (' + svgList.length + ')' : 'MISMATCH (' + svgList.length + ' vs ' + tsxList.length + ')');
  if (!same) {
    const n = Math.max(svgList.length, tsxList.length);
    for (let i = 0; i < n; i++) {
      if (svgList[i] !== tsxList[i]) console.log('  [' + i + '] svg=' + (svgList[i] ?? '') + ' tsx=' + (tsxList[i] ?? ''));
    }
  }
}

compare('d-paths', grabAll(svg, / d="([^"]+)"/g), grabAll(tsx, /\bd="([^"]+)"/g));
compare('transforms', grabAll(svg, /transform="([^"]+)"/g), grabAll(tsx, /transform="([^"]+)"/g));
compare('circle-cx', grabAll(svg, /cx="([^"]+)"/g), grabAll(tsx, /cx="([^"]+)"/g));
compare('circle-cy', grabAll(svg, /cy="([^"]+)"/g), grabAll(tsx, /cy="([^"]+)"/g));
compare('circle-r', grabAll(svg, / r="([^"]+)"/g), grabAll(tsx, /\br="([^"]+)"/g));
compare('rect-size', grabAll(svg, /<rect[^>]*\/?>/g).map((x) => x.replace(/\s+/g, ' ').trim()), grabAll(tsx, /<rect[\s\S]*?\/>/g).map((x) => x.replace(/\s+/g, ' ').trim()));
