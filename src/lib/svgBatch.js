import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { cleanText, formatPrice, normalizeKey, slugFolder } from './text.js';
import { actionFolderKeysForRule, templateKey, templateLabel } from './actionRules.js';
import { resolvePriceTypography } from './priceTypography.js';

const { saveAs } = FileSaver;

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

function selectablePlaceholders(root, matcher) {
  const elements = Array.from(root.querySelectorAll('text, tspan')).filter((element) =>
    matcher(element.textContent)
  );
  const matched = new Set(elements);

  return elements.filter((element) => {
    const children = Array.from(element.querySelectorAll('text, tspan'));
    return !children.some((child) => child !== element && matched.has(child));
  });
}

function numberAttr(element, name) {
  const value = Number.parseFloat(element.getAttribute(name) ?? '');
  return Number.isFinite(value) ? value : null;
}

function nodeNumberAttr(element, name) {
  let node = element;
  while (node && node.nodeType === 1) {
    const value = numberAttr(node, name);
    if (value !== null) return value;
    node = node.parentElement;
  }
  return null;
}

function textElementFor(node) {
  let current = node;
  while (current && current.nodeType === 1) {
    if (current.tagName?.toLowerCase() === 'text') return current;
    current = current.parentElement;
  }
  return node;
}

function rectInfo(rect) {
  const x = numberAttr(rect, 'x');
  const y = numberAttr(rect, 'y');
  const width = numberAttr(rect, 'width');
  const height = numberAttr(rect, 'height');
  const rx = numberAttr(rect, 'rx') ?? 0;

  if (x === null || y === null || width === null || height === null) return null;
  if (width < 80 || height < 24 || rx < 8) return null;

  return { element: rect, x, y, width, height, centerX: x + width / 2, centerY: y + height / 2 };
}

function isBefore(source, target) {
  return Boolean(source.compareDocumentPosition(target) & 4);
}

function findNearestPill(root, node) {
  const textElement = textElementFor(node);
  const x = nodeNumberAttr(node, 'x');
  const y = nodeNumberAttr(node, 'y');
  if (x === null || y === null) return null;

  const candidates = Array.from(root.querySelectorAll('rect'))
    .map(rectInfo)
    .filter(Boolean)
    .filter((rect) => isBefore(rect.element, textElement))
    .map((rect) => {
      const insideY = y >= rect.y - rect.height * 0.35 && y <= rect.y + rect.height * 1.35;
      const insideX = x >= rect.x - rect.width * 0.2 && x <= rect.x + rect.width * 1.2;
      const verticalPenalty = insideY ? 0 : Math.abs(y - rect.centerY);
      const horizontalPenalty = insideX ? 0 : Math.abs(x - rect.centerX);
      return {
        ...rect,
        score: verticalPenalty * 3 + horizontalPenalty + Math.abs(rect.centerY - y) * 0.2,
      };
    })
    .sort((a, b) => a.score - b.score);

  return candidates[0] ?? null;
}

function estimateTextWidth(text, fontSize) {
  return Array.from(text).reduce((sum, char) => {
    if (char === '$') return sum + fontSize * 0.62;
    if (char === '.') return sum + fontSize * 0.3;
    if (char === ',') return sum + fontSize * 0.28;
    if (/\d/.test(char)) return sum + fontSize * 0.74;
    return sum + fontSize * 0.7;
  }, 0);
}

function visibleTextLength(node, fallbackText) {
  try {
    if (typeof node.getComputedTextLength === 'function') {
      const length = node.getComputedTextLength();
      if (Number.isFinite(length) && length > 0) return length;
    }

    const text = textElementFor(node);
    if (text && typeof text.getComputedTextLength === 'function') {
      const length = text.getComputedTextLength();
      if (Number.isFinite(length) && length > 0) return length;
    }
  } catch {
    return null;
  }

  const fontSize = nodeNumberAttr(node, 'font-size') ?? 42;
  return estimateTextWidth(fallbackText, fontSize);
}

function setFontSize(node, fontSize) {
  const text = textElementFor(node);
  const value = String(Number(fontSize.toFixed(3)));
  text?.setAttribute('font-size', value);
  node.setAttribute('font-size', value);
}

function applyPriceTypography(node, typography) {
  const text = textElementFor(node);
  if (!text) return;

  text.setAttribute('data-sushiclub-price', 'true');
  text.setAttribute('font-family', typography.family);
  text.setAttribute('font-weight', String(typography.cssWeight));
  text.setAttribute('font-style', typography.style);
  node.setAttribute('font-family', typography.family);
  node.setAttribute('font-weight', String(typography.cssWeight));
  node.setAttribute('font-style', typography.style);
}

function currentFontSize(node) {
  return nodeNumberAttr(node, 'font-size') ?? 42;
}

function centerAndFitPrice(node, priceText, pill, typography) {
  node.textContent = priceText || '';
  applyPriceTypography(node, typography);

  if (!pill) return;

  const text = textElementFor(node);
  const maxWidth = Math.max(1, pill.width - Math.max(38, pill.width * 0.18));

  text?.setAttribute('text-anchor', 'middle');
  node.setAttribute('x', String(Number(pill.centerX.toFixed(3))));
  node.removeAttribute('textLength');
  node.removeAttribute('lengthAdjust');

  const length = visibleTextLength(node, priceText);
  if (!length || length <= maxWidth) return;

  const baseFontSize = currentFontSize(node);
  const scale = Math.max(0.62, Math.min(1, maxWidth / length));
  setFontSize(node, baseFontSize * scale);

  const adjustedLength = visibleTextLength(node, priceText);
  if (adjustedLength && adjustedLength > maxWidth) {
    node.setAttribute('textLength', String(Number(maxWidth.toFixed(3))));
    node.setAttribute('lengthAdjust', 'spacingAndGlyphs');
  }
}

function cssString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function ensureFontFace(root, typography) {
  if (!typography.dataUrl) return;

  const doc = root.ownerDocument;
  const namespace = 'http://www.w3.org/2000/svg';
  let defs = root.querySelector('defs');
  if (!defs) {
    defs = doc.createElementNS(namespace, 'defs');
    root.insertBefore(defs, root.firstChild);
  }

  let style = defs.querySelector('#sushiclub-price-font-face');
  if (!style) {
    style = doc.createElementNS(namespace, 'style');
    style.setAttribute('id', 'sushiclub-price-font-face');
    defs.insertBefore(style, defs.firstChild);
  }

  style.textContent = `
@font-face {
  font-family: ${cssString(typography.family)};
  src: url("${typography.dataUrl}") format("opentype");
  font-weight: ${typography.cssWeight};
  font-style: ${typography.style};
}
text[data-sushiclub-price="true"] {
  font-family: ${cssString(typography.family)};
  font-weight: ${typography.cssWeight};
  font-style: ${typography.style};
}`.trim();
}

function measurableRoot(doc) {
  if (typeof document === 'undefined' || !document.body || !document.importNode) {
    return { root: doc.documentElement, cleanup: () => {} };
  }

  const holder = document.createElement('div');
  holder.style.position = 'absolute';
  holder.style.left = '-100000px';
  holder.style.top = '0';
  holder.style.width = '1px';
  holder.style.height = '1px';
  holder.style.overflow = 'hidden';

  const root = document.importNode(doc.documentElement, true);
  holder.appendChild(root);
  document.body.appendChild(holder);

  return {
    root,
    cleanup: () => holder.remove(),
  };
}

export function inspectSvg(svgText) {
  const doc = parseSvg(svgText);
  const ids = new Set(Array.from(doc.querySelectorAll('[id]')).map((element) => `#${element.id}`));
  const unresolvedImageCount = Array.from(doc.querySelectorAll('use')).filter((element) => {
    const href =
      element.getAttribute('href') ||
      element.getAttribute('xlink:href') ||
      element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
      '';
    return /^#image/i.test(href) && !ids.has(href);
  }).length;

  return {
    normalCount: selectablePlaceholders(doc, isNormalPlaceholder).length,
    eminentCount: selectablePlaceholders(doc, isEminentPlaceholder).length,
    unresolvedImageCount,
  };
}

export function replaceSvgPrices(svgText, priceRow, options = {}) {
  const doc = parseSvg(svgText);
  const { root, cleanup } = measurableRoot(doc);
  const normalNodes = selectablePlaceholders(root, isNormalPlaceholder);
  const eminentNodes = selectablePlaceholders(root, isEminentPlaceholder);
  const normalText = formatPrice(priceRow.normal);
  const eminentText = formatPrice(priceRow.eminent);
  const typography = {
    ...resolvePriceTypography(options.priceTypography),
    dataUrl: options.priceTypography?.dataUrl,
  };
  const warnings = [];

  if (!normalText) warnings.push('Sin precio normal.');
  if (!eminentText) warnings.push('Sin precio Eminent.');
  if (!normalNodes.length) warnings.push('No se encontro placeholder $$$$.');
  if (!eminentNodes.length) warnings.push('No se encontro placeholder @@@@.');
  const unresolvedImageCount = inspectSvg(svgText).unresolvedImageCount;
  if (unresolvedImageCount) warnings.push(`${unresolvedImageCount} imagenes no embebidas en el SVG.`);

  ensureFontFace(root, typography);
  normalNodes.forEach((node) => centerAndFitPrice(node, normalText, findNearestPill(root, node), typography));
  eminentNodes.forEach((node) => centerAndFitPrice(node, eminentText, findNearestPill(root, node), typography));

  try {
    const serializer = new XMLSerializer();
    return {
      svgText: serializer.serializeToString(root),
      stats: {
        normalCount: normalNodes.length,
        eminentCount: eminentNodes.length,
      },
      warnings,
    };
  } finally {
    cleanup();
  }
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

function isSvgFile(file) {
  return file.name.toLowerCase().endsWith('.svg');
}

function isIgnoredFile(file) {
  const name = file.name.toLowerCase();
  const pathKeys = splitPath(file).map(normalizeKey);
  return (
    !file.name ||
    name === '.ds_store' ||
    name === 'thumbs.db' ||
    name.startsWith('_') ||
    pathKeys.includes('exports') ||
    pathKeys.includes('export')
  );
}

function safeZipPath(parts) {
  return parts.map(slugFolder).filter(Boolean).join('/');
}

function actionPartIndex(parts, productName, actionRule) {
  const actionKeys = actionFolderKeysForRule(actionRule, productName);
  if (!actionKeys.size) return -1;

  const directories = parts.slice(0, -1);
  return directories.findIndex((part) => actionKeys.has(normalizeKey(part)));
}

function relativeActionParts(file, commonRootName, productName, actionRule) {
  const stripped = stripCommonRoot(splitPath(file), commonRootName);
  const index = actionPartIndex(stripped, productName, actionRule);
  return index >= 0 ? stripped.slice(index + 1) : stripped;
}

function knownTemplateMap(actionRule) {
  const pairs = [
    ['GENERAL', 'GENERAL'],
    ...((actionRule?.exceptionTemplates ?? []).map((name) => [name, name])),
  ];

  return new Map(pairs.map(([key, label]) => [templateKey(key), templateLabel(label)]));
}

function assignTemplate(parts, actionRule) {
  const fileName = parts.at(-1) ?? '';
  const directories = parts.slice(0, -1);
  const known = knownTemplateMap(actionRule);

  if (!directories.length) {
    return {
      templateName: 'GENERAL',
      templateKey: templateKey('GENERAL'),
      relativeParts: [fileName],
    };
  }

  const first = directories[0];
  const firstKey = templateKey(first);
  if (known.has(firstKey)) {
    return {
      templateName: known.get(firstKey),
      templateKey: firstKey,
      relativeParts: [...directories.slice(1), fileName],
    };
  }

  return {
    templateName: 'GENERAL',
    templateKey: templateKey('GENERAL'),
    relativeParts: parts,
  };
}

function isActionSpecificUpload(files, commonRootName, productName, actionRule) {
  return files.some((file) => actionPartIndex(stripCommonRoot(splitPath(file), commonRootName), productName, actionRule) >= 0);
}

function planAllTemplateFiles(uploadedFiles, productName, actionRule) {
  const files = uploadedFiles.filter((file) => !isIgnoredFile(file));
  const root = commonRoot(files);
  const onlySelectedAction = isActionSpecificUpload(files, root, productName, actionRule);

  return files
    .map((file) => {
      const stripped = stripCommonRoot(splitPath(file), root);
      const actionIndex = actionPartIndex(stripped, productName, actionRule);
      if (onlySelectedAction && actionIndex < 0) return null;

      const actionParts = actionIndex >= 0 ? stripped.slice(actionIndex + 1) : relativeActionParts(file, root, productName, actionRule);
      const assignment = assignTemplate(actionParts.length ? actionParts : [file.name], actionRule);

      return {
        file,
        inputPath: file.webkitRelativePath || file.name,
        actionParts: actionParts.length ? actionParts : [file.name],
        ...assignment,
      };
    })
    .filter(Boolean);
}

export function planTemplateFiles(files, productName, actionRule) {
  return planAllTemplateFiles(files, productName, actionRule).filter((item) => isSvgFile(item.file));
}

function targetsForTemplate(templateFile, priceRows, actionRule, availableTemplateKeys) {
  const generalKey = templateKey('GENERAL');
  const exceptionKeys = new Set((actionRule?.exceptionTemplates ?? []).map(templateKey));

  if (templateFile.templateKey === generalKey) {
    return priceRows.filter((row) => !exceptionKeys.has(row.branchKey));
  }

  if (!availableTemplateKeys.has(templateFile.templateKey)) {
    return [];
  }

  return priceRows.filter((row) => row.branchKey === templateFile.templateKey);
}

function priceGroupKey(row) {
  return [row.templateName, row.normal ?? '', row.eminent ?? ''].map((part) => String(part)).join('|');
}

function compactBranchFolderName(rows) {
  const names = rows.map((row) => row.folderName || row.branchName).filter(Boolean);
  const full = names.join(' + ');
  if (full.length <= 95) return full;

  const kept = [];
  let length = 0;
  for (const name of names) {
    const nextLength = length + (kept.length ? 3 : 0) + name.length;
    if (nextLength > 72) break;
    kept.push(name);
    length = nextLength;
  }

  const remaining = names.length - kept.length;
  return `${kept.join(' + ')} + ${remaining} LOCALES MAS`;
}

function rowGroupsForTargets(targets, groupSamePrices = false) {
  if (!groupSamePrices) {
    return targets.map((row) => ({
      id: row.id,
      folderName: row.folderName,
      priceRow: row,
      priceRows: [row],
    }));
  }

  const groups = new Map();
  targets.forEach((row) => {
    const key = priceGroupKey(row);
    const group = groups.get(key) ?? {
      id: key,
      priceRow: row,
      priceRows: [],
    };
    group.priceRows.push(row);
    groups.set(key, group);
  });

  return Array.from(groups.values()).map((group) => ({
    ...group,
    folderName: compactBranchFolderName(group.priceRows),
  }));
}

export function summarizeTemplatePlan({ svgFiles, priceRows, productName, actionRule, groupSamePrices = false }) {
  const allTemplateFiles = planAllTemplateFiles(svgFiles, productName, actionRule);
  const templateFiles = allTemplateFiles.filter((item) => isSvgFile(item.file));
  const staticFiles = allTemplateFiles.filter((item) => !isSvgFile(item.file));
  const availableTemplateKeys = new Set(templateFiles.map((file) => file.templateKey));
  const templateCounts = new Map();
  const outputFolders = new Set();
  const generatedSvgCount = templateFiles.reduce((sum, templateFile) => {
    const targets = targetsForTemplate(templateFile, priceRows, actionRule, availableTemplateKeys);
    const groups = rowGroupsForTargets(targets, groupSamePrices);
    groups.forEach((group) => outputFolders.add(group.folderName));
    const count = groups.length;
    templateCounts.set(templateFile.templateName, (templateCounts.get(templateFile.templateName) ?? 0) + 1);
    return sum + count;
  }, 0);
  const generatedStaticCount = staticFiles.reduce((sum, templateFile) => {
    const targets = targetsForTemplate(templateFile, priceRows, actionRule, availableTemplateKeys);
    return sum + rowGroupsForTargets(targets, groupSamePrices).length;
  }, 0);
  const generatedPngCount = generatedSvgCount;
  const missingTemplates = [];
  const generalKey = templateKey('GENERAL');
  const exceptionKeys = new Set((actionRule?.exceptionTemplates ?? []).map(templateKey));
  const hasGeneralTarget = priceRows.some((row) => !exceptionKeys.has(row.branchKey));
  if (hasGeneralTarget && !availableTemplateKeys.has(generalKey)) missingTemplates.push('GENERAL');

  (actionRule?.exceptionTemplates ?? []).forEach((exception) => {
    const key = templateKey(exception);
    const hasTarget = priceRows.some((row) => row.branchKey === key);
    if (hasTarget && !availableTemplateKeys.has(key)) missingTemplates.push(exception);
  });

  return {
    templateFiles,
    staticFiles,
    templateCounts: Array.from(templateCounts, ([name, count]) => ({ name, count })),
    missingTemplates,
    generatedCount: generatedSvgCount + generatedPngCount + generatedStaticCount,
    generatedSvgCount,
    generatedPngCount,
    generatedStaticCount,
    outputFolderCount: outputFolders.size,
  };
}

function resultBranchName(result) {
  const rows = result.priceRows ?? [result.priceRow];
  return rows.map((row) => row.branchName).join(' / ');
}

function resultGroupName(result) {
  const rows = result.priceRows ?? [result.priceRow];
  return Array.from(new Set(rows.map((row) => row.groupName).filter(Boolean))).join(' / ');
}

async function buildManifestRows(results) {
  const header = [
    'archivo',
    'tipo',
    'plantilla',
    'local',
    'grupo_excel',
    'canal',
    'precio_normal',
    'precio_eminent',
    'fuente',
    'peso',
    'estilo',
    'estado',
  ];
  const rows = results.map((result) => [
    result.outputPath,
    result.kind,
    result.templateName,
    resultBranchName(result),
    resultGroupName(result),
    result.priceRow.channel.toUpperCase(),
    formatPrice(result.priceRow.normal),
    formatPrice(result.priceRow.eminent),
    result.typography ? result.typography.family : '',
    result.typography ? result.typography.weight : '',
    result.typography ? result.typography.style : '',
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

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function resolveExportTypography(priceTypography) {
  const typography = resolvePriceTypography(priceTypography);
  if (typeof fetch !== 'function' || typeof btoa !== 'function') return typography;

  try {
    const response = await fetch(typography.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    return {
      ...typography,
      dataUrl: `data:font/otf;base64,${arrayBufferToBase64(buffer)}`,
    };
  } catch {
    return typography;
  }
}

function parseDimension(value) {
  if (!value) return null;
  const number = Number.parseFloat(String(value).replace(/px$/i, ''));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function svgSize(svgText) {
  const doc = parseSvg(svgText);
  const root = doc.documentElement;
  const width = parseDimension(root.getAttribute('width'));
  const height = parseDimension(root.getAttribute('height'));
  if (width && height) return { width: Math.round(width), height: Math.round(height) };

  const viewBox = root.getAttribute('viewBox') || '';
  const parts = viewBox.split(/[\s,]+/).map(Number);
  if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
    return { width: Math.round(parts[2]), height: Math.round(parts[3]) };
  }

  throw new Error('No pude detectar el tamano del SVG para exportar PNG.');
}

function loadSvgImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No pude renderizar el SVG como imagen.'));
    image.src = url;
  });
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('No pude crear el PNG desde el SVG.'));
    }, 'image/png');
  });
}

async function svgToPngBlob(svgText) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
    throw new Error('La exportacion PNG necesita ejecutarse en el navegador.');
  }

  const { width, height } = svgSize(svgText);
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const image = await loadSvgImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('No pude preparar el canvas para exportar PNG.');
    context.drawImage(image, 0, 0, width, height);

    return await canvasToPngBlob(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pngPathForSvg(outputPath) {
  return outputPath.replace(/\.svg$/i, '.png');
}

function outputFormatFlags(outputFormat = 'png') {
  return {
    includeSvg: outputFormat === 'svg' || outputFormat === 'both',
    includePng: outputFormat === 'png' || outputFormat === 'both',
  };
}

export async function analyzeSvgFiles(files, { productName = '', actionRule = null } = {}) {
  const svgFiles = files.filter(isSvgFile);
  const planned = planTemplateFiles(svgFiles, productName, actionRule);

  const results = [];
  for (const item of planned) {
    try {
      const file = item.file;
      const text = await file.text();
      const stats = inspectSvg(text);
      results.push({
        name: file.name,
        path: item.inputPath,
        templateName: item.templateName,
        templateKey: item.templateKey,
        ok: stats.normalCount > 0 && stats.eminentCount > 0 && stats.unresolvedImageCount === 0,
        error: stats.unresolvedImageCount ? `${stats.unresolvedImageCount} imagenes no embebidas` : '',
        ...stats,
      });
    } catch (error) {
      results.push({
        name: item.file.name,
        path: item.inputPath,
        templateName: item.templateName,
        templateKey: item.templateKey,
        ok: false,
        normalCount: 0,
        eminentCount: 0,
        error: error.message,
      });
    }
  }

  return results;
}

export async function buildPricePreviews({
  svgFiles,
  priceRows,
  productName,
  actionRule,
  priceTypography,
  rowLimit = 32,
  piecesPerRow = 2,
}) {
  if (typeof URL === 'undefined' || typeof Blob === 'undefined') return [];

  const files = svgFiles.filter((file) => !isIgnoredFile(file));
  const templateFiles = planTemplateFiles(files, productName, actionRule);
  const availableTemplateKeys = new Set(templateFiles.map((file) => file.templateKey));
  const rows = priceRows.filter((row) => row.normal && row.eminent).slice(0, rowLimit);
  const exportTypography = await resolveExportTypography(priceTypography);
  const svgTextCache = new Map();
  const previews = [];

  for (const priceRow of rows) {
    const matchingTemplates = templateFiles
      .filter((templateFile) => targetsForTemplate(templateFile, [priceRow], actionRule, availableTemplateKeys).length)
      .slice(0, piecesPerRow);

    if (!matchingTemplates.length) continue;

    const pieces = [];
    for (const templateFile of matchingTemplates) {
      let svgText = svgTextCache.get(templateFile.inputPath);
      if (!svgText) {
        svgText = await templateFile.file.text();
        svgTextCache.set(templateFile.inputPath, svgText);
      }

      const processed = replaceSvgPrices(svgText, priceRow, { priceTypography: exportTypography });
      const url = URL.createObjectURL(new Blob([processed.svgText], { type: 'image/svg+xml;charset=utf-8' }));
      pieces.push({
        url,
        label: `Pieza ${pieces.length + 1}`,
        warnings: processed.warnings,
      });
    }

    previews.push({
      id: priceRow.id,
      branchName: priceRow.branchName,
      groupName: priceRow.groupName,
      templateName: priceRow.templateName,
      normalText: formatPrice(priceRow.normal),
      eminentText: formatPrice(priceRow.eminent),
      pieces,
    });
  }

  return previews;
}

export async function exportPriceZip({
  svgFiles,
  priceRows,
  productName,
  actionRule,
  priceTypography,
  outputFormat = 'png',
  includeStaticAssets = false,
  groupSamePrices = false,
}) {
  const files = svgFiles.filter((file) => !isIgnoredFile(file));
  const templateFiles = planAllTemplateFiles(files, productName, actionRule);
  const svgTemplateFiles = templateFiles.filter((item) => isSvgFile(item.file));
  if (!svgTemplateFiles.length) throw new Error('No hay archivos SVG para exportar.');
  if (!priceRows.length) throw new Error('No hay locales seleccionados.');
  const { includeSvg, includePng } = outputFormatFlags(outputFormat);

  const availableTemplateKeys = new Set(svgTemplateFiles.map((file) => file.templateKey));
  const missing = summarizeTemplatePlan({ svgFiles: files, priceRows, productName, actionRule, groupSamePrices }).missingTemplates;
  if (missing.length) {
    throw new Error(`Falta carpeta plantilla para: ${missing.join(', ')}.`);
  }

  const zip = new JSZip();
  const results = [];
  const exportTypography = await resolveExportTypography(priceTypography);

  for (const templateFile of templateFiles) {
    const targets = targetsForTemplate(templateFile, priceRows, actionRule, availableTemplateKeys);
    if (!targets.length) continue;
    const targetGroups = rowGroupsForTargets(targets, groupSamePrices);

    if (!isSvgFile(templateFile.file)) {
      if (!includePng || !includeStaticAssets) continue;
      const assetBuffer = await templateFile.file.arrayBuffer();
      for (const targetGroup of targetGroups) {
        const outputParts = [targetGroup.folderName, ...templateFile.relativeParts];
        const outputPath = safeZipPath(outputParts);

        zip.file(outputPath, assetBuffer);
        results.push({
          inputPath: templateFile.inputPath,
          outputPath,
          kind: 'ASSET',
          templateName: templateFile.templateName,
          priceRow: targetGroup.priceRow,
          priceRows: targetGroup.priceRows,
          typography: null,
          warnings: [],
        });
      }
      continue;
    }

    const svgText = await templateFile.file.text();

    for (const targetGroup of targetGroups) {
      const priceRow = targetGroup.priceRow;
      const outputParts = [targetGroup.folderName, ...templateFile.relativeParts];
      const outputPath = safeZipPath(outputParts);
      const processed = replaceSvgPrices(svgText, priceRow, { priceTypography: exportTypography });

      if (includeSvg) {
        zip.file(outputPath, processed.svgText);
        results.push({
          inputPath: templateFile.inputPath,
          outputPath,
          kind: 'SVG',
          templateName: templateFile.templateName,
          priceRow,
          priceRows: targetGroup.priceRows,
          typography: exportTypography,
          warnings: processed.warnings,
        });
      }

      if (includePng) {
        const pngOutputPath = pngPathForSvg(outputPath);
        const pngBlob = await svgToPngBlob(processed.svgText);
        zip.file(pngOutputPath, pngBlob);
        results.push({
          inputPath: templateFile.inputPath,
          outputPath: pngOutputPath,
          kind: 'PNG',
          templateName: templateFile.templateName,
          priceRow,
          priceRows: targetGroup.priceRows,
          typography: exportTypography,
          warnings: processed.warnings,
        });
      }
    }
  }

  if (!results.length) throw new Error('El modo elegido no genero archivos para descargar.');

  const manifest = await buildManifestRows(results);
  zip.file('_reporte_precios.csv', manifest);

  const blob = await zip.generateAsync({ type: 'blob' });
  const safeProduct = slugFolder(productName || 'accion').replace(/\s+/g, '-').toLowerCase();
  saveAs(blob, `sushiclub-${safeProduct}-precios.zip`);

  return {
    fileCount: files.length,
    svgCount: svgTemplateFiles.length,
    generatedCount: results.length,
    generatedSvgCount: results.filter((result) => result.kind === 'SVG').length,
    generatedPngCount: results.filter((result) => result.kind === 'PNG').length,
    generatedStaticCount: results.filter((result) => result.kind === 'ASSET').length,
    warningCount: results.filter((result) => result.warnings.length).length,
    results,
  };
}
