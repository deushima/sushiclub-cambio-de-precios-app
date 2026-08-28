import * as XLSX from 'xlsx';
import { cleanText, normalizeKey } from './text.js';

function usedColumnCount(rows) {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

function cell(rows, row, col) {
  return rows[row]?.[col] ?? null;
}

function isCodigo(value) {
  return normalizeKey(value) === 'codigo';
}

function isNombre(value) {
  return normalizeKey(value) === 'nombre';
}

function findCodeNamePairs(rows) {
  const pairs = [];
  const scanRows = Math.min(rows.length, 30);

  for (let row = 0; row < scanRows; row += 1) {
    const width = rows[row]?.length ?? 0;
    for (let col = 0; col < width - 1; col += 1) {
      if (isCodigo(cell(rows, row, col)) && isNombre(cell(rows, row, col + 1))) {
        pairs.push({ headerRow: row, codeCol: col, nameCol: col + 1 });
      }
    }
  }

  return pairs;
}

function findEminentMarker(rows) {
  for (let row = 0; row < Math.min(rows.length, 30); row += 1) {
    const width = rows[row]?.length ?? 0;
    for (let col = 0; col < width; col += 1) {
      const value = normalizeKey(cell(rows, row, col));
      if (value.includes('eminent')) return { row, col };
    }
  }
  return null;
}

function pairSignature(pair) {
  return `${pair.headerRow}:${pair.codeCol}:${pair.nameCol}`;
}

function detectBlocks(rows) {
  const pairs = findCodeNamePairs(rows);
  if (pairs.length < 1) {
    throw new Error('No encontre columnas Codigo/Nombre en la planilla.');
  }

  const marker = findEminentMarker(rows);
  const eminentPair =
    marker &&
    pairs.find((pair) => Math.abs(pair.nameCol - marker.col) <= 1 || pair.nameCol >= marker.col);

  const normalPair =
    pairs.find((pair) => !eminentPair || pairSignature(pair) !== pairSignature(eminentPair)) ?? pairs[0];

  if (!eminentPair) {
    throw new Error('No encontre el bloque Eminent en la planilla.');
  }

  const orderedPairs = [...pairs].sort((a, b) => a.codeCol - b.codeCol);
  const normalIndex = orderedPairs.findIndex((pair) => pairSignature(pair) === pairSignature(normalPair));
  const nextAfterNormal = orderedPairs[normalIndex + 1];
  const maxCol = usedColumnCount(rows) - 1;

  return {
    normal: {
      label: 'Precio normal',
      pair: normalPair,
      endCol: nextAfterNormal ? nextAfterNormal.codeCol - 2 : maxCol,
    },
    eminent: {
      label: cleanText(cell(rows, marker.row, marker.col)) || 'Eminent',
      pair: eminentPair,
      endCol: maxCol,
    },
  };
}

function splitBranchNames(groupName) {
  const clean = cleanText(groupName);
  if (!clean) return [];
  if (normalizeKey(clean) === 'general') return ['GENERAL'];

  return clean
    .split(/\s*\|\s*|\s*\/\s*|\s+-\s*|\s*-\s+/g)
    .map(cleanText)
    .filter(Boolean);
}

function parseGroups(rows, block) {
  const { pair, endCol } = block;
  const groupRow = pair.headerRow - 1;
  const serviceRow = pair.headerRow;
  const groups = [];

  for (let col = pair.nameCol + 1; col <= endCol; col += 2) {
    const groupName = cleanText(cell(rows, groupRow, col));
    const salonLabel = cleanText(cell(rows, serviceRow, col)) || 'SALON';
    const deliLabel = cleanText(cell(rows, serviceRow, col + 1)) || 'DELI';

    if (!groupName && !salonLabel && !deliLabel) continue;

    groups.push({
      index: groups.length,
      groupName,
      branchNames: splitBranchNames(groupName),
      salonCol: col,
      deliCol: col + 1,
      salonLabel,
      deliLabel,
    });
  }

  return groups;
}

function hasUsefulPrice(value) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'string') return value.trim() !== '' && value.trim() !== '-';
  return true;
}

function parseBlockProducts(rows, block, groups) {
  const { pair } = block;
  const products = [];

  for (let row = pair.headerRow + 1; row < rows.length; row += 1) {
    const code = cell(rows, row, pair.codeCol);
    const name = cleanText(cell(rows, row, pair.nameCol));
    if (!name) continue;

    const priceCells = {};
    let priceCount = 0;

    groups.forEach((group) => {
      const salon = cell(rows, row, group.salonCol);
      const deli = cell(rows, row, group.deliCol);
      if (hasUsefulPrice(salon)) priceCount += 1;
      if (hasUsefulPrice(deli)) priceCount += 1;
      priceCells[group.index] = { salon, deli };
    });

    if (!hasUsefulPrice(code) && priceCount === 0) continue;

    products.push({
      rowNumber: row + 1,
      code: hasUsefulPrice(code) ? String(code).trim() : '',
      name,
      key: hasUsefulPrice(code) ? `code:${String(code).trim()}` : `name:${normalizeKey(name)}`,
      priceCells,
      priceCount,
    });
  }

  return products;
}

function buildProductModel(normalProducts, eminentProducts, normalGroups, eminentGroups) {
  const eminentByCode = new Map();
  const eminentByName = new Map();

  eminentProducts.forEach((product) => {
    if (product.code) eminentByCode.set(product.code, product);
    eminentByName.set(normalizeKey(product.name), product);
  });

  return normalProducts.map((normalProduct) => {
    const eminentProduct =
      (normalProduct.code && eminentByCode.get(normalProduct.code)) ||
      eminentByName.get(normalizeKey(normalProduct.name)) ||
      null;

    const prices = [];

    normalGroups.forEach((normalGroup, groupIndex) => {
      const eminentGroup = eminentGroups[groupIndex] ?? null;
      const normalCells = normalProduct.priceCells[normalGroup.index] ?? {};
      const eminentCells = eminentProduct && eminentGroup ? eminentProduct.priceCells[eminentGroup.index] ?? {} : {};

      ['salon', 'deli'].forEach((channel) => {
        const normalValue = normalCells[channel];
        const eminentValue = eminentCells[channel];
        if (!hasUsefulPrice(normalValue) && !hasUsefulPrice(eminentValue)) return;

        prices.push({
          id: `${normalProduct.key}:${groupIndex}:${channel}`,
          groupIndex,
          channel,
          groupName: normalGroup.groupName,
          branchNames: normalGroup.branchNames.length ? normalGroup.branchNames : [normalGroup.groupName],
          normal: hasUsefulPrice(normalValue) ? normalValue : null,
          eminent: hasUsefulPrice(eminentValue) ? eminentValue : null,
          normalColumn: channel === 'salon' ? normalGroup.salonCol : normalGroup.deliCol,
          eminentColumn: eminentGroup ? (channel === 'salon' ? eminentGroup.salonCol : eminentGroup.deliCol) : null,
        });
      });
    });

    return {
      ...normalProduct,
      eminentRowNumber: eminentProduct?.rowNumber ?? null,
      hasEminent: Boolean(eminentProduct),
      prices,
    };
  });
}

export function parseWorkbookBuffer(buffer, fileName = 'precios.xlsx') {
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: false,
    raw: true,
  });

  if (!workbook.SheetNames.length) {
    throw new Error('El archivo no tiene hojas.');
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });

  const blocks = detectBlocks(rows);
  const normalGroups = parseGroups(rows, blocks.normal);
  const eminentGroups = parseGroups(rows, blocks.eminent);
  const normalProducts = parseBlockProducts(rows, blocks.normal, normalGroups);
  const eminentProducts = parseBlockProducts(rows, blocks.eminent, eminentGroups);
  const products = buildProductModel(normalProducts, eminentProducts, normalGroups, eminentGroups);

  return {
    fileName,
    sheetName,
    blocks,
    normalGroups,
    eminentGroups,
    products,
    warnings: [
      ...(normalGroups.length !== eminentGroups.length
        ? [`El bloque normal tiene ${normalGroups.length} grupos y Eminent tiene ${eminentGroups.length}.`]
        : []),
    ],
  };
}

export async function parsePriceWorkbook(file) {
  const buffer = await file.arrayBuffer();
  return parseWorkbookBuffer(buffer, file.name);
}

export function priceRowsForProduct(product, channel, folderMode = 'branches') {
  if (!product) return [];

  const filtered = product.prices.filter((price) => price.channel === channel);
  const branchCounts = new Map();

  filtered.forEach((price) => {
    const names = folderMode === 'groups' ? [price.groupName] : price.branchNames;
    names.forEach((name) => {
      const key = normalizeKey(name);
      branchCounts.set(key, (branchCounts.get(key) ?? 0) + 1);
    });
  });

  return filtered.flatMap((price) => {
    const names = folderMode === 'groups' ? [price.groupName] : price.branchNames;

    return names.map((branchName) => {
      const branchKey = normalizeKey(branchName);
      const duplicate = (branchCounts.get(branchKey) ?? 0) > 1;
      const folderName = duplicate && folderMode !== 'groups' ? `${branchName} - ${price.groupName}` : branchName;

      return {
        ...price,
        id: `${price.id}:${branchKey}`,
        branchName,
        branchKey,
        folderName,
      };
    });
  });
}
