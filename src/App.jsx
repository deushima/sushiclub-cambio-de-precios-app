import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react';
import { parsePriceWorkbook, priceRowsForProduct } from './lib/priceWorkbook.js';
import { analyzeSvgFiles, exportPriceZip } from './lib/svgBatch.js';
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
  const [smartFolderMatching, setSmartFolderMatching] = useState(true);

  const products = workbook?.products ?? [];
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

  const priceRows = useMemo(
    () => priceRowsForProduct(selectedProduct, channel, folderMode),
    [selectedProduct, channel, folderMode]
  );

  const selectedRows = useMemo(() => {
    if (!priceRows.length) return [];
    if (!selectedPriceIds.size) return priceRows.filter((row) => row.normal && row.eminent);
    return priceRows.filter((row) => selectedPriceIds.has(row.id));
  }, [priceRows, selectedPriceIds]);

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
      const firstClub = parsed.products.find((product) =>
        normalizeSearch(product.name).includes('club ejecutivo')
      );
      setSelectedProductKey(firstClub?.key ?? parsed.products[0]?.key ?? '');
    } catch (error) {
      setWorkbookError(error.message);
    }
  }

  async function handleSvgFolder(event) {
    const files = Array.from(event.target.files ?? []).filter((file) =>
      file.name.toLowerCase().endsWith('.svg')
    );
    setSvgFiles(files);
    setSvgAnalysis([]);
    setLastExport(null);

    if (files.length) {
      const analysis = await analyzeSvgFiles(files);
      setSvgAnalysis(analysis);
    }
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
        smartFolderMatching,
      });
      setLastExport({ type: 'success', ...result });
    } catch (error) {
      setLastExport({ type: 'error', message: error.message });
    } finally {
      setIsExporting(false);
    }
  }

  const readySvgCount = svgAnalysis.filter((item) => item.ok).length;
  const canExport = workbook && selectedProduct && svgFiles.length && selectedRows.length && !isExporting;

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
          {statLabel(svgFiles.length || '-', 'svg')}
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
            {statLabel(priceRows.length || '-', folderMode === 'branches' ? 'locales' : 'grupos')}
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Local</th>
                  <th>Grupo Excel</th>
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
            <FolderOpen size={20} />
            <h2>SVG</h2>
          </div>

          <label className="drop-control">
            <input type="file" accept=".svg" webkitdirectory="true" multiple onChange={handleSvgFolder} />
            <Upload size={18} />
            <span>{svgFiles.length ? `${svgFiles.length} archivos SVG` : 'Carpeta SVG'}</span>
          </label>

          <label className="switch-row">
            <input
              type="checkbox"
              checked={smartFolderMatching}
              onChange={(event) => setSmartFolderMatching(event.target.checked)}
            />
            <span>Usar local detectado</span>
          </label>

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
                  ${item.normalCount} / @{item.eminentCount}
                </small>
              </div>
            ))}
            {svgAnalysis.length > 40 && <p className="empty">+{svgAnalysis.length - 40} mas</p>}
          </div>

          <button type="button" className="primary-button" disabled={!canExport} onClick={handleExport}>
            <Download size={18} />
            <span>{isExporting ? 'Exportando' : 'Exportar ZIP'}</span>
          </button>

          {lastExport?.type === 'success' && (
            <div className="notice notice-success">
              <Check size={17} />
              <span>
                {lastExport.generatedCount} SVG generados. {lastExport.warningCount} con aviso.
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
