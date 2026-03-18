import { app, ipcMain, BrowserWindow, session, Menu, nativeTheme, WebContentsView } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
createRequire(import.meta.url);
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
const SIDEBAR_WIDTH = 250;
const REVEAL_STRIP = 6;
const HOTBAR_HEIGHT = 88;
let win;
let goProcess;
const tabViews = /* @__PURE__ */ new Map();
const tabFavicons = /* @__PURE__ */ new Map();
const tabCustomTitles = /* @__PURE__ */ new Map();
let activeTabId = null;
let hotbar = [];
const STATE_FILE = path.join(app.getPath("userData"), "tabs.json");
function saveTabs() {
  const tabs = [];
  for (const [id, view] of tabViews) {
    tabs.push({
      id,
      url: view.webContents.getURL() || "https://www.google.com",
      title: view.webContents.getTitle() || "",
      favicon: tabFavicons.get(id) || "",
      customTitle: tabCustomTitles.get(id)
    });
  }
  const data = { tabs, activeTabId, hotbar };
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}
function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const data = JSON.parse(raw);
    return {
      tabs: data.tabs || [],
      activeTabId: data.activeTabId || null,
      hotbar: data.hotbar || []
    };
  } catch {
    return { tabs: [], activeTabId: null, hotbar: [] };
  }
}
function generateId() {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
function getFaviconUrl(pageUrl) {
  try {
    const host = new URL(pageUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
  } catch {
    return "";
  }
}
let animationTimer = null;
let currentOffset = SIDEBAR_WIDTH;
function updateActiveViewBounds() {
  if (!win || !activeTabId) return;
  const view = tabViews.get(activeTabId);
  if (!view) return;
  const [width, height] = win.getContentSize();
  view.setBounds({
    x: Math.round(currentOffset),
    y: HOTBAR_HEIGHT,
    width: Math.max(0, width - Math.round(currentOffset)),
    height: Math.max(0, height - HOTBAR_HEIGHT)
  });
}
function animateSidebar(show) {
  if (animationTimer) clearInterval(animationTimer);
  const target = show ? SIDEBAR_WIDTH : REVEAL_STRIP;
  const duration = 320;
  const startOffset = currentOffset;
  const startTime = Date.now();
  animationTimer = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    currentOffset = startOffset + (target - startOffset) * eased;
    updateActiveViewBounds();
    if (progress >= 1) {
      clearInterval(animationTimer);
      animationTimer = null;
      currentOffset = target;
      updateActiveViewBounds();
    }
  }, 8);
}
function attachShortcutListener(wc) {
  wc.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && (input.meta || input.control) && input.shift && input.key.toLowerCase() === "h") {
      _e.preventDefault();
      addToHotBar();
    }
  });
}
function createTab(url, id, savedFavicon, customTitle) {
  if (!win) return "";
  const tabId = id || generateId();
  const view = new WebContentsView();
  tabViews.set(tabId, view);
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  const chromeUA = view.webContents.getUserAgent().replace(/Electron\/\S+\s/, "").replace(/\s*mokea-flow\/\S+/, "");
  view.webContents.setUserAgent(chromeUA);
  const finalUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  tabFavicons.set(tabId, savedFavicon || getFaviconUrl(finalUrl));
  if (customTitle) tabCustomTitles.set(tabId, customTitle);
  view.webContents.loadURL(finalUrl);
  attachShortcutListener(view.webContents);
  view.webContents.on("page-favicon-updated", (_e, favicons) => {
    if (favicons.length > 0) {
      tabFavicons.set(tabId, favicons[0]);
      win == null ? void 0 : win.webContents.send("tab-updated", { id: tabId, favicon: favicons[0] });
      saveTabs();
    }
  });
  view.webContents.on("did-navigate", (_e, navUrl) => {
    win == null ? void 0 : win.webContents.send("tab-updated", {
      id: tabId,
      url: navUrl,
      favicon: tabFavicons.get(tabId) || getFaviconUrl(navUrl)
    });
    saveTabs();
  });
  view.webContents.on("did-navigate-in-page", (_e, navUrl) => {
    win == null ? void 0 : win.webContents.send("tab-updated", { id: tabId, url: navUrl });
    saveTabs();
  });
  view.webContents.on("page-title-updated", (_e, title) => {
    if (!tabCustomTitles.has(tabId)) {
      win == null ? void 0 : win.webContents.send("tab-updated", { id: tabId, title });
    }
    saveTabs();
  });
  view.webContents.setWindowOpenHandler(({ url: url2 }) => {
    const popup = new BrowserWindow({
      width: 500,
      height: 700,
      parent: win,
      modal: false,
      titleBarStyle: "default",
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#1B2D2A" : "#F0FFFE"
    });
    popup.webContents.setUserAgent(chromeUA);
    popup.loadURL(url2);
    popup.webContents.on("will-redirect", (_e, redirectUrl) => {
      try {
        const originalHost = new URL(view.webContents.getURL()).hostname;
        const redirectHost = new URL(redirectUrl).hostname;
        if (originalHost === redirectHost) {
          popup.close();
        }
      } catch {
      }
    });
    return { action: "deny" };
  });
  return tabId;
}
function switchTab(tabId) {
  if (!win || !tabViews.has(tabId)) return;
  if (activeTabId && tabViews.has(activeTabId)) {
    tabViews.get(activeTabId).setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
  activeTabId = tabId;
  updateActiveViewBounds();
  saveTabs();
  const view = tabViews.get(tabId);
  win.webContents.send("tab-switched", {
    id: tabId,
    url: view.webContents.getURL(),
    title: tabCustomTitles.get(tabId) || view.webContents.getTitle(),
    favicon: tabFavicons.get(tabId) || ""
  });
}
function closeTab(tabId) {
  if (!win) return;
  const view = tabViews.get(tabId);
  if (!view) return;
  win.contentView.removeChildView(view);
  view.webContents.close();
  tabViews.delete(tabId);
  tabFavicons.delete(tabId);
  tabCustomTitles.delete(tabId);
  if (activeTabId === tabId) {
    const remaining = Array.from(tabViews.keys());
    if (remaining.length > 0) {
      switchTab(remaining[remaining.length - 1]);
    } else {
      const newId = createTab("https://www.google.com");
      switchTab(newId);
    }
  }
  saveTabs();
}
function addToHotBar(tabId) {
  const id = tabId || activeTabId;
  if (!id) return;
  const view = tabViews.get(id);
  if (!view) return;
  const url = view.webContents.getURL();
  if (hotbar.some((h) => h.url === url)) return;
  const item = {
    id: `hb-${Date.now()}`,
    url,
    title: tabCustomTitles.get(id) || view.webContents.getTitle() || "",
    favicon: tabFavicons.get(id) || getFaviconUrl(url)
  };
  hotbar.push(item);
  saveTabs();
  win == null ? void 0 : win.webContents.send("hotbar-updated", hotbar);
}
function spawnGoBackend() {
  var _a, _b;
  const projectRoot = path.join(process.env.APP_ROOT, "..");
  const backendDir = path.join(projectRoot, "backend");
  if (app.isPackaged) {
    const binaryName = process.platform === "win32" ? "mokea-core.exe" : "mokea-core";
    const binaryPath = path.join(process.resourcesPath, "backend", binaryName);
    goProcess = spawn(binaryPath, [], { cwd: backendDir });
  } else {
    goProcess = spawn("go", ["run", "main.go"], { cwd: backendDir });
  }
  (_a = goProcess.stdout) == null ? void 0 : _a.on("data", (data) => {
    console.log(`[go-backend] ${data.toString().trim()}`);
  });
  (_b = goProcess.stderr) == null ? void 0 : _b.on("data", (data) => {
    console.error(`[go-backend] ${data.toString().trim()}`);
  });
  goProcess.on("close", (code) => {
    console.log(`[go-backend] exited with code ${code}`);
    goProcess = null;
  });
}
function killGoBackend() {
  if (goProcess && !goProcess.killed) {
    goProcess.kill();
    goProcess = null;
  }
}
function setupSessionPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = [
      "media",
      "geolocation",
      "notifications",
      "fullscreen",
      "clipboard-read",
      "clipboard-sanitized-write",
      "hid",
      "usb",
      "serial"
    ];
    callback(allowed.includes(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => {
    const allowed = [
      "media",
      "geolocation",
      "notifications",
      "fullscreen",
      "clipboard-read",
      "clipboard-sanitized-write",
      "hid",
      "usb",
      "serial"
    ];
    return allowed.includes(permission);
  });
}
function createWindow() {
  setupSessionPermissions();
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 680,
    minHeight: 400,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1B2D2A" : "#75DDDD",
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs")
    }
  });
  attachShortcutListener(win.webContents);
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
  const saved = loadState();
  hotbar = saved.hotbar;
  if (saved.tabs.length > 0) {
    for (const tab of saved.tabs) {
      createTab(tab.url, tab.id, tab.favicon, tab.customTitle);
    }
    switchTab(saved.activeTabId && tabViews.has(saved.activeTabId) ? saved.activeTabId : saved.tabs[0].id);
    win.webContents.on("did-finish-load", () => {
      win == null ? void 0 : win.webContents.send("tabs-restored", {
        tabs: saved.tabs,
        activeTabId,
        hotbar
      });
    });
  } else {
    const firstId = createTab("https://www.google.com");
    switchTab(firstId);
    win.webContents.on("did-finish-load", () => {
      win == null ? void 0 : win.webContents.send("tabs-restored", {
        tabs: [{ id: firstId, url: "https://www.google.com", title: "Google", favicon: getFaviconUrl("https://www.google.com") }],
        activeTabId: firstId,
        hotbar
      });
    });
  }
  win.on("resize", updateActiveViewBounds);
  win.on("closed", () => {
    win = null;
    tabViews.clear();
    tabFavicons.clear();
    tabCustomTitles.clear();
    activeTabId = null;
  });
}
ipcMain.handle("create-tab", (_e, url) => {
  const id = createTab(url);
  switchTab(id);
  const finalUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return { id, url: finalUrl, title: "", favicon: getFaviconUrl(url) };
});
ipcMain.on("switch-tab", (_e, tabId) => {
  switchTab(tabId);
});
ipcMain.on("close-tab", (_e, tabId) => {
  closeTab(tabId);
});
ipcMain.on("sidebar-toggle", (_e, visible) => {
  animateSidebar(visible);
});
ipcMain.on("add-to-hotbar", (_e, tabId) => {
  addToHotBar(tabId);
});
ipcMain.on("remove-from-hotbar", (_e, itemId) => {
  hotbar = hotbar.filter((h) => h.id !== itemId);
  saveTabs();
  win == null ? void 0 : win.webContents.send("hotbar-updated", hotbar);
});
ipcMain.handle("hotbar-click", (_e, url) => {
  for (const [id2, view] of tabViews) {
    if (view.webContents.getURL() === url) {
      switchTab(id2);
      return { id: id2, existing: true };
    }
  }
  const id = createTab(url);
  switchTab(id);
  return { id, url, title: "", favicon: getFaviconUrl(url), existing: false };
});
ipcMain.on("rename-tab", (_e, tabId, newTitle) => {
  if (newTitle.trim()) {
    tabCustomTitles.set(tabId, newTitle.trim());
  } else {
    tabCustomTitles.delete(tabId);
    const view = tabViews.get(tabId);
    if (view) {
      win == null ? void 0 : win.webContents.send("tab-updated", { id: tabId, title: view.webContents.getTitle() });
    }
  }
  saveTabs();
});
ipcMain.handle("duplicate-tab", (_e, tabId) => {
  const view = tabViews.get(tabId);
  if (!view) return null;
  const url = view.webContents.getURL();
  const id = createTab(url);
  switchTab(id);
  return { id, url, title: "", favicon: getFaviconUrl(url) };
});
ipcMain.handle("get-tab-url", (_e, tabId) => {
  const view = tabViews.get(tabId);
  return (view == null ? void 0 : view.webContents.getURL()) || "";
});
ipcMain.on("close-other-tabs", (_e, keepTabId) => {
  const toClose = Array.from(tabViews.keys()).filter((id) => id !== keepTabId);
  for (const id of toClose) {
    const view = tabViews.get(id);
    if (view && win) {
      win.contentView.removeChildView(view);
      view.webContents.close();
      tabViews.delete(id);
      tabFavicons.delete(id);
      tabCustomTitles.delete(id);
    }
  }
  switchTab(keepTabId);
  saveTabs();
});
function setupMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...isMac ? [{
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    }] : [],
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" }
      ]
    },
    {
      label: "HotBar",
      submenu: [
        {
          label: "Pin Current Page",
          accelerator: "CommandOrControl+Shift+H",
          click: () => addToHotBar()
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
app.whenReady().then(() => {
  setupMenu();
  spawnGoBackend();
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.on("before-quit", async () => {
  saveTabs();
  await session.defaultSession.cookies.flushStore();
  killGoBackend();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
