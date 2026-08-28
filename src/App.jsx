import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Search,
  Sparkles,
  Type,
  Upload,
} from 'lucide-react';
import { parsePriceWorkbook, priceRowsForProduct } from './lib/priceWorkbook.js';
import { actionOptionsForProducts, ruleForProduct, templateForRow, templateKeysForRule } from './lib/actionRules.js';
import { analyzeSvgFiles, exportPriceZip, summarizeTemplatePlan } from './lib/svgBatch.js';
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
  const [priceTypography, setPriceTypography] = useState(DEFAULT_PRICE_TYPOGRAPHY);

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
  const resolvedTypography = useMemo(() => resolvePriceTypography(priceTypography), [priceTypography]);

  const svgPlan = useMemo(() => {
    return summarizeTemplatePlan({
      svgFiles,
      priceRows: selectedRows,
      productName: selectedProduct?.name ?? '',
      actionRule,
    });
  }, [svgFiles, selectedRows, selectedProduct, actionRule]);

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

  function toggleRow(id) {
    setSelectedPriceIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

    try {
      const result = await exportPriceZip({
        svgFiles,
        priceRows: selectedRows,
        productName: selectedProduct?.name,
        actionRule,
        priceTypography: resolvedTypography,
      });
      setLastExport({ type: 'success', ...result });
    } catch (error) {
      setLastExport({ type: 'error', message: error.message });
    } finally {
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">SUSHICLUB</p>
          <h1>Cambio de precios</h1>
        </div>
        <div className="topbar-stats">
          {statLabel(workbook?.sheetName ?? '-', 'hoja')}
          {statLabel(products.length || '-', 'items')}
          {statLabel(svgAnalysis.length || '-', 'svg')}
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
                className={option.productKey === selectedProduct?.key ? 'active' : ''}
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
            {statLabel(selectedRows.length || '-', 'seleccionados')}
            {statLabel(priceRows.filter((row) => row.normal && row.eminent).length || '-', 'con 2 precios')}
            {statLabel(svgPlan.generatedPngCount || '-', 'png')}
            {statLabel(svgPlan.generatedCount || '-', 'salidas')}
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
                {priceRows.map((row) => {
                  const checked = selectedPriceIds.size ? selectedPriceIds.has(row.id) : Boolean(row.normal && row.eminent);
                  const ready = Boolean(row.normal && row.eminent);

                  return (
                    <tr key={row.id} className={ready ? '' : 'muted-row'}>
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRow(row.id)}
                          aria-label={`Seleccionar ${row.branchName}`}
                        />
                      </td>
                      <td>
                        <strong>{row.branchName}</strong>
                      </td>
                      <td>{row.groupName}</td>
                      <td>{row.templateName}</td>
                      <td>{formatPrice(row.normal) || humanNumber(row.normal) || '-'}</td>
                      <td>{formatPrice(row.eminent) || humanNumber(row.eminent) || '-'}</td>
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
            {exportTab === 'files' ? <FolderOpen size={20} /> : <Type size={20} />}
            <h2>{exportTab === 'files' ? 'Archivos' : 'Tipografia'}</h2>
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
                    </small>
                  </div>
                ))}
                {svgAnalysis.length > 40 && <p className="empty">+{svgAnalysis.length - 40} mas</p>}
              </div>
            </>
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
            <span>{isExporting ? 'Exportando' : 'Exportar ZIP'}</span>
          </button>

          {lastExport?.type === 'success' && (
            <div className="notice notice-success">
              <Check size={17} />
              <span>
                {lastExport.generatedCount} archivos generados ({lastExport.generatedSvgCount} SVG,{' '}
                {lastExport.generatedPngCount} PNG).{' '}
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
    </main>
  );
}
