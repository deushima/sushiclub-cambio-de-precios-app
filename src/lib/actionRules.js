import { normalizeKey, normalizeSearch } from './text.js';

export const ACTION_PRESETS = [
  {
    id: '2-tiempos',
    label: '2 Tiempos',
    productIncludes: ['2 tiempos'],
    folderNames: ['2 Tiempos'],
    exact: true,
    exceptionTemplates: ['PILAR', 'URQUIZA'],
  },
  {
    id: '3-tiempos',
    label: '3 Tiempos',
    productIncludes: ['3 tiempos'],
    folderNames: ['3 Tiempos'],
    exact: true,
    exceptionTemplates: [],
  },
  {
    id: '3-tiempos-plant-based',
    label: '3 Tiempos Plant-Based',
    productIncludes: ['3 tiempos plant-based'],
    folderNames: ['3 Tiempos Plant-Based'],
    exact: true,
    exceptionTemplates: [],
  },
  {
    id: 'menu-club-ejecutivo',
    label: 'Club Ejecutivo',
    productIncludes: ['menu club ejecutivo'],
    folderNames: ['Menu Club Ejecutivo', 'Menú Club Ejecutivo'],
    exact: false,
    exceptionTemplates: ['BAHIA BLANCA'],
  },
];

function productMatchesPreset(product, preset) {
  const productName = normalizeSearch(product?.name ?? '');
  return preset.productIncludes.some((name) => {
    const normalized = normalizeSearch(name);
    return preset.exact ? productName === normalized : productName.includes(normalized);
  });
}

export function findPresetForProduct(product) {
  return ACTION_PRESETS.find((preset) => productMatchesPreset(product, preset)) ?? null;
}

export function actionOptionsForProducts(products) {
  const presetOptions = ACTION_PRESETS.map((preset) => {
    const product = products.find((item) => productMatchesPreset(item, preset));
    if (!product) return null;
    return {
      ...preset,
      product,
      productKey: product.key,
    };
  }).filter(Boolean);

  const used = new Set(presetOptions.map((option) => option.productKey));
  const otherOptions = products
    .filter((product) => product.priceCount > 0 && !used.has(product.key))
    .slice(0, 24)
    .map((product) => ({
      id: product.key,
      label: product.name,
      product,
      productKey: product.key,
      productIncludes: [product.name],
      exact: true,
      exceptionTemplates: [],
    }));

  return [...presetOptions, ...otherOptions];
}

export function ruleForProduct(product) {
  const preset = findPresetForProduct(product);
  if (preset) return preset;

  return {
    id: product?.key ?? 'custom',
    label: product?.name ?? 'Accion',
    productIncludes: [product?.name ?? ''],
    exact: true,
    exceptionTemplates: [],
  };
}

export function templateKey(value) {
  const key = normalizeKey(value);
  if (!key) return 'general';
  return key;
}

export function templateLabel(value) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean || 'GENERAL';
}

export function isExceptionRow(row, actionRule) {
  const exceptionKeys = new Set((actionRule?.exceptionTemplates ?? []).map(templateKey));
  return exceptionKeys.has(row.branchKey);
}

export function templateForRow(row, actionRule) {
  return isExceptionRow(row, actionRule) ? row.branchName : 'GENERAL';
}

export function templateKeysForRule(actionRule) {
  return ['GENERAL', ...(actionRule?.exceptionTemplates ?? [])];
}

export function actionFolderKeysForRule(actionRule, productName = '') {
  const labels = [
    ...(actionRule?.folderNames ?? []),
    actionRule?.label,
    ...(actionRule?.productIncludes ?? []),
    productName,
  ];

  return new Set(labels.map(normalizeKey).filter(Boolean));
}
