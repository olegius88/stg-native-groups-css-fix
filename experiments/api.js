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
const enhancedWindows = new WeakSet();
const windowCleanupHandlers = new Map();

function enhanceWindow(win) {
  if (!win || !win.document || enhancedWindows.has(win)) return;
  enhancedWindows.add(win);

  const panel = win.document.getElementById("tabgroup-preview-panel");
  const panelContent = win.document.getElementById("tabgroup-panel-content");
  if (!panel || !panelContent) return;

  function enhanceButtons() {
    if (!previewEnhancementsEnabled) return;
    try {
      const buttons = panelContent.querySelectorAll(".group-preview-button");
      for (const btn of buttons) {
        if (btn.__stgEnhanced) continue;
        btn.__stgEnhanced = true;

        // 1. Right-click context menu (native tabContextMenu)
        btn.setAttribute("context", "tabContextMenu");
        btn.addEventListener(
          "contextmenu",
          (event) => {
            if (!previewEnhancementsEnabled) return;
            event.preventDefault();
            event.stopPropagation();
            const tab = btn.tab;
            if (!tab) return;
            const menu = win.document.getElementById("tabContextMenu");
            if (menu) {
              try {
                if (panel && panel.hidePopup) {
                  panel.hidePopup();
                }
              } catch (_) {}
              menu.triggerNode = tab;
              menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
            }
          },
          true
        );

        // 2. Middle-click to close
        btn.addEventListener(
          "auxclick",
          (event) => {
            if (!previewEnhancementsEnabled) return;
            if (event.button === 1) {
              event.preventDefault();
              event.stopPropagation();
              if (btn.tab && win.gBrowser) {
                win.gBrowser.removeTab(btn.tab, { animate: true });
              }
            }
          },
          true
        );

        // 3. Close button [×] on the right
        let closeBtn = btn.querySelector(".group-preview-tab-close");
        if (!closeBtn) {
          closeBtn = win.document.createXULElement
            ? win.document.createXULElement("image")
            : win.document.createElementNS(
                "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
                "image"
              );

          closeBtn.className =
            "tab-close-button group-preview-tab-close close-icon";
          closeBtn.setAttribute("role", "button");
          closeBtn.setAttribute("tooltiptext", "Закрыть вкладку");
          closeBtn.setAttribute("aria-label", "Закрыть вкладку");

          const handleClose = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (btn.tab && win.gBrowser) {
              win.gBrowser.removeTab(btn.tab, { animate: true });
            }
          };

          closeBtn.addEventListener("click", handleClose, true);
          closeBtn.addEventListener("mousedown", (e) => e.stopPropagation(), true);
          closeBtn.addEventListener("command", handleClose, true);

          btn.appendChild(closeBtn);
        }
      }
    } catch (e) {
      console.warn("[STG userChrome Fix] enhanceButtons error:", e);
    }
  }

  let observer = null;
  try {
    observer = new win.MutationObserver(() => {
      enhanceButtons();
    });
    observer.observe(panelContent, { childList: true });
  } catch (_) {}

  const onUpdated = () => enhanceButtons();
  const onShowing = () => enhanceButtons();
  panel.addEventListener("TabGroupPreviewUpdated", onUpdated);
  panel.addEventListener("popupshowing", onShowing);

  enhanceButtons();

  windowCleanupHandlers.set(win, () => {
    try {
      if (observer) observer.disconnect();
      panel.removeEventListener("TabGroupPreviewUpdated", onUpdated);
      panel.removeEventListener("popupshowing", onShowing);
      const closeButtons = panelContent.querySelectorAll(
        ".group-preview-tab-close"
      );
      for (const cb of closeButtons) {
        cb.remove();
      }
      const buttons = panelContent.querySelectorAll(".group-preview-button");
      for (const btn of buttons) {
        delete btn.__stgEnhanced;
        btn.removeAttribute("context");
      }
    } catch (_) {}
  });
}

const winListener = {
  onOpenWindow(xulWin) {
    try {
      const win = xulWin.docShell.domWindow;
      win.addEventListener(
        "DOMContentLoaded",
        () => {
          if (win.document.readyState === "complete") {
            enhanceWindow(win);
          } else {
            win.addEventListener("load", () => enhanceWindow(win), {
              once: true
            });
          }
        },
        { once: true }
      );
    } catch (_) {}
  },
  onCloseWindow(xulWin) {
    try {
      const win = xulWin.docShell.domWindow;
      const cleanup = windowCleanupHandlers.get(win);
      if (cleanup) {
        cleanup();
        windowCleanupHandlers.delete(win);
      }
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
    console.warn("[STG userChrome Fix] initWindowEnhancements error:", e);
  }
}

function shutdownWindowEnhancements() {
  try {
    if (listenerAttached) {
      Services.wm.removeListener(winListener);
      listenerAttached = false;
    }
  } catch (_) {}
  for (const win of Services.wm.getEnumerator("navigator:browser")) {
    const cleanup = windowCleanupHandlers.get(win);
    if (cleanup) {
      cleanup();
    }
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
