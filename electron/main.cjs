const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

let selectedOutputDirectory = null;

function safeOutputPath(relativePath) {
  if (!selectedOutputDirectory) throw new Error('No hay carpeta de destino seleccionada.');

  const cleanParts = String(relativePath)
    .split(/[\\/]+/)
    .filter(Boolean)
    .filter((part) => part !== '.' && part !== '..');
  const outputPath = path.resolve(selectedOutputDirectory, ...cleanParts);
  const outputRoot = path.resolve(selectedOutputDirectory);

  if (outputPath !== outputRoot && !outputPath.startsWith(`${outputRoot}${path.sep}`)) {
    throw new Error('Ruta de salida invalida.');
  }

  return outputPath;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#171412',
    title: 'SUSHICLUB Cambio de precios',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'dist-desktop', 'index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('sushiclub:select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Elegir carpeta para exportar',
  });

  if (result.canceled || !result.filePaths[0]) return null;
  selectedOutputDirectory = result.filePaths[0];
  return selectedOutputDirectory;
});

ipcMain.handle('sushiclub:write-file', async (_event, relativePath, buffer) => {
  const outputPath = safeOutputPath(relativePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, Buffer.from(buffer));
  return outputPath;
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
