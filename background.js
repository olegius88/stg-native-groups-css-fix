"use strict";

const DEFAULT_SETTINGS = {
  enabled: true,
  hideEmptyGroupHeaders: true,
  hideOverflowCounter: false,
  hideGroupLine: false,
  compactLabels: false,
  pinFirstTabInCollapsedGroup: true,
  pinFirstTabCompact: true,
  pinKeywords: "Чат",
  miniIconsMode: false,
  customCSS: ""
};

let currentSettings = { ...DEFAULT_SETTINGS };

function buildCSS(settings) {
  if (!settings.enabled) {
    return "";
  }

  const rules = [];

  if (settings.hideEmptyGroupHeaders) {
    rules.push(`/* Скрывать пустую плашку (синий квадрат) и счетчик нативной группы Firefox, когда все вкладки группы скрыты через Simple Tab Groups */
#tabbrowser-tabs tab-group:not(:has(tab.tabbrowser-tab:not([hidden]))) > :is(.tab-group-label-container, .tab-group-overflow-count-container) {
    display: none !important;
}`);
  }

  if (settings.pinFirstTabInCollapsedGroup) {
    if (settings.pinFirstTabCompact) {
      rules.push(`/* Закреплять первую вкладку свернутой группы как компактную иконку (pinned в группе) */
#tabbrowser-tabs tab-group[collapsed] > tab.tabbrowser-tab:first-of-type {
    display: flex !important;
    visibility: visible !important;
    max-width: 44px !important;
    min-width: 40px !important;
    padding-inline: 4px !important;
}
#tabbrowser-tabs tab-group[collapsed] > tab.tabbrowser-tab:first-of-type:not([selected]) .tab-label-container {
    display: none !important;
}`);
    } else {
      rules.push(`/* Закреплять первую вкладку свернутой группы (всегда видима, даже когда неактивна) */
#tabbrowser-tabs tab-group[collapsed] > tab.tabbrowser-tab:first-of-type {
    display: flex !important;
    visibility: visible !important;
}`);
    }
  }

  if (settings.pinKeywords && settings.pinKeywords.trim()) {
    const words = settings.pinKeywords
      .split(/[,;]+/)
      .map(w => w.trim())
      .filter(Boolean);
    if (words.length > 0) {
      const selectors = words
        .map(w => `#tabbrowser-tabs tab-group[collapsed] > tab.tabbrowser-tab:is([label*="${w}" i], [title*="${w}" i])`)
        .join(",\n");
      rules.push(`/* Не скрывать вкладки с ключевыми словами (${words.join(", ")}) внутри свернутых групп */
${selectors} {
    display: flex !important;
    visibility: visible !important;
}`);
    }
  }

  if (settings.miniIconsMode) {
    rules.push(`/* Показывать все вкладки свернутой группы как мини-значки (вместо полного скрытия) */
#tabbrowser-tabs tab-group[collapsed] > tab.tabbrowser-tab {
    display: flex !important;
    visibility: visible !important;
    max-width: 44px !important;
    min-width: 38px !important;
    padding-inline: 3px !important;
}
#tabbrowser-tabs tab-group[collapsed] > tab.tabbrowser-tab:not([selected]) .tab-label-container {
    display: none !important;
}`);
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
  } else {
    await browser.browserAction.setBadgeText({ text: "" });
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
      return {
        hasManager,
        status,
        settings: currentSettings,
        generatedCSS: buildCSS(currentSettings)
      };
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
  await browser.storage.local.set(merged);
  await applySettings(merged);
})();
