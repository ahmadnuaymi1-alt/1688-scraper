const CM_PER_INCH = 2.54;
const GRAMS_PER_LB = 453.59237;

export function cmToInches(cm: number): number {
  return cm / CM_PER_INCH;
}

export function gramsToLbs(g: number): number {
  return g / GRAMS_PER_LB;
}

export function formatLengthIn(cm: number, decimals = 1): string {
  return `${cmToInches(cm).toFixed(decimals)}"`;
}

export function formatWeightLb(g: number): string {
  return `${gramsToLbs(g).toFixed(2)} lb`;
}

const CM_GROUP_PATTERN =
  /(\d+(?:\.\d+)?(?:\s*[×xX*]\s*\d+(?:\.\d+)?){0,2})\s*cm\b/g;

export function convertPkgDimsStringToInches(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(CM_GROUP_PATTERN, (_match, numberGroup: string) => {
    const parts = numberGroup
      .split(/\s*[×xX*]\s*/)
      .map((n) => parseFloat(n))
      .filter((n) => Number.isFinite(n));
    if (parts.length === 0) return _match;
    return parts.map((n) => formatLengthIn(n, 1)).join(" × ");
  });
}

const PAREN_CM_PATTERN = /\(([^()]*?)\)/g;

export function convertParenCmToInches(s: string): string {
  return s.replace(PAREN_CM_PATTERN, (_match, inner: string) => {
    if (!/\bcm\b/i.test(inner)) return _match;
    const rewritten = inner.replace(
      CM_GROUP_PATTERN,
      (_m, numberGroup: string) => {
        const parts = numberGroup
          .split(/\s*[×xX*]\s*/)
          .map((n) => parseFloat(n))
          .filter((n) => Number.isFinite(n));
        if (parts.length === 0) return _m;
        return parts.map((n) => formatLengthIn(n, 0)).join(" × ");
      },
    );
    return `(${rewritten})`;
  });
}

const SHAPE_PREFIX_PATTERN =
  /\b(Round|Square|Rectangle|Oval|Circular|Circle)\b(\s+)(\d+(?:\.\d+)?(?:\s*[×xX*]\s*\d+(?:\.\d+)?){0,2})\s*cm\b/gi;

export function reshapeVariantSizeToInches(value: string | null | undefined): string {
  if (!value) return value ?? "";
  let out = convertParenCmToInches(value);
  out = out.replace(
    SHAPE_PREFIX_PATTERN,
    (_m, shape: string, _ws: string, numbers: string) => {
      const parts = numbers
        .split(/\s*[×xX*]\s*/)
        .map((n) => parseFloat(n))
        .filter((n) => Number.isFinite(n));
      if (parts.length === 0) return _m;
      const inches = parts.map((n) => formatLengthIn(n, 0)).join(" × ");
      const shapeCanonical = shape[0].toUpperCase() + shape.slice(1).toLowerCase();
      return `${shapeCanonical} (${inches})`;
    },
  );
  return out;
}
