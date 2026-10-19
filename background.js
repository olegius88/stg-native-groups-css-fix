"use strict";

const DEFAULT_SETTINGS = {
  enabled: true,
  hideEmptyGroupHeaders: true,
  pinInGroupEnabled: true,
  pinInGroupCompact: true,
  hideOverflowCounter: false,
  hideGroupLine: false,
  compactLabels: false,
  customCSS: ""
};

const SESSION_PIN_KEY = "group_pinned_v1";
const pinnedTabIdsSet = new Set();
let currentSettings = { ...DEFAULT_SETTINGS };

function buildCSS(settings) {
  if (!settings.enabled) {
    return "";
  }

  const rules = [];

  if (settings.hideEmptyGroupHeaders) {
    rules.push(`/* Полностью скрывать нативную группу Firefox (плашку, счетчик, линию), когда все вкладки группы скрыты через Simple Tab Groups */
#tabbrowser-tabs tab-group:not(:has(tab.tabbrowser-tab:not([hidden]))) {
    display: none !important;
}`);
  }

  if (settings.pinInGroupEnabled) {
    if (settings.pinInGroupCompact) {
      rules.push(`/* Закрепленные вручную вкладки внутри свернутых групп (компактный вид: фавиконка) */
#tabbrowser-tabs tab-group[collapsed] > tab.tabbrowser-tab[group-pinned="true"]:not([hidden]) {
    display: flex !important;
    visibility: visible !important;
}
#tabbrowser-tabs tab-group[collapsed] > tab.tabbrowser-tab[group-pinned="true"]:not([hidden]):not([selected]) {
    max-width: 44px !important;
    min-width: 40px !important;
    padding-inline: 4px !important;
}
#tabbrowser-tabs tab-group[collapsed] > tab.tabbrowser-tab[group-pinned="true"]:not([hidden]):not([selected]) .tab-label-container {
    display: none !important;
}
#tabbrowser-tabs tab.tabbrowser-tab[group-pinned="true"]:not([hidden]) .tab-icon-image {
    outline: 2px solid #10b981 !important;
    outline-offset: 1px !important;
    border-radius: 4px !important;
}`);
    } else {
      rules.push(`/* Закрепленные вручную вкладки внутри свернутых групп (полный размер) */
#tabbrowser-tabs tab-group[collapsed] > tab.tabbrowser-tab[group-pinned="true"]:not([hidden]) {
    display: flex !important;
    visibility: visible !important;
}
#tabbrowser-tabs tab.tabbrowser-tab[group-pinned="true"]:not([hidden]) .tab-icon-image {
    outline: 2px solid #10b981 !important;
    outline-offset: 1px !important;
    border-radius: 4px !important;
}`);
    }
  }

  if (settings.hideOverflowCounter) {
    rules.push(`/* Скрывать счетчик свернутых вкладок (+N) */
#tabbrowser-tabs tab-group > .tab-group-overflow-count-container {
    display: none !important;
}`);
  }

  if (settings.hideGroupLine) {
    rules.push(`/* Скрывать цветную нижнюю линию нативной группы */
#tabbrowser-tabs tab-group .tab-group-line,
#tabbrowser-tabs tab-group > .tab-group-label-container::after,
#tabbrowser-tabs tab-group > .tab-group-overflow-count-container::after {
    display: none !important;
}`);
  }

  if (settings.compactLabels) {
    rules.push(`/* Компактные отступы у плашек нативных групп */
#tabbrowser-tabs tab-group .tab-group-label {
    padding-inline: 5px !important;
    min-width: 18px !important;
}`);
  }

  if (settings.customCSS && settings.customCSS.trim()) {
    rules.push(`/* Пользовательский CSS */
${settings.customCSS.trim()}`);
  }

  return rules.join("\n\n").trim();
}

async function updateBadge() {
  if (!currentSettings.enabled) {
    await browser.browserAction.setBadgeText({ text: "OFF" });
    await browser.browserAction.setBadgeBackgroundColor({ color: "#64748b" });
  } else if (pinnedTabIdsSet.size > 0) {
    await browser.browserAction.setBadgeText({ text: `📌${pinnedTabIdsSet.size}` });
    await browser.browserAction.setBadgeBackgroundColor({ color: "#10b981" });
  } else {
    await browser.browserAction.setBadgeText({ text: "" });
  }
}

async function isTabPinnedInGroup(tabId) {
  if (pinnedTabIdsSet.has(tabId)) {
    return true;
  }
  if (browser.userChromeManager && browser.userChromeManager.isTabGroupPinned) {
    try {
      const live = await browser.userChromeManager.isTabGroupPinned(tabId);
      if (live) {
        pinnedTabIdsSet.add(tabId);
        return true;
      }
    } catch (_) {}
  }
  try {
    const val = await browser.sessions.getTabValue(tabId, SESSION_PIN_KEY);
    if (val === "true") {
      pinnedTabIdsSet.add(tabId);
      return true;
    }
  } catch (_) {}
  return false;
}

async function setTabPinnedInGroup(tabId, isPinned) {
  if (isPinned) {
    pinnedTabIdsSet.add(tabId);
  } else {
    pinnedTabIdsSet.delete(tabId);
  }

  if (browser.userChromeManager && browser.userChromeManager.setTabGroupPinned) {
    try {
      await browser.userChromeManager.setTabGroupPinned(tabId, isPinned);
    } catch (e) {
      console.warn("[STG userChrome Fix] setTabGroupPinned error:", e);
    }
  }

  try {
    await browser.sessions.setTabValue(
      tabId,
      SESSION_PIN_KEY,
      isPinned ? "true" : ""
    );
  } catch (_) {}

  await updateBadge();
}

async function syncAllPinnedTabs() {
  if (browser.userChromeManager && browser.userChromeManager.syncAllGroupPinnedTabs) {
    try {
      await browser.userChromeManager.syncAllGroupPinnedTabs(
        Array.from(pinnedTabIdsSet)
      );
    } catch (_) {}
  }
}

async function applySettings(settings) {
  currentSettings = { ...DEFAULT_SETTINGS, ...settings };
  await updateBadge();

  const css = buildCSS(currentSettings);
  let status = null;

  if (browser.userChromeManager) {
    try {
      if (css) {
        await browser.userChromeManager.applyCSS(css);
      } else {
        await browser.userChromeManager.removeCSS();
      }
      status = await browser.userChromeManager.getStatus();
      await syncAllPinnedTabs();
    } catch (e) {
      console.error("[STG userChrome Fix] error applying CSS:", e);
    }
  }

  return {
    settings: currentSettings,
    generatedCSS: css,
    status
  };
}

// === Context Menu: Right-Click on Tab to Pin in Group ===

try {
  browser.menus.removeAll().then(() => {
    browser.menus.create({
      id: "toggle-group-pin",
      title: "📌 Закрепить в этой группе",
      contexts: ["tab"]
    });
  });

  browser.menus.onShown.addListener(async (info, tab) => {
    try {
      if (!tab) return;
      const isPinned = await isTabPinnedInGroup(tab.id);
      const TAB_GROUP_ID_NONE = browser.tabGroups ? (browser.tabGroups.TAB_GROUP_ID_NONE ?? -1) : -1;
      const inGroup = tab.groupId !== undefined && tab.groupId !== null && tab.groupId !== TAB_GROUP_ID_NONE;

      if (inGroup) {
        await browser.menus.update("toggle-group-pin", {
          title: isPinned ? "❌ Открепить из этой группы" : "📌 Закрепить в этой группе",
          enabled: true,
          visible: true
        });
      } else {
        await browser.menus.update("toggle-group-pin", {
          title: "📌 Закрепить в группе (вкладка не в группе)",
          enabled: false,
          visible: true
        });
      }
      browser.menus.refresh();
    } catch (err) {
      console.warn("[STG userChrome Fix] onShown error:", err);
    }
  });

  browser.menus.onClicked.addListener(async (info, tab) => {
    try {
      if (info.menuItemId === "toggle-group-pin" && tab) {
        const isPinned = await isTabPinnedInGroup(tab.id);
        await setTabPinnedInGroup(tab.id, !isPinned);
      }
    } catch (err) {
      console.warn("[STG userChrome Fix] onClicked error:", err);
    }
  });
} catch (e) {
  console.warn("[STG userChrome Fix] context menu init warning:", e);
}

// === Tab Lifecycle Listeners ===

browser.tabs.onCreated.addListener(async tab => {
  if (!tab || !tab.id) return;
  setTimeout(async () => {
    try {
      const val = await browser.sessions.getTabValue(tab.id, SESSION_PIN_KEY);
      if (val === "true") {
        await setTabPinnedInGroup(tab.id, true);
      }
    } catch (_) {}
  }, 300);
});

browser.tabs.onUpdated.addListener(
  async (tabId, changeInfo, tab) => {
    if (pinnedTabIdsSet.has(tabId)) {
      if (browser.userChromeManager && browser.userChromeManager.setTabGroupPinned) {
        await browser.userChromeManager.setTabGroupPinned(tabId, true);
      }
    }
  },
  { properties: ["groupId", "status"] }
);

browser.tabs.onRemoved.addListener(tabId => {
  if (pinnedTabIdsSet.has(tabId)) {
    pinnedTabIdsSet.delete(tabId);
    updateBadge();
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    browser.storage.local.get(DEFAULT_SETTINGS).then(applySettings);
  }
});

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.action === "getStatus") {
    return (async () => {
      const hasManager = !!browser.userChromeManager;
      const status = hasManager
        ? await browser.userChromeManager.getStatus()
        : null;

      // Get list of pinned tabs details for popup UI
      const pinnedTabs = [];
      for (const tid of pinnedTabIdsSet) {
        try {
          const t = await browser.tabs.get(tid);
          let groupTitle = "";
          if (browser.tabGroups && t.groupId !== undefined && t.groupId !== -1) {
            try {
              const grp = await browser.tabGroups.get(t.groupId);
              groupTitle = grp ? grp.title : "";
            } catch (_) {}
          }
          pinnedTabs.push({
            id: t.id,
            title: t.title || t.url,
            url: t.url,
            favIconUrl: t.favIconUrl,
            groupTitle
          });
        } catch (_) {
          pinnedTabIdsSet.delete(tid);
        }
      }

      return {
        hasManager,
        status,
        settings: currentSettings,
        generatedCSS: buildCSS(currentSettings),
        pinnedTabs
      };
    })();
  }
  if (msg && msg.action === "unpinTab") {
    return (async () => {
      if (msg.tabId) {
        await setTabPinnedInGroup(msg.tabId, false);
      }
      return { ok: true };
    })();
  }
  if (msg && msg.action === "rollbackNow") {
    return (async () => {
      const next = { ...currentSettings, enabled: false };
      await browser.storage.local.set(next);
      return await applySettings(next);
    })();
  }
  if (msg && msg.action === "resetDefaults") {
    return (async () => {
      await browser.storage.local.set(DEFAULT_SETTINGS);
      return await applySettings(DEFAULT_SETTINGS);
    })();
  }
});

(async function init() {
  const stored = await browser.storage.local.get(null);
  const merged = { ...DEFAULT_SETTINGS, ...stored };

  // Restore any tabs with session value SESSION_PIN_KEY
  try {
    const allTabs = await browser.tabs.query({});
    for (const t of allTabs) {
      try {
        const val = await browser.sessions.getTabValue(t.id, SESSION_PIN_KEY);
        if (val === "true") {
          pinnedTabIdsSet.add(t.id);
        }
      } catch (_) {}
    }
  } catch (_) {}

  await browser.storage.local.set(merged);
  await applySettings(merged);
})();
