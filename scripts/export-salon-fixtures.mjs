import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseWorkbookBuffer, priceRowsForProduct } from '../src/lib/priceWorkbook.js';
import { ruleForProduct, templateForRow, templateKey } from '../src/lib/actionRules.js';
import { formatPrice, normalizeSearch, slugFolder } from '../src/lib/text.js';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const WORKBOOK_DIR = 'E:/Ivan/Downloads';
const INPUT_ROOT = 'E:/Ivan/Desktop/CALENDARIO SUSHICLUB/09 Septiembre/Aumentos salon';
const OUTPUT_ROOT = path.join(INPUT_ROOT, `_EXPORTADOS_APP_${timestamp()}`);
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PYTHON_PATH = 'C:/Users/Ivan Rodriguez/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const FONT_PATH = path.join(REPO_ROOT, 'src/public/fonts/acumin/Acumin Pro Semibold.otf');

const ACTIONS = [
  {
    name: '2 Tiempos',
    productNeedle: '2 tiempos',
    exact: true,
    folder: path.join(INPUT_ROOT, 'Salon/2 Tiempos'),
  },
  {
    name: '3 Tiempos',
    productNeedle: '3 tiempos',
    exact: true,
    folder: path.join(INPUT_ROOT, 'Salon/3 Tiempos'),
  },
  {
    name: '3 Tiempos Plant-Based',
    productNeedle: '3 tiempos plant-based',
    exact: true,
    folder: path.join(INPUT_ROOT, 'Salon/3 Tiempos Plant-Based'),
  },
  {
    name: 'Menu Club Ejecutivo',
    productNeedle: 'menu club ejecutivo',
    folder: path.join(INPUT_ROOT, 'Salon/Menu Club Ejecutivo'),
  },
  {
    name: 'Menu San Juanino',
    productNeedle: 'menu san juanino',
    folder: path.join(INPUT_ROOT, 'Menu San Juanino'),
  },
  {
    name: 'Sabores de Primavera',
    productNeedle: 'sabores de primavera',
    folder: path.join(INPUT_ROOT, 'Sabores de Primavera'),
  },
];

function timestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function findWorkbook() {
  const files = fs
    .readdirSync(WORKBOOK_DIR)
    .filter((name) => name.endsWith('(1).xlsx') && !name.startsWith('~$'))
    .map((name) => path.join(WORKBOOK_DIR, name));
  if (!files.length) throw new Error('No encontre el Excel mensual en Downloads.');
  return files[0];
}

function productMatches(product, action) {
  const productName = normalizeSearch(product.name);
  const needle = normalizeSearch(action.productNeedle);
  return action.exact ? productName === needle : productName.includes(needle);
}

function walkFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const normalized = normalizeSearch(entry.name);
      if (normalized === 'exports' || normalized === 'export') return [];
      return walkFiles(fullPath);
    }
    if (!entry.name.toLowerCase().endsWith('.svg')) return [];
    return [fullPath];
  });
}

function splitRelative(filePath, root) {
  return path.relative(root, filePath).split(path.sep).filter(Boolean);
}

function knownTemplateMap(actionRule) {
  return new Map(['GENERAL', ...(actionRule?.exceptionTemplates ?? [])].map((name) => [templateKey(name), name]));
}

function assignTemplate(relativeParts, actionRule) {
  const directories = relativeParts.slice(0, -1);
  const known = knownTemplateMap(actionRule);
  if (!directories.length) {
    return { templateName: 'GENERAL', templateKey: templateKey('GENERAL'), pieceParts: relativeParts };
  }

  const firstKey = templateKey(directories[0]);
  if (known.has(firstKey)) {
    return {
      templateName: known.get(firstKey),
      templateKey: firstKey,
      pieceParts: [...directories.slice(1), relativeParts.at(-1)],
    };
  }

  return { templateName: 'GENERAL', templateKey: templateKey('GENERAL'), pieceParts: relativeParts };
}

function targetsForTemplate(template, rows, actionRule, availableTemplateKeys) {
  const generalKey = templateKey('GENERAL');
  const exceptionKeys = new Set((actionRule?.exceptionTemplates ?? []).map(templateKey));

  if (template.templateKey === generalKey) {
    return rows.filter((row) => !exceptionKeys.has(row.branchKey));
  }

  if (!availableTemplateKeys.has(template.templateKey)) return [];
  return rows.filter((row) => row.branchKey === template.templateKey);
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
  return `${kept.join(' + ')} + ${names.length - kept.length} LOCALES MAS`;
}

function rowGroupsForTargets(targets) {
  const groups = new Map();
  for (const row of targets) {
    const key = [row.templateName, row.normal ?? '', row.eminent ?? ''].join('|');
    if (!groups.has(key)) groups.set(key, { priceRow: row, priceRows: [] });
    groups.get(key).priceRows.push(row);
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    folderName: compactBranchFolderName(group.priceRows),
  }));
}

function outputPngPath(actionName, folderName, pieceParts) {
  const cleanParts = [
    slugFolder(actionName),
    slugFolder(folderName),
    ...pieceParts.map((part, index) => {
      const clean = slugFolder(part);
      return index === pieceParts.length - 1 ? clean.replace(/\.svg$/i, '.png') : clean;
    }),
  ];
  return cleanParts.join('/');
}

const workbookPath = findWorkbook();
const workbook = parseWorkbookBuffer(fs.readFileSync(workbookPath), path.basename(workbookPath));
const plan = {
  workbookPath,
  inputRoot: INPUT_ROOT,
  outputRoot: OUTPUT_ROOT,
  chromePath: CHROME_PATH,
  fontPath: FONT_PATH,
  actions: [],
};

for (const action of ACTIONS) {
  const product = workbook.products.find((item) => productMatches(item, action));
  if (!product) {
    console.warn(`Sin producto para ${action.name}`);
    continue;
  }
  if (!fs.existsSync(action.folder)) {
    console.warn(`Sin carpeta para ${action.name}: ${action.folder}`);
    continue;
  }

  const actionRule = ruleForProduct(product);
  const rows = priceRowsForProduct(product, 'salon', 'branches')
    .map((row) => ({ ...row, templateName: templateForRow(row, actionRule) }))
    .filter((row) => row.normal && row.eminent);
  const templates = walkFiles(action.folder).map((sourcePath) => ({
    sourcePath,
    ...assignTemplate(splitRelative(sourcePath, action.folder), actionRule),
  }));
  const availableTemplateKeys = new Set(templates.map((template) => template.templateKey));
  const jobs = [];

  for (const template of templates) {
    const groups = rowGroupsForTargets(targetsForTemplate(template, rows, actionRule, availableTemplateKeys));
    for (const group of groups) {
      jobs.push({
        sourcePath: template.sourcePath,
        outputPath: outputPngPath(action.name, group.folderName, template.pieceParts),
        branches: group.priceRows.map((row) => row.branchName),
        templateName: template.templateName,
        normalText: formatPrice(group.priceRow.normal),
        eminentText: formatPrice(group.priceRow.eminent),
      });
    }
  }

  plan.actions.push({
    name: action.name,
    safeName: slugFolder(action.name).replace(/\s+/g, '-').toLowerCase(),
    productName: product.name,
    folder: action.folder,
    sourceSvgCount: templates.length,
    branchCount: rows.length,
    groupedFolderCount: new Set(jobs.map((job) => job.outputPath.split('/')[1])).size,
    jobs,
  });
}

fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
const planPath = path.join(OUTPUT_ROOT, '_plan_exportacion.json');
fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');

for (const action of plan.actions) {
  console.log(`${action.name}: ${action.sourceSvgCount} SVG, ${action.branchCount} locales, ${action.groupedFolderCount} carpetas, ${action.jobs.length} PNG`);
}

const result = spawnSync(PYTHON_PATH, [path.join(REPO_ROOT, 'scripts/render-batch-png.py'), planPath], {
  stdio: 'inherit',
  cwd: REPO_ROOT,
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}
