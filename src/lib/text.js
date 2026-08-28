export function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

export function normalizeKey(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' y ')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
}

export function normalizeSearch(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function slugFolder(value) {
  const cleaned = cleanText(value)
    .replace(/[<>:"\\|?*]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'SIN NOMBRE';
}

export function formatPrice(value) {
  if (value === null || value === undefined || value === '') return '';
  const raw = String(value).trim();
  if (raw === '-') return '';
  const number = typeof value === 'number' ? value : Number(raw.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(number)) return '';
  const rounded = Math.round(number);
  return `$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(rounded)}`;
}

export function humanNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return cleanText(value);
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(number));
}
