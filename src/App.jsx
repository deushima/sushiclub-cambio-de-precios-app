import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Images,
  Moon,
  Search,
  Sparkles,
  Sun,
  Type,
  Upload,
} from 'lucide-react';
import { parsePriceWorkbook, priceRowsForProduct } from './lib/priceWorkbook.js';
import { actionOptionsForProducts, ruleForProduct, templateForRow, templateKeysForRule } from './lib/actionRules.js';
import { analyzeSvgFiles, buildPricePreviews, exportPriceZip, summarizeTemplatePlan } from './lib/svgBatch.js';
import {
  DEFAULT_PRICE_TYPOGRAPHY,
  PRICE_FONT_FAMILIES,
  PRICE_FONT_STYLES,
  PRICE_FONT_WEIGHTS,
  resolvePriceTypography,
} from './lib/priceTypography.js';
import { formatPrice, humanNumber, normalizeSearch } from './lib/text.js';

function statLabel(value, label) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function StatusPill({ tone = 'neutral', children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function revokePreviewItems(items) {
  items.forEach((item) => item.pieces.forEach((piece) => URL.revokeObjectURL(piece.url)));
}

function priceGroupKey(row) {
  if (!row.normal || !row.eminent) return row.id;
  return [row.templateName, row.normal, row.eminent].map((part) => String(part ?? '')).join('|');
}

function compactNames(rows, getter) {
  const names = Array.from(new Set(rows.map(getter).filter(Boolean)));
  return names.join(' / ');
}

function buildDisplayPriceRows(priceRows, groupSamePrices) {
  if (!groupSamePrices) {
    return priceRows.map((row) => ({
      id: row.id,
      rows: [row],
      branchLabel: row.branchName,
      groupLabel: row.groupName,
      templateName: row.templateName,
      normal: row.normal,
      eminent: row.eminent,
      ready: Boolean(row.normal && row.eminent),
    }));
  }

  const groups = new Map();
  priceRows.forEach((row) => {
    const key = priceGroupKey(row);
    const group = groups.get(key) ?? { id: key, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  });

  return Array.from(groups.values()).map((group) => {
    const first = group.rows[0];
    return {
      ...group,
      branchLabel: compactNames(group.rows, (row) => row.branchName),
      groupLabel: compactNames(group.rows, (row) => row.groupName),
      templateName: first.templateName,
      normal: first.normal,
      eminent: first.eminent,
      ready: group.rows.every((row) => row.normal && row.eminent),
    };
  });
}

export default function App() {
  const [workbook, setWorkbook] = useState(null);
  const [workbookError, setWorkbookError] = useState('');
  const [query, setQuery] = useState('club ejecutivo');
  const [selectedProductKey, setSelectedProductKey] = useState('');
  const [channel, setChannel] = useState('salon');
  const [folderMode, setFolderMode] = useState('branches');
  const [selectedPriceIds, setSelectedPriceIds] = useState(new Set());
  const [svgFiles, setSvgFiles] = useState([]);
  const [svgAnalysis, setSvgAnalysis] = useState([]);
  const [isExporting, setIsExporting] = useState(false);
  const [lastExport, setLastExport] = useState(null);
  const [exportTab, setExportTab] = useState('files');
  const [outputFormat, setOutputFormat] = useState('png');
  const [includeStaticAssets, setIncludeStaticAssets] = useState(false);
  const [groupSamePrices, setGroupSamePrices] = useState(true);
  const [theme, setTheme] = useState(() => {
    try {
      return window.localStorage.getItem('sushiclub-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [previewItems, setPreviewItems] = useState([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewProgress, setPreviewProgress] = useState(null);
  const [priceTypography, setPriceTypography] = useState(DEFAULT_PRICE_TYPOGRAPHY);
  const [exportProgress, setExportProgress] = useState(null);

  const products = workbook?.products ?? [];
  const actionOptions = useMemo(() => actionOptionsForProducts(products), [products]);
  const visibleProducts = useMemo(() => {
    const search = normalizeSearch(query);
    return products
      .filter((product) => {
        if (!search) return true;
        return (
          normalizeSearch(product.name).includes(search) ||
          normalizeSearch(product.code).includes(search)
        );
      })
      .slice(0, 80);
  }, [products, query]);

  const selectedProduct = useMemo(() => {
    if (!products.length) return null;
    return products.find((product) => product.key === selectedProductKey) ?? visibleProducts[0] ?? products[0];
  }, [products, selectedProductKey, visibleProducts]);

  const actionRule = useMemo(() => ruleForProduct(selectedProduct), [selectedProduct]);

  const priceRows = useMemo(() => {
    return priceRowsForProduct(selectedProduct, channel, folderMode).map((row) => ({
      ...row,
      templateName: templateForRow(row, actionRule),
    }));
  }, [selectedProduct, channel, folderMode, actionRule]);

  const selectedRows = useMemo(() => {
    if (!priceRows.length) return [];
    if (!selectedPriceIds.size) return priceRows.filter((row) => row.normal && row.eminent);
    return priceRows.filter((row) => selectedPriceIds.has(row.id));
  }, [priceRows, selectedPriceIds]);
  const selectedIdSet = useMemo(() => {
    if (selectedPriceIds.size) return selectedPriceIds;
    return new Set(priceRows.filter((row) => row.normal && row.eminent).map((row) => row.id));
  }, [priceRows, selectedPriceIds]);
  const displayPriceRows = useMemo(
    () => buildDisplayPriceRows(priceRows, groupSamePrices),
    [priceRows, groupSamePrices]
  );
  const resolvedTypography = useMemo(() => resolvePriceTypography(priceTypography), [priceTypography]);

  const svgPlan = useMemo(() => {
    return summarizeTemplatePlan({
      svgFiles,
      priceRows: selectedRows,
      productName: selectedProduct?.name ?? '',
      actionRule,
      groupSamePrices,
    });
  }, [svgFiles, selectedRows, selectedProduct, actionRule, groupSamePrices]);

  const outputCounts = useMemo(() => {
    const includeSvg = outputFormat === 'svg' || outputFormat === 'both';
    const includePng = outputFormat === 'png' || outputFormat === 'both';
    const generatedSvgCount = includeSvg ? svgPlan.generatedSvgCount : 0;
    const generatedPngCount = includePng ? svgPlan.generatedPngCount : 0;
    const generatedStaticCount = includePng && includeStaticAssets ? svgPlan.generatedStaticCount : 0;

    return {
      generatedSvgCount,
      generatedPngCount,
      generatedStaticCount,
      generatedCount: generatedSvgCount + generatedPngCount + generatedStaticCount,
      outputFolderCount: svgPlan.outputFolderCount,
    };
  }, [includeStaticAssets, outputFormat, svgPlan]);

  useEffect(() => {
    let mounted = true;

    async function refreshAnalysis() {
      if (!svgFiles.length) {
        setSvgAnalysis([]);
        return;
      }

      const analysis = await analyzeSvgFiles(svgFiles, {
        productName: selectedProduct?.name ?? '',
        actionRule,
      });

      if (mounted) setSvgAnalysis(analysis);
    }

    refreshAnalysis();
    return () => {
      mounted = false;
    };
  }, [svgFiles, selectedProduct, actionRule]);

  useEffect(() => {
    let mounted = true;

    async function refreshPreviews() {
      setPreviewError('');
      setIsPreviewing(Boolean(svgFiles.length && selectedRows.length));
      setPreviewItems([]);
      setPreviewProgress(null);

      if (!svgFiles.length || !selectedRows.length || svgPlan.missingTemplates.length) {
        setIsPreviewing(false);
        setPreviewProgress(null);
        return;
      }

      setPreviewProgress({
        done: 0,
        total: Math.min(selectedRows.filter((row) => row.normal && row.eminent).length, 12),
        stage: 'Preparando',
        current: '',
      });

      try {
        const items = await buildPricePreviews({
          svgFiles,
          priceRows: selectedRows,
          productName: selectedProduct?.name ?? '',
          actionRule,
          priceTypography: resolvedTypography,
          onProgress: (progress) => {
            if (mounted) setPreviewProgress(progress);
          },
        });

        if (mounted) setPreviewItems(items);
        else revokePreviewItems(items);
      } catch (error) {
        if (mounted) setPreviewError(error.message);
      } finally {
        if (mounted) setIsPreviewing(false);
        if (mounted) setPreviewProgress(null);
      }
    }

    refreshPreviews();
    return () => {
      mounted = false;
    };
  }, [svgFiles, selectedRows, selectedProduct, actionRule, resolvedTypography, svgPlan.missingTemplates]);

  useEffect(() => {
    return () => revokePreviewItems(previewItems);
  }, [previewItems]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('sushiclub-theme', theme);
    } catch {
      // La app sigue funcionando aunque el navegador bloquee localStorage.
    }
  }, [theme]);

  async function handleWorkbook(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setWorkbookError('');
    setWorkbook(null);
    setSelectedProductKey('');
    setSelectedPriceIds(new Set());
    setLastExport(null);

    try {
      const parsed = await parsePriceWorkbook(file);
      setWorkbook(parsed);
      const options = actionOptionsForProducts(parsed.products);
      const firstClub = options.find((option) => option.id === 'menu-club-ejecutivo');
      const preferred = firstClub ?? options[0];
      setSelectedProductKey(preferred?.productKey ?? parsed.products[0]?.key ?? '');
      setQuery(preferred?.label ?? '');
    } catch (error) {
      setWorkbookError(error.message);
    }
  }

  async function handleSvgFolder(event) {
    const files = Array.from(event.target.files ?? []).filter((file) => file.name && !file.name.startsWith('.'));
    setSvgFiles(files);
    setSvgAnalysis([]);
    setLastExport(null);
  }

  function toggleRows(ids) {
    setSelectedPriceIds((current) => {
      const next = current.size
        ? new Set(current)
        : new Set(priceRows.filter((row) => row.normal && row.eminent).map((row) => row.id));
      const allSelected = ids.every((id) => next.has(id));
      ids.forEach((id) => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }

  function selectAllRows() {
    setSelectedPriceIds(new Set(priceRows.map((row) => row.id)));
  }

  function selectReadyRows() {
    setSelectedPriceIds(new Set(priceRows.filter((row) => row.normal && row.eminent).map((row) => row.id)));
  }

  async function handleExport() {
    setIsExporting(true);
    setLastExport(null);
    setExportProgress({ done: 0, total: outputCounts.generatedCount, stage: 'Preparando', current: '' });

    try {
      const result = await exportPriceZip({
        svgFiles,
        priceRows: selectedRows,
        productName: selectedProduct?.name,
        actionRule,
        priceTypography: resolvedTypography,
        outputFormat,
        includeStaticAssets,
        groupSamePrices,
        onProgress: setExportProgress,
      });
      setLastExport({ type: 'success', ...result });
    } catch (error) {
      const message = error.name === 'AbortError' ? 'Exportacion cancelada.' : error.message;
      setLastExport({ type: 'error', message });
    } finally {
      setExportProgress(null);
      setIsExporting(false);
    }
  }

  const readySvgCount = svgAnalysis.filter((item) => item.ok).length;
  const canExport =
    workbook &&
    selectedProduct &&
    svgFiles.length &&
    selectedRows.length &&
    svgPlan.generatedCount > 0 &&
    !svgPlan.missingTemplates.length &&
    !isExporting;
  const exportPanelTitle = exportTab === 'files' ? 'Archivos' : exportTab === 'download' ? 'Descarga' : 'Tipografia';
  const exportPanelIcon =
    exportTab === 'files' ? <FolderOpen size={20} /> : exportTab === 'download' ? <Download size={20} /> : <Type size={20} />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">SUSHICLUB</p>
          <h1>Cambio de precios</h1>
        </div>
        <div className="topbar-right">
          <div className="topbar-stats">
            {statLabel(workbook?.sheetName ?? '-', 'hoja')}
            {statLabel(products.length || '-', 'items')}
            {statLabel(svgAnalysis.length || '-', 'svg')}
          </div>
          <button
            type="button"
            className="theme-toggle"
            aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          >
            <Sun size={14} />
            <span className="theme-track">
              <span className="theme-thumb" />
            </span>
            <Moon size={14} />
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="panel input-panel">
          <div className="panel-title">
            <FileSpreadsheet size={20} />
            <h2>Precios</h2>
          </div>

          <label className="drop-control">
            <input type="file" accept=".xlsx,.xls" onChange={handleWorkbook} />
            <Upload size={18} />
            <span>{workbook ? workbook.fileName : 'Excel mensual'}</span>
          </label>

          {workbookError && (
            <div className="notice notice-error">
              <AlertTriangle size={17} />
              <span>{workbookError}</span>
            </div>
          )}

          {workbook?.warnings.map((warning) => (
            <div className="notice" key={warning}>
              <AlertTriangle size={17} />
              <span>{warning}</span>
            </div>
          ))}

          <div className="action-tabs">
            {actionOptions.slice(0, 8).map((option) => (
              <button
                type="button"
                key={option.id}
                className={[
                  option.productKey === selectedProduct?.key ? 'active' : '',
                  option.featured ? 'featured' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  setSelectedProductKey(option.productKey);
                  setSelectedPriceIds(new Set());
                  setLastExport(null);
                  setQuery(option.label);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="field">
            <label htmlFor="product-search">Accion</label>
            <div className="searchbox">
              <Search size={17} />
              <input
                id="product-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar producto"
              />
            </div>
          </div>

          <div className="product-list">
            {visibleProducts.map((product) => (
              <button
                type="button"
                key={product.key}
                className={product.key === selectedProduct?.key ? 'product-row active' : 'product-row'}
                onClick={() => {
                  setSelectedProductKey(product.key);
                  setSelectedPriceIds(new Set());
                  setLastExport(null);
                }}
              >
                <span>{product.name}</span>
                <small>{product.code || 'sin codigo'}</small>
              </button>
            ))}
            {!visibleProducts.length && <p className="empty">Sin resultados.</p>}
          </div>

          <div className="segmented" aria-label="Canal">
            <button className={channel === 'salon' ? 'active' : ''} onClick={() => setChannel('salon')}>
              Salon
            </button>
            <button className={channel === 'deli' ? 'active' : ''} onClick={() => setChannel('deli')}>
              Deli
            </button>
          </div>

          <div className="segmented" aria-label="Carpetas">
            <button className={folderMode === 'branches' ? 'active' : ''} onClick={() => setFolderMode('branches')}>
              Locales
            </button>
            <button className={folderMode === 'groups' ? 'active' : ''} onClick={() => setFolderMode('groups')}>
              Grupos
            </button>
          </div>
        </aside>

        <section className="panel price-panel">
          <div className="panel-title panel-title-row">
            <div>
              <Sparkles size={20} />
              <h2>{selectedProduct?.name ?? 'Seleccion pendiente'}</h2>
            </div>
            <div className="panel-actions">
              <button type="button" className="ghost-button" onClick={selectReadyRows}>
                Listos
              </button>
              <button type="button" className="ghost-button" onClick={selectAllRows}>
                Todos
              </button>
            </div>
          </div>

          <div className="price-summary">
            {statLabel(selectedRows.length || '-', 'locales seleccionados')}
            {statLabel(priceRows.filter((row) => row.normal && row.eminent).length || '-', 'con 2 precios')}
            {statLabel(displayPriceRows.length || '-', groupSamePrices ? 'bloques' : 'filas')}
            {statLabel(outputCounts.outputFolderCount || '-', 'carpetas')}
            {statLabel(outputCounts.generatedPngCount || '-', 'png')}
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Local</th>
                  <th>Grupo Excel</th>
                  <th>Plantilla</th>
                  <th>Normal</th>
                  <th>Eminent</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {displayPriceRows.map((group) => {
                  const ids = group.rows.map((row) => row.id);
                  const checked = ids.every((id) => selectedIdSet.has(id));
                  const ready = group.ready;

                  return (
                    <tr
                      key={group.id}
                      className={`${ready ? '' : 'muted-row'} ${group.rows.length > 1 ? 'grouped-row' : ''}`.trim()}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRows(ids)}
                          aria-label={`Seleccionar ${group.branchLabel}`}
                        />
                      </td>
                      <td>
                        <strong>{group.branchLabel}</strong>
                        {group.rows.length > 1 && <small className="group-count">{group.rows.length} locales</small>}
                      </td>
                      <td>{group.groupLabel}</td>
                      <td>{group.templateName}</td>
                      <td>{formatPrice(group.normal) || humanNumber(group.normal) || '-'}</td>
                      <td>{formatPrice(group.eminent) || humanNumber(group.eminent) || '-'}</td>
                      <td>
                        {ready ? <StatusPill tone="ok">OK</StatusPill> : <StatusPill tone="warn">Revisar</StatusPill>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="panel export-panel">
          <div className="panel-title">
            {exportPanelIcon}
            <h2>{exportPanelTitle}</h2>
          </div>

          <div className="panel-tabs" role="tablist" aria-label="Exportacion">
            <button
              type="button"
              className={exportTab === 'files' ? 'active' : ''}
              onClick={() => setExportTab('files')}
            >
              Archivos
            </button>
            <button
              type="button"
              className={exportTab === 'download' ? 'active' : ''}
              onClick={() => setExportTab('download')}
            >
              Descarga
            </button>
            <button
              type="button"
              className={exportTab === 'typography' ? 'active' : ''}
              onClick={() => setExportTab('typography')}
            >
              Tipografia
            </button>
          </div>

          {exportTab === 'files' ? (
            <>
              <label className="drop-control">
                <input type="file" webkitdirectory="true" multiple onChange={handleSvgFolder} />
                <Upload size={18} />
                <span>{svgFiles.length ? `${svgFiles.length} archivos` : 'Carpeta accion'}</span>
              </label>

              <div className="template-list">
                {templateKeysForRule(actionRule).map((templateName) => {
                  const count = svgPlan.templateCounts.find((item) => item.name === templateName)?.count ?? 0;
                  const missing = svgPlan.missingTemplates.includes(templateName);
                  return (
                    <div className="template-row" key={templateName}>
                      <span>{templateName}</span>
                      <small>{count} SVG</small>
                      {missing && <StatusPill tone="warn">Falta</StatusPill>}
                    </div>
                  );
                })}
              </div>

              <div className="svg-health">
                {statLabel(readySvgCount || '-', 'listos')}
                {statLabel(svgAnalysis.length - readySvgCount || '-', 'alertas')}
              </div>

              <div className="svg-list">
                {svgAnalysis.slice(0, 40).map((item) => (
                  <div className="svg-row" key={item.path}>
                    {item.ok ? <Check size={16} /> : <AlertTriangle size={16} />}
                    <span title={item.path}>{item.name}</span>
                    <small>
                      {item.templateName} / ${item.normalCount} / @{item.eminentCount}
                      {item.unresolvedImageCount ? ` / ${item.unresolvedImageCount} imagenes no embebidas` : ''}
                    </small>
                  </div>
                ))}
                {svgAnalysis.length > 40 && <p className="empty">+{svgAnalysis.length - 40} mas</p>}
              </div>
            </>
          ) : exportTab === 'download' ? (
            <div className="download-panel">
              <div className="format-options" aria-label="Formato de descarga">
                <button
                  type="button"
                  className={outputFormat === 'png' ? 'active' : ''}
                  onClick={() => setOutputFormat('png')}
                >
                  Solo PNG
                </button>
                <button
                  type="button"
                  className={outputFormat === 'svg' ? 'active' : ''}
                  onClick={() => setOutputFormat('svg')}
                >
                  Solo SVG
                </button>
                <button
                  type="button"
                  className={outputFormat === 'both' ? 'active' : ''}
                  onClick={() => setOutputFormat('both')}
                >
                  PNG + SVG
                </button>
              </div>

              <div className="download-summary">
                {statLabel(outputCounts.generatedPngCount || '-', 'png')}
                {statLabel(outputCounts.generatedSvgCount || '-', 'svg')}
                {statLabel(outputCounts.outputFolderCount || '-', 'carpetas')}
              </div>

              <label className={outputFormat === 'svg' ? 'check-row disabled' : 'check-row'}>
                <input
                  type="checkbox"
                  checked={includeStaticAssets}
                  disabled={outputFormat === 'svg'}
                  onChange={(event) => setIncludeStaticAssets(event.target.checked)}
                />
                <span>Incluir PNG ya existentes</span>
              </label>

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={groupSamePrices}
                  onChange={(event) => setGroupSamePrices(event.target.checked)}
                />
                <span>Agrupar locales con mismo precio</span>
              </label>

              <p className="hint">
                En Chrome guarda directo en una carpeta para no cargar un ZIP gigante en memoria.
              </p>
            </div>
          ) : (
            <div className="typography-panel">
              <style>
                {`@font-face{font-family:${JSON.stringify(resolvedTypography.family)};src:url("${resolvedTypography.url}") format("opentype");font-weight:${resolvedTypography.cssWeight};font-style:${resolvedTypography.style};}`}
              </style>

              <div className="field">
                <label htmlFor="price-font-family">Familia</label>
                <select
                  id="price-font-family"
                  value={priceTypography.family}
                  onChange={(event) =>
                    setPriceTypography((current) => ({ ...current, family: event.target.value }))
                  }
                >
                  {PRICE_FONT_FAMILIES.map((family) => (
                    <option key={family} value={family}>
                      {family}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="price-font-weight">Peso</label>
                <select
                  id="price-font-weight"
                  value={priceTypography.weight}
                  onChange={(event) =>
                    setPriceTypography((current) => ({ ...current, weight: event.target.value }))
                  }
                >
                  {PRICE_FONT_WEIGHTS.map((weight) => (
                    <option key={weight.id} value={weight.id}>
                      {weight.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="price-font-style">Estilo</label>
                <select
                  id="price-font-style"
                  value={priceTypography.style}
                  onChange={(event) =>
                    setPriceTypography((current) => ({ ...current, style: event.target.value }))
                  }
                >
                  {PRICE_FONT_STYLES.map((style) => (
                    <option key={style.id} value={style.id}>
                      {style.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="font-preview">
                <span
                  style={{
                    fontFamily: `"${resolvedTypography.family}", sans-serif`,
                    fontWeight: resolvedTypography.cssWeight,
                    fontStyle: resolvedTypography.style,
                  }}
                >
                  $34.000
                </span>
                <small>{resolvedTypography.fileName}</small>
              </div>
            </div>
          )}

          <button type="button" className="primary-button" disabled={!canExport} onClick={handleExport}>
            <Download size={18} />
            <span>{isExporting ? 'Exportando' : 'Descargar contenido'}</span>
          </button>

          {isExporting && exportProgress && (
            <div className="export-progress" aria-live="polite">
              <div className="progress-bar">
                <span
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round(((exportProgress.done || 0) / Math.max(1, exportProgress.total || 1)) * 100),
                    )}%`,
                  }}
                />
              </div>
              <strong>
                {exportProgress.done || 0} / {exportProgress.total || 0}
              </strong>
              <small>
                {exportProgress.stage}
                {exportProgress.current ? ` - ${exportProgress.current}` : ''}
              </small>
            </div>
          )}

          {lastExport?.type === 'success' && (
            <div className="notice notice-success">
              <Check size={17} />
              <span>
                {lastExport.generatedCount} archivos generados ({lastExport.generatedSvgCount} SVG,{' '}
                {lastExport.generatedPngCount} PNG). {lastExport.destination}.{' '}
                {lastExport.warningCount} con aviso.
              </span>
            </div>
          )}

          {lastExport?.type === 'error' && (
            <div className="notice notice-error">
              <AlertTriangle size={17} />
              <span>{lastExport.message}</span>
            </div>
          )}
        </aside>
      </section>

      <section className="panel preview-panel">
        <div className="panel-title panel-title-row">
          <div>
            <Images size={20} />
            <h2>Vista previa</h2>
          </div>
          <span className="preview-counter">
            {previewItems.length ? `${previewItems.length} locales` : isPreviewing ? 'Preparando' : 'Sin preview'}
          </span>
        </div>

        {previewError && (
          <div className="notice notice-error">
            <AlertTriangle size={17} />
            <span>{previewError}</span>
          </div>
        )}

        {!previewError && !isPreviewing && !previewItems.length && (
          <p className="empty">
            Carga el Excel y la carpeta de SVG para ver una muestra de las pildoras ya cambiadas.
          </p>
        )}

        {isPreviewing && <p className="empty">Generando miniaturas...</p>}

        {isPreviewing && previewProgress && (
          <div className="render-progress" aria-live="polite">
            <div className="progress-bar progress-bar-red">
              <span
                style={{
                  width: `${Math.min(
                    100,
                    Math.round(((previewProgress.done || 0) / Math.max(1, previewProgress.total || 1)) * 100),
                  )}%`,
                }}
              />
            </div>
            <small>
              {previewProgress.done || 0} / {previewProgress.total || 0}
              {previewProgress.current ? ` - ${previewProgress.current}` : ''}
            </small>
          </div>
        )}

        <div className="preview-grid">
          {previewItems.map((item) => (
            <article className="preview-card" key={item.id}>
              <div className="preview-card-head">
                <h3>{item.branchName}</h3>
                <small>
                  {item.normalText} / {item.eminentText} / {item.templateName}
                </small>
              </div>

              {item.pieces.map((piece) => (
                <div className="preview-piece" key={piece.url}>
                  <span>{piece.label}</span>
                  <img src={piece.url} alt={`${item.branchName} ${piece.label}`} loading="lazy" />
                </div>
              ))}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
