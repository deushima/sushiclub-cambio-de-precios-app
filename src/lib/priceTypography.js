export const PRICE_FONT_FAMILIES = [
  'Acumin Pro',
  'Acumin Pro Wide',
  'Acumin Pro SemiCond',
  'Acumin Pro Cond',
  'Acumin Pro ExtraCond',
];

export const PRICE_FONT_WEIGHTS = [
  { id: 'Thin', label: 'Thin', cssWeight: 100 },
  { id: 'ExtraLight', label: 'ExtraLight', cssWeight: 200 },
  { id: 'Light', label: 'Light', cssWeight: 300 },
  { id: 'Book', label: 'Book', cssWeight: 400 },
  { id: 'Medium', label: 'Medium', cssWeight: 500 },
  { id: 'Semibold', label: 'Semibold', cssWeight: 600 },
  { id: 'Bold', label: 'Bold', cssWeight: 700 },
  { id: 'Black', label: 'Black', cssWeight: 800 },
  { id: 'UltraBlack', label: 'UltraBlack', cssWeight: 900 },
];

export const PRICE_FONT_STYLES = [
  { id: 'normal', label: 'Normal' },
  { id: 'italic', label: 'Italic' },
];

export const DEFAULT_PRICE_TYPOGRAPHY = {
  family: 'Acumin Pro',
  weight: 'Semibold',
  style: 'normal',
};

const BASE_URL = import.meta.env?.BASE_URL ?? '/';

function fontBaseUrl() {
  return BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
}

export function priceFontFileName({ family, weight, style }) {
  const italicSuffix = style === 'italic' ? ' Italic' : '';
  return `${family} ${weight}${italicSuffix}.otf`;
}

export function priceFontUrl(fileName) {
  return `${fontBaseUrl()}fonts/acumin/${encodeURIComponent(fileName)}`;
}

export function resolvePriceTypography(settings = {}) {
  const family = PRICE_FONT_FAMILIES.includes(settings.family)
    ? settings.family
    : DEFAULT_PRICE_TYPOGRAPHY.family;
  const weight = PRICE_FONT_WEIGHTS.some((item) => item.id === settings.weight)
    ? settings.weight
    : DEFAULT_PRICE_TYPOGRAPHY.weight;
  const style = PRICE_FONT_STYLES.some((item) => item.id === settings.style)
    ? settings.style
    : DEFAULT_PRICE_TYPOGRAPHY.style;
  const weightOption = PRICE_FONT_WEIGHTS.find((item) => item.id === weight);
  const fileName = priceFontFileName({ family, weight, style });

  return {
    family,
    weight,
    style,
    cssWeight: weightOption?.cssWeight ?? 600,
    fileName,
    url: priceFontUrl(fileName),
  };
}
