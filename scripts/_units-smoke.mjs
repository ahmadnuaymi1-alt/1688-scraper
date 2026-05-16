// Smoke test for unit conversion regexes. Mirrors src/lib/units.ts.
const CM_PER_INCH = 2.54;
const cmToInches = (cm) => cm / CM_PER_INCH;
const formatLengthIn = (cm, d = 1) => `${cmToInches(cm).toFixed(d)}"`;

const CM_GROUP_PATTERN =
  /(\d+(?:\.\d+)?(?:\s*[×xX*]\s*\d+(?:\.\d+)?){0,2})\s*cm\b/g;

function convertPkgDimsStringToInches(s) {
  return s.replace(CM_GROUP_PATTERN, (_m, numberGroup) => {
    const parts = numberGroup
      .split(/\s*[×xX*]\s*/)
      .map(parseFloat)
      .filter(Number.isFinite);
    if (parts.length === 0) return _m;
    return parts.map((n) => formatLengthIn(n, 1)).join(" × ");
  });
}

const PAREN_CM_PATTERN = /\(([^()]*?)\)/g;
function convertParenCmToInches(s) {
  return s.replace(PAREN_CM_PATTERN, (_match, inner) => {
    if (!/\bcm\b/i.test(inner)) return _match;
    const rewritten = inner.replace(CM_GROUP_PATTERN, (_m, numberGroup) => {
      const parts = numberGroup
        .split(/\s*[×xX*]\s*/)
        .map(parseFloat)
        .filter(Number.isFinite);
      if (parts.length === 0) return _m;
      return parts.map((n) => formatLengthIn(n, 0)).join(" × ");
    });
    return `(${rewritten})`;
  });
}

const SHAPE_PREFIX_PATTERN =
  /\b(Round|Square|Rectangle|Oval|Circular|Circle)\b(\s+)(\d+(?:\.\d+)?(?:\s*[×xX*]\s*\d+(?:\.\d+)?){0,2})\s*cm\b/gi;
function reshapeVariantSizeToInches(value) {
  if (!value) return value || "";
  let out = convertParenCmToInches(value);
  out = out.replace(SHAPE_PREFIX_PATTERN, (_m, shape, _ws, numbers) => {
    const parts = numbers
      .split(/\s*[×xX*]\s*/)
      .map(parseFloat)
      .filter(Number.isFinite);
    if (parts.length === 0) return _m;
    const inches = parts.map((n) => formatLengthIn(n, 0)).join(" × ");
    const shapeCanonical = shape[0].toUpperCase() + shape.slice(1).toLowerCase();
    return `${shapeCanonical} (${inches})`;
  });
  return out;
}

const cases = [
  ["Round 40 cm", 'Round (16")'],
  ["Round 50 cm", 'Round (20")'],
  ["Square 50 × 50 cm", 'Square (20" × 20")'],
  ["Rectangle 90 × 60 cm", 'Rectangle (35" × 24")'],
  ["Rectangle 105 × 65 cm", 'Rectangle (41" × 26")'],
  ["Round (40 cm)", 'Round (16")'],
  ["Square (50 × 50 cm)", 'Square (20" × 20")'],
  ["Round 40 cm, tri-color 2×24W", 'Round (16"), tri-color 2×24W'],
  ["Round (40 cm), tri-color 2×24W", 'Round (16"), tri-color 2×24W'],
];

let pass = 0;
let fail = 0;
for (const [input, expected] of cases) {
  const actual = reshapeVariantSizeToInches(input);
  const ok = actual === expected;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} | in: ${JSON.stringify(input)} | out: ${JSON.stringify(actual)} | expected: ${JSON.stringify(expected)}`);
}

console.log("--- pkg dims ---");
const dims = [
  ["30 × 20 × 15 cm", '11.8" × 7.9" × 5.9"'],
  ["Diameter 40 cm", 'Diameter 15.7"'],
  ["no metric here", "no metric here"],
];
for (const [input, expected] of dims) {
  const actual = convertPkgDimsStringToInches(input);
  const ok = actual === expected;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} | in: ${JSON.stringify(input)} | out: ${JSON.stringify(actual)} | expected: ${JSON.stringify(expected)}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
