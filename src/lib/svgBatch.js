import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { cleanText, formatPrice, normalizeKey, slugFolder } from './text.js';

function tokenText(value) {
  return cleanText(value).replace(/[\s\u00a0]/g, '');
}

function isNormalPlaceholder(value) {
  return /^\${2,}$/.test(tokenText(value));
}

function isEminentPlaceholder(value) {
  return /^@{2,}$/.test(tokenText(value));
}

function parseSvg(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const error = doc.querySelector('parsererror');
  if (error) {
    throw new Error(cleanText(error.textContent) || 'SVG invalido.');
  }
  return doc;
}

function selectablePlaceholders(doc, matcher) {
  const elements = Array.from(doc.querySelectorAll('text, tspan')).filter((element) =>
    matcher(element.textContent)
  );
  const matched = new Set(elements);

  return elements.filter((element) => {
    const children = Array.from(element.querySelectorAll('text, tspan'));
    return !children.some((child) => child !== element && matched.has(child));
  });
}

export function inspectSvg(svgText) {
  const doc = parseSvg(svgText);
  return {
    normalCount: selectablePlaceholders(doc, isNormalPlaceholder).length,
    eminentCount: selectablePlaceholders(doc, isEminentPlaceholder).length,
  };
}

export function replaceSvgPrices(svgText, priceRow) {
  const doc = parseSvg(svgText);
  const normalNodes = selectablePlaceholders(doc, isNormalPlaceholder);
  const eminentNodes = selectablePlaceholders(doc, isEminentPlaceholder);
  const normalText = formatPrice(priceRow.normal);
  const eminentText = formatPrice(priceRow.eminent);
  const warnings = [];

  if (!normalText) warnings.push('Sin precio normal.');
  if (!eminentText) warnings.push('Sin precio Eminent.');
  if (!normalNodes.length) warnings.push('No se encontro placeholder $$$$.');
  if (!eminentNodes.length) warnings.push('No se encontro placeholder @@@@.');

  normalNodes.forEach((node) => {
    node.textContent = normalText || '';
  });

  eminentNodes.forEach((node) => {
    node.textContent = eminentText || '';
  });

  const serializer = new XMLSerializer();
  return {
    svgText: serializer.serializeToString(doc),
    stats: {
      normalCount: normalNodes.length,
      eminentCount: eminentNodes.length,
    },
    warnings,
  };
}

function splitPath(file) {
  const source = file.webkitRelativePath || file.name;
  return source.split('/').filter(Boolean);
}

function stripCommonRoot(parts, commonRoot) {
  if (commonRoot && parts[0] === commonRoot) return parts.slice(1);
  return parts;
}

function commonRoot(files) {
  if (!files.length) return '';
  const first = splitPath(files[0])[0];
  if (!first) return '';
  return files.every((file) => splitPath(file)[0] === first) ? first : '';
}

function findTargetFromPath(parts, priceRows) {
  const pathKeys = parts.map((part) => normalizeKey(part.replace(/\.svg$/i, '')));
  return (
    priceRows.find((row) => pathKeys.some((key) => key === row.branchKey || key === normalizeKey(row.folderName))) ??
    null
  );
}

function removeTargetSegment(parts, target) {
  const targetKeys = new Set([target.branchKey, normalizeKey(target.folderName)]);
  const index = parts.findIndex((part) => targetKeys.has(normalizeKey(part.replace(/\.svg$/i, ''))));
  if (index < 0) return parts;
  return [...parts.slice(0, index), ...parts.slice(index + 1)];
}

function safeZipPath(parts) {
  return parts.map(slugFolder).filter(Boolean).join('/');
}

async function buildManifestRows(results) {
  const header = ['archivo', 'local', 'grupo_excel', 'canal', 'precio_normal', 'precio_eminent', 'estado'];
  const rows = results.map((result) => [
    result.outputPath,
    result.priceRow.branchName,
    result.priceRow.groupName,
    result.priceRow.channel.toUpperCase(),
    formatPrice(result.priceRow.normal),
    formatPrice(result.priceRow.eminent),
    result.warnings.length ? result.warnings.join(' | ') : 'OK',
  ]);

  return [header, ...rows]
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
        .join(',')
    )
    .join('\n');
}

export async function analyzeSvgFiles(files) {
  const svgFiles = files.filter((file) => file.name.toLowerCase().endsWith('.svg'));

  const results = [];
  for (const file of svgFiles) {
    try {
      const text = await file.text();
      const stats = inspectSvg(text);
      results.push({
        name: file.name,
        path: file.webkitRelativePath || file.name,
        ok: stats.normalCount > 0 && stats.eminentCount > 0,
        ...stats,
      });
    } catch (error) {
      results.push({
        name: file.name,
        path: file.webkitRelativePath || file.name,
        ok: false,
        normalCount: 0,
        eminentCount: 0,
        error: error.message,
      });
    }
  }

  return results;
}

export async function exportPriceZip({ svgFiles, priceRows, productName, smartFolderMatching = true }) {
  const files = svgFiles.filter((file) => file.name.toLowerCase().endsWith('.svg'));
  if (!files.length) throw new Error('No hay archivos SVG para exportar.');
  if (!priceRows.length) throw new Error('No hay locales seleccionados.');

  const root = commonRoot(files);
  const zip = new JSZip();
  const results = [];

  for (const file of files) {
    const rawParts = stripCommonRoot(splitPath(file), root);
    const pathParts = rawParts.length ? rawParts : [file.name];
    const matchedTarget = smartFolderMatching ? findTargetFromPath(pathParts, priceRows) : null;
    const targets = matchedTarget ? [matchedTarget] : priceRows;
    const svgText = await file.text();

    for (const priceRow of targets) {
      const relativeParts = matchedTarget ? removeTargetSegment(pathParts, matchedTarget) : pathParts;
      const outputParts = [priceRow.folderName, ...relativeParts];
      const outputPath = safeZipPath(outputParts);
      const processed = replaceSvgPrices(svgText, priceRow);

      zip.file(outputPath, processed.svgText);
      results.push({
        inputPath: file.webkitRelativePath || file.name,
        outputPath,
        priceRow,
        warnings: processed.warnings,
      });
    }
  }

  const manifest = await buildManifestRows(results);
  zip.file('_reporte_precios.csv', manifest);

  const blob = await zip.generateAsync({ type: 'blob' });
  const safeProduct = slugFolder(productName || 'accion').replace(/\s+/g, '-').toLowerCase();
  saveAs(blob, `sushiclub-${safeProduct}-precios.zip`);

  return {
    fileCount: files.length,
    generatedCount: results.length,
    warningCount: results.filter((result) => result.warnings.length).length,
    results,
  };
}
