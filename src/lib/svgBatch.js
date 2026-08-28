import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { cleanText, formatPrice, normalizeKey, slugFolder } from './text.js';
import { templateKey, templateLabel } from './actionRules.js';

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

function safeZipPath(parts) {
  return parts.map(slugFolder).filter(Boolean).join('/');
}

function actionPartIndex(parts, productName) {
  const actionKey = normalizeKey(productName);
  if (!actionKey) return -1;
  return parts.findIndex((part) => normalizeKey(part.replace(/\.svg$/i, '')) === actionKey);
}

function relativeActionParts(file, commonRootName, productName) {
  const stripped = stripCommonRoot(splitPath(file), commonRootName);
  const index = actionPartIndex(stripped, productName);
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

function isActionSpecificUpload(svgFiles, commonRootName, productName) {
  return svgFiles.some((file) => actionPartIndex(stripCommonRoot(splitPath(file), commonRootName), productName) >= 0);
}

export function planTemplateFiles(svgFiles, productName, actionRule) {
  const files = svgFiles.filter((file) => file.name.toLowerCase().endsWith('.svg'));
  const root = commonRoot(files);
  const onlySelectedAction = isActionSpecificUpload(files, root, productName);

  return files
    .map((file) => {
      const stripped = stripCommonRoot(splitPath(file), root);
      const actionIndex = actionPartIndex(stripped, productName);
      if (onlySelectedAction && actionIndex < 0) return null;

      const actionParts = actionIndex >= 0 ? stripped.slice(actionIndex + 1) : relativeActionParts(file, root, productName);
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

export function summarizeTemplatePlan({ svgFiles, priceRows, productName, actionRule }) {
  const templateFiles = planTemplateFiles(svgFiles, productName, actionRule);
  const availableTemplateKeys = new Set(templateFiles.map((file) => file.templateKey));
  const templateCounts = new Map();
  const missingTemplates = [];
  const generatedCount = templateFiles.reduce((sum, templateFile) => {
    const count = targetsForTemplate(templateFile, priceRows, actionRule, availableTemplateKeys).length;
    templateCounts.set(templateFile.templateName, (templateCounts.get(templateFile.templateName) ?? 0) + 1);
    return sum + count;
  }, 0);
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
    templateCounts: Array.from(templateCounts, ([name, count]) => ({ name, count })),
    missingTemplates,
    generatedCount,
  };
}

async function buildManifestRows(results) {
  const header = ['archivo', 'plantilla', 'local', 'grupo_excel', 'canal', 'precio_normal', 'precio_eminent', 'estado'];
  const rows = results.map((result) => [
    result.outputPath,
    result.templateName,
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

export async function analyzeSvgFiles(files, { productName = '', actionRule = null } = {}) {
  const svgFiles = files.filter((file) => file.name.toLowerCase().endsWith('.svg'));
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
        ok: stats.normalCount > 0 && stats.eminentCount > 0,
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

export async function exportPriceZip({ svgFiles, priceRows, productName, actionRule }) {
  const files = svgFiles.filter((file) => file.name.toLowerCase().endsWith('.svg'));
  if (!files.length) throw new Error('No hay archivos SVG para exportar.');
  if (!priceRows.length) throw new Error('No hay locales seleccionados.');

  const templateFiles = planTemplateFiles(files, productName, actionRule);
  const availableTemplateKeys = new Set(templateFiles.map((file) => file.templateKey));
  const missing = summarizeTemplatePlan({ svgFiles: files, priceRows, productName, actionRule }).missingTemplates;
  if (missing.length) {
    throw new Error(`Falta carpeta plantilla para: ${missing.join(', ')}.`);
  }

  const zip = new JSZip();
  const results = [];

  for (const templateFile of templateFiles) {
    const targets = targetsForTemplate(templateFile, priceRows, actionRule, availableTemplateKeys);
    const svgText = await templateFile.file.text();

    for (const priceRow of targets) {
      const outputParts = [priceRow.folderName, ...templateFile.relativeParts];
      const outputPath = safeZipPath(outputParts);
      const processed = replaceSvgPrices(svgText, priceRow);

      zip.file(outputPath, processed.svgText);
      results.push({
        inputPath: templateFile.inputPath,
        outputPath,
        templateName: templateFile.templateName,
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
