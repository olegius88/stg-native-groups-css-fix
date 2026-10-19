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
    if (tabObj && tabObj.nativeTab) {
      return tabObj.nativeTab;
    }
  } catch (_) {}
  return null;
}

this.userChromeManager = class extends ExtensionAPI {
  onShutdown(isAppShutdown) {
    unregisterLiveSheet();
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
        }
      }
    };
  }
};
