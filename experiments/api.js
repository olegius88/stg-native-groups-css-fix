"use strict";

/* global ExtensionAPI, Cc, Ci, Services, IOUtils, PathUtils, ChromeUtils */

const BEGIN_MARKER = "/* === BEGIN STG-NATIVE-GROUPS-CSS-FIX === */";
const END_MARKER = "/* === END STG-NATIVE-GROUPS-CSS-FIX === */";

let currentURI = null;

function getStyleSheetService() {
  return Cc["@mozilla.org/content/style-sheet-service;1"].getService(
    Ci.nsIStyleSheetService
  );
}

function getSessionStore() {
  try {
    return ChromeUtils.importESModule(
      "resource:///modules/sessionstore/SessionStore.sys.mjs"
    ).SessionStore;
  } catch (_) {
    try {
      return Cc["@mozilla.org/browser/sessionstore;1"]?.getService(
        Ci.nsISessionStore
      );
    } catch (_) {
      return null;
    }
  }
}

function unregisterLiveSheet() {
  if (!currentURI) {
    return;
  }
  try {
    const sss = getStyleSheetService();
    if (sss.sheetRegistered(currentURI, sss.AGENT_SHEET)) {
      sss.unregisterSheet(currentURI, sss.AGENT_SHEET);
    }
  } catch (e) {
    console.error("[STG userChrome Fix] unregisterLiveSheet error:", e);
  }
  currentURI = null;
}

function registerLiveSheet(cssText) {
  unregisterLiveSheet();
  if (!cssText || !cssText.trim()) {
    return false;
  }
  try {
    const sss = getStyleSheetService();
    const encoded = encodeURIComponent(cssText);
    currentURI = Services.io.newURI("data:text/css;charset=utf-8," + encoded);
    sss.loadAndRegisterSheet(currentURI, sss.AGENT_SHEET);
    return sss.sheetRegistered(currentURI, sss.AGENT_SHEET);
  } catch (e) {
    console.error("[STG userChrome Fix] registerLiveSheet error:", e);
    return false;
  }
}

function getUserChromePaths() {
  const profileDir = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
  const chromeDir = PathUtils.join(profileDir, "chrome");
  const userChromePath = PathUtils.join(chromeDir, "userChrome.css");
  return { profileDir, chromeDir, userChromePath };
}

function stripManagedBlock(content) {
  if (!content) {
    return "";
  }
  const startIdx = content.indexOf(BEGIN_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = content.slice(0, startIdx).trimEnd();
    const after = content.slice(endIdx + END_MARKER.length).trimStart();
    if (before && after) {
      return before + "\n\n" + after + "\n";
    }
    if (before) {
      return before + "\n";
    }
    if (after) {
      return after + "\n";
    }
    return "";
  }
  return content;
}

async function writeToUserChromeFile(cssText) {
  const { chromeDir, userChromePath } = getUserChromePaths();
  Services.prefs.setBoolPref(
    "toolkit.legacyUserProfileCustomizations.stylesheets",
    true
  );

  await IOUtils.makeDirectory(chromeDir, { ignoreExisting: true });

  let existing = "";
  if (await IOUtils.exists(userChromePath)) {
    existing = await IOUtils.readUTF8(userChromePath);
  }

  const cleaned = stripManagedBlock(existing).trimEnd();
  if (!cssText || !cssText.trim()) {
    await IOUtils.writeUTF8(userChromePath, cleaned ? cleaned + "\n" : "");
    return { written: false, userChromePath };
  }

  const block = `${BEGIN_MARKER}\n${cssText.trim()}\n${END_MARKER}\n`;
  const finalContent = cleaned ? `${cleaned}\n\n${block}` : block;
  await IOUtils.writeUTF8(userChromePath, finalContent);
  return { written: true, userChromePath };
}

async function removeFromUserChromeFile() {
  const { userChromePath } = getUserChromePaths();
  if (!(await IOUtils.exists(userChromePath))) {
    return { removed: true, userChromePath };
  }
  const existing = await IOUtils.readUTF8(userChromePath);
  const cleaned = stripManagedBlock(existing);
  await IOUtils.writeUTF8(userChromePath, cleaned);
  return { removed: true, userChromePath };
}

function findNativeTab(context, tabId) {
  try {
    const tabObj = context.extension.tabManager.get(tabId);
    if (tabObj) {
      if (tabObj.nativeTab) return tabObj.nativeTab;
      if (tabObj._nativeTab) return tabObj._nativeTab;
    }
  } catch (_) {}
  try {
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      if (win.gBrowser) {
        for (const tab of win.gBrowser.tabs) {
          const wrapper = context.extension.tabManager.getWrapper(tab);
          if (wrapper && wrapper.id === tabId) {
            return tab;
          }
        }
      }
    }
  } catch (_) {}
  return null;
}

let previewEnhancementsEnabled = true;
const windowCleanupHandlers = new Map();

// --- Debug log: <profile>/stg-native-groups-debug.log (keeps last session only) ---
let debugLogPath = null;
let debugLogChain = Promise.resolve();
function dbg(msg) {
  try {
    if (!debugLogPath) {
      debugLogPath = PathUtils.join(
        Services.dirsvc.get("ProfD", Ci.nsIFile).path,
        "stg-native-groups-debug.log"
      );
      debugLogChain = debugLogChain.then(() =>
        IOUtils.writeUTF8(debugLogPath, "").catch(() => {})
      );
    }
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    debugLogChain = debugLogChain.then(() =>
      IOUtils.writeUTF8(debugLogPath, line, { mode: "append" }).catch(() => {})
    );
  } catch (_) {}
}
dbg("api.js loaded");

const CLOSE_ICON_CLASS = "group-preview-tab-close";

function getEventElement(event) {
  let node = event.originalTarget || event.target;
  if (node && node.nodeType !== 1) node = node.parentNode;
  return node && node.closest ? node : null;
}

function getPreviewButton(event) {
  const el = getEventElement(event);
  if (!el) return null;
  const btn = el.closest(".group-preview-button");
  if (!btn || !btn.closest("#tabgroup-preview-panel")) return null;
  return btn;
}

function isCloseIconEvent(event) {
  const el = getEventElement(event);
  return !!(el && el.closest("." + CLOSE_ICON_CLASS));
}

function enhanceWindow(win) {
  if (!win || !win.document || windowCleanupHandlers.has(win)) return;
  const doc = win.document;
  if (doc.documentElement.getAttribute("windowtype") !== "navigator:browser") {
    return;
  }

  let suppressUntil = 0;

  // Add [×] icons to already-rendered preview buttons.
  // toolbarbutton inside a never-opened <panel> renders lazily on popupshowing,
  // and render() bails out if the button already has foreign children, so we
  // only decorate buttons that already contain .toolbarbutton-text.
  function decorate() {
    if (!previewEnhancementsEnabled) return;
    try {
      const content = doc.getElementById("tabgroup-panel-content");
      if (!content) return;
      let added = 0;
      for (const btn of content.querySelectorAll(".group-preview-button")) {
        if (!btn.querySelector(":scope > .toolbarbutton-text")) continue;
        if (btn.querySelector(":scope > ." + CLOSE_ICON_CLASS)) continue;
        const img = doc.createXULElement("image");
        img.className = CLOSE_ICON_CLASS;
        img.setAttribute("tooltiptext", "Закрыть вкладку");
        btn.appendChild(img);
        added++;
      }
      if (added) dbg(`decorate: added ${added} close icons`);
    } catch (e) {
      dbg("decorate error: " + e);
    }
  }

  function closeTab(tab) {
    if (tab && win.gBrowser && !tab.closing) {
      win.gBrowser.removeTab(tab, { animate: true });
    }
  }

  function stop(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  const handlers = {
    popupshown(event) {
      const t = event.originalTarget;
      if (t && t.id === "tabgroup-preview-panel") decorate();
    },
    TabGroupPreviewUpdated() {
      decorate();
      win.requestAnimationFrame(decorate);
    },
    mousedown(event) {
      if (!previewEnhancementsEnabled || event.button !== 0) return;
      if (!isCloseIconEvent(event)) return;
      const btn = getPreviewButton(event);
      if (!btn) return;
      stop(event);
      suppressUntil = Date.now() + 700;
      dbg("close icon mousedown");
      closeTab(btn.tab);
    },
    mouseup(event) {
      if (!previewEnhancementsEnabled) return;
      if (getPreviewButton(event) && (isCloseIconEvent(event) || Date.now() < suppressUntil)) {
        stop(event);
      }
    },
    click(event) {
      if (!previewEnhancementsEnabled) return;
      if (getPreviewButton(event) && (isCloseIconEvent(event) || Date.now() < suppressUntil)) {
        stop(event);
      }
    },
    command(event) {
      if (!previewEnhancementsEnabled) return;
      if (Date.now() < suppressUntil && getPreviewButton(event)) {
        stop(event);
      }
    },
    auxclick(event) {
      if (!previewEnhancementsEnabled || event.button !== 1) return;
      const btn = getPreviewButton(event);
      if (!btn) return;
      stop(event);
      dbg("middle click close");
      closeTab(btn.tab);
    },
    contextmenu(event) {
      if (!previewEnhancementsEnabled) return;
      const btn = getPreviewButton(event);
      if (!btn || !btn.tab) return;
      stop(event);
      const menu = doc.getElementById("tabContextMenu");
      if (!menu) return;
      dbg("contextmenu on preview button");
      // TabContextMenu.updateContextMenu() resolves the tab via
      // triggerNode.tab, and triggerNode = target of the trigger event (btn).
      try {
        menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
      } catch (e) {
        dbg("openPopupAtScreen error: " + e);
      }
      try {
        const panel = doc.getElementById("tabgroup-preview-panel");
        if (panel && panel.state !== "closed") panel.hidePopup();
      } catch (_) {}
    }
  };

  for (const [type, fn] of Object.entries(handlers)) {
    win.addEventListener(type, fn, true);
  }
  decorate();
  dbg("enhanceWindow attached: " + (doc.getElementById("tabgroup-preview-panel") ? "panel found" : "panel NOT found"));

  windowCleanupHandlers.set(win, () => {
    for (const [type, fn] of Object.entries(handlers)) {
      try {
        win.removeEventListener(type, fn, true);
      } catch (_) {}
    }
    try {
      for (const img of doc.querySelectorAll("." + CLOSE_ICON_CLASS)) img.remove();
    } catch (_) {}
  });
}

const winListener = {
  onOpenWindow(xulWin) {
    try {
      const win = xulWin.docShell.domWindow;
      win.addEventListener("load", () => enhanceWindow(win), { once: true });
    } catch (_) {}
  },
  onCloseWindow(xulWin) {
    try {
      const win = xulWin.docShell.domWindow;
      const cleanup = windowCleanupHandlers.get(win);
      if (cleanup) cleanup();
      windowCleanupHandlers.delete(win);
    } catch (_) {}
  }
};

let listenerAttached = false;
function initWindowEnhancements() {
  try {
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      enhanceWindow(win);
    }
    if (!listenerAttached) {
      Services.wm.addListener(winListener);
      listenerAttached = true;
    }
  } catch (e) {
    dbg("initWindowEnhancements error: " + e);
  }
}

function shutdownWindowEnhancements() {
  try {
    if (listenerAttached) {
      Services.wm.removeListener(winListener);
      listenerAttached = false;
    }
  } catch (_) {}
  for (const cleanup of windowCleanupHandlers.values()) {
    try {
      cleanup();
    } catch (_) {}
  }
  windowCleanupHandlers.clear();
}

this.userChromeManager = class extends ExtensionAPI {
  onStartup() {
    initWindowEnhancements();
  }

  onShutdown(isAppShutdown) {
    unregisterLiveSheet();
    shutdownWindowEnhancements();
    if (!isAppShutdown) {
      removeFromUserChromeFile().catch(e =>
        console.error("[STG userChrome Fix] rollback onShutdown error:", e)
      );
      // Remove group-pinned attribute from all tabs if extension uninstalled
      for (const win of Services.wm.getEnumerator("navigator:browser")) {
        if (win.gBrowser) {
          for (const tab of win.gBrowser.tabs) {
            tab.removeAttribute("group-pinned");
          }
        }
      }
    }
  }

  getAPI(context) {
    dbg("getAPI called");
    initWindowEnhancements();
    return {
      userChromeManager: {
        async applyCSS(cssText) {
          const liveActive = registerLiveSheet(cssText);
          const fileRes = await writeToUserChromeFile(cssText);
          return {
            liveActive,
            writtenToFile: fileRes.written,
            userChromePath: fileRes.userChromePath
          };
        },
        async removeCSS() {
          unregisterLiveSheet();
          const fileRes = await removeFromUserChromeFile();
          return {
            liveActive: false,
            writtenToFile: false,
            userChromePath: fileRes.userChromePath
          };
        },
        async getStatus() {
          const { userChromePath } = getUserChromePaths();
          let hasBlockInFile = false;
          try {
            if (await IOUtils.exists(userChromePath)) {
              const txt = await IOUtils.readUTF8(userChromePath);
              hasBlockInFile =
                txt.includes(BEGIN_MARKER) && txt.includes(END_MARKER);
            }
          } catch (_) {}

          const sss = getStyleSheetService();
          const liveActive = currentURI
            ? sss.sheetRegistered(currentURI, sss.AGENT_SHEET)
            : false;

          const prefEnabled = Services.prefs.getBoolPref(
            "toolkit.legacyUserProfileCustomizations.stylesheets",
            false
          );

          return {
            userChromePath,
            hasBlockInFile,
            liveActive,
            prefEnabled
          };
        },
        async setTabGroupPinned(tabId, isPinned) {
          const nativeTab = findNativeTab(context, tabId);
          if (nativeTab) {
            if (isPinned) {
              nativeTab.setAttribute("group-pinned", "true");
            } else {
              nativeTab.removeAttribute("group-pinned");
            }
            const ss = getSessionStore();
            if (ss && ss.setCustomTabValue) {
              try {
                ss.setCustomTabValue(
                  nativeTab,
                  "group-pinned",
                  isPinned ? "true" : ""
                );
              } catch (_) {}
            }
            return true;
          }
          return false;
        },
        async isTabGroupPinned(tabId) {
          const nativeTab = findNativeTab(context, tabId);
          if (nativeTab) {
            return nativeTab.getAttribute("group-pinned") === "true";
          }
          return false;
        },
        async syncAllGroupPinnedTabs(pinnedTabIds) {
          const set = new Set(pinnedTabIds || []);
          for (const win of Services.wm.getEnumerator("navigator:browser")) {
            if (win.gBrowser) {
              for (const tab of win.gBrowser.tabs) {
                const wrapper = context.extension.tabManager.getWrapper(tab);
                const id = wrapper ? wrapper.id : null;
                if (id && set.has(id)) {
                  tab.setAttribute("group-pinned", "true");
                } else if (id) {
                  tab.removeAttribute("group-pinned");
                }
              }
            }
          }
          return true;
        },
        async setPreviewEnhancementsEnabled(enabled) {
          previewEnhancementsEnabled = !!enabled;
          dbg("setPreviewEnhancementsEnabled(" + previewEnhancementsEnabled + ")");
          if (previewEnhancementsEnabled) {
            initWindowEnhancements();
          } else {
            shutdownWindowEnhancements();
          }
          return true;
        }
      }
    };
  }
};
