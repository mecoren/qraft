function computeFoldSummary(getLine, startLine, endLine) {
  if (endLine <= startLine + 1) { console.log('hit guard1'); return null; }
  const firstLine = getLine(startLine);
  const lastLine = getLine(endLine);
  console.log('first=', JSON.stringify(firstLine), 'last=', JSON.stringify(lastLine));
  const isObject = firstLine.includes('{') && lastLine.includes('}');
  const isArray = firstLine.includes('[') && lastLine.includes(']');
  console.log('isObject=', isObject, 'isArray=', isArray);
  if (!isObject && !isArray) return null;
  let depth = 0, commas = 0, hasItem = false;
  for (let line = startLine + 1; line < endLine; line++) {
    const content = getLine(line);
    for (let i = 0; i < content.length; i++) {
      const ch = content[i];
      if (ch === '{' || ch === '[') { depth++; hasItem = true; }
      else if (ch === '}' || ch === ']') { depth--; }
      else if (ch === ',' && depth === 0 && hasItem) { commas++; }
    }
  }
  console.log('commas=', commas, 'hasItem=', hasItem);
  if (!hasItem) return null;
  return { count: commas + 1, kind: isObject ? 'object' : 'array' };
}
const lines = ['{', '  "a": 1,', '  "b": 2,', '  "c": 3', '}'];
console.log('result:', JSON.stringify(computeFoldSummary((n)=>lines[n-1], 1, 5)));