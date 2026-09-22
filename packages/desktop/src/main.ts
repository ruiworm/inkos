import { app, BrowserWindow, Menu, dialog, shell } from "electron";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";

let mainWindow: BrowserWindow | null = null;
let serverInstance: any = null;

function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.listen(startPort, "127.0.0.1", () => {
      server.close(() => resolvePort(startPort));
    });
    server.on("error", () => {
      resolvePort(findAvailablePort(startPort + 1));
    });
  });
}

function resolveStudioStaticDir(): string {
  // If running inside packaged Electron app
  if (app.isPackaged) {
    const packagedDist = join(process.resourcesPath, "studio-dist");
    if (existsSync(packagedDist)) return packagedDist;
  }
  // Development / monorepo path
  const localDist = resolve(__dirname, "../../studio/dist");
  if (existsSync(localDist)) return localDist;
  return resolve(process.cwd(), "packages/studio/dist");
}

function resolveProjectRoot(): string {
  const customRoot = process.env.INKOS_PROJECT_ROOT || process.argv[2];
  if (customRoot && existsSync(customRoot)) {
    return resolve(customRoot);
  }
  // Default workspace in user documents
  const defaultDir = join(app.getPath("documents"), "NovelForge");
  if (!existsSync(defaultDir)) {
    mkdirSync(defaultDir, { recursive: true });
  }
  return defaultDir;
}

async function startBackend(projectRoot: string, port: number, staticDir: string): Promise<void> {
  try {
    let serverModulePath: string;
    if (app.isPackaged) {
      serverModulePath = join(process.resourcesPath, "server", "api", "server.js");
      if (!existsSync(serverModulePath)) {
        serverModulePath = resolve(__dirname, "../../studio/dist/api/server.js");
      }
    } else {
      serverModulePath = resolve(__dirname, "../../studio/dist/api/server.js");
    }

    const { startStudioServer } = await import(serverModulePath);
    serverInstance = await startStudioServer(projectRoot, port, { staticDir });
    console.log(`[NovelForge] Server running at http://127.0.0.1:${port}`);
  } catch (err: any) {
    console.error("[NovelForge] Failed to start backend server:", err);
    dialog.showErrorBox("Startup Error", `Failed to initialize NovelForge engine:\n${err?.message || err}`);
  }
}

function createMainWindow(port: number): void {
  mainWindow = new BrowserWindow({
    title: "NovelForge Studio",
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0d0d0d",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const url = `http://127.0.0.1:${port}`;
  mainWindow.loadURL(url);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith("http:") || targetUrl.startsWith("https:")) {
      shell.openExternal(targetUrl);
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildAppMenu(): void {
  const isMac = process.platform === "darwin";
  const template: any[] = [
    ...(isMac
      ? [
          {
            label: "NovelForge",
            submenu: [
              { role: "about", label: "About NovelForge" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide", label: "Hide NovelForge" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit", label: "Quit NovelForge" },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" }, { role: "front" }, { type: "separator" }, { role: "window" }]
          : [{ role: "close" }]),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Documentation",
          click: () => shell.openExternal("https://github.com/ruiworm/inkos"),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let activePort = 4567;

app.whenReady().then(async () => {
  buildAppMenu();
  const projectRoot = resolveProjectRoot();
  const staticDir = resolveStudioStaticDir();
  activePort = await findAvailablePort(4567);

  await startBackend(projectRoot, activePort, staticDir);
  createMainWindow(activePort);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(activePort);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (serverInstance?.close) {
      serverInstance.close();
    }
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverInstance?.close) {
    serverInstance.close();
  }
});
