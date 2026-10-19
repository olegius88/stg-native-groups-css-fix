"use strict";

const ids = [
  "enabled",
  "pinInGroupEnabled",
  "pinInGroupCompact",
  "hideEmptyGroupHeaders",
  "hideOverflowCounter",
  "hideGroupLine",
  "compactLabels",
  "customCSS"
];

let customCssTimer = null;

function showSavedIndicator(msg = "Записано") {
  const el = document.getElementById("save-indicator");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 1400);
}

function renderPinnedTabs(pinnedTabs = []) {
  const badge = document.getElementById("pinned-count-badge");
  const list = document.getElementById("pinned-tabs-list");
  if (!badge || !list) return;

  badge.textContent = pinnedTabs.length;

  if (pinnedTabs.length === 0) {
    list.innerHTML = `<div class="empty-pinned">Пока нет закрепленных вкладок.<br>Нажмите ПКМ по вкладке в группе &rarr; «📌 Закрепить в этой группе»</div>`;
    return;
  }

  list.innerHTML = "";
  for (const t of pinnedTabs) {
    const row = document.createElement("div");
    row.className = "pinned-tab-row";

    const fav = document.createElement("img");
    fav.className = "pinned-tab-fav";
    fav.src = t.favIconUrl || "../icons/icon.svg";
    fav.alt = "";

    const info = document.createElement("div");
    info.className = "pinned-tab-info";

    const title = document.createElement("div");
    title.className = "pinned-tab-title";
    title.textContent = t.title || t.url || "Без названия";
    title.title = t.title || t.url;

    const grp = document.createElement("div");
    grp.className = "pinned-tab-group";
    grp.textContent = t.groupTitle ? `Группа: ${t.groupTitle}` : `Вкладка #${t.id}`;

    info.appendChild(title);
    info.appendChild(grp);

    const unpinBtn = document.createElement("button");
    unpinBtn.className = "pinned-tab-unpin-btn";
    unpinBtn.type = "button";
    unpinBtn.textContent = "✖";
    unpinBtn.title = "Открепить вкладку из группы";
    unpinBtn.addEventListener("click", async () => {
      await browser.runtime.sendMessage({ action: "unpinTab", tabId: t.id });
      await refreshStatus();
    });

    row.appendChild(fav);
    row.appendChild(info);
    row.appendChild(unpinBtn);
    list.appendChild(row);
  }
}

async function refreshStatus() {
  const res = await browser.runtime.sendMessage({ action: "getStatus" });
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  const preview = document.getElementById("generated-css-preview");
  const pathBox = document.getElementById("file-path-box");
  const mainContent = document.getElementById("main-content");

  mainContent.classList.toggle("disabled", !res.settings.enabled);
  preview.textContent =
    res.generatedCSS || "/* Блок удален из userChrome.css */";

  if (res.status && res.status.userChromePath) {
    pathBox.textContent = res.status.userChromePath;
  } else {
    pathBox.textContent =
      "Для записи в userChrome.css требуется extensions.experiments.enabled = true в about:config";
  }

  dot.className = "status-dot";
  if (!res.hasManager) {
    dot.classList.add("warn");
    text.textContent =
      "Включите extensions.experiments.enabled = true в about:config";
  } else if (!res.settings.enabled) {
    text.textContent =
      "Отключено: блок удален из userChrome.css и выгружен из памяти";
  } else if (res.status && res.status.hasBlockInFile && res.status.liveActive) {
    dot.classList.add("active");
    text.textContent =
      "Активно: прописано в userChrome.css + применено в памяти (0 мс)";
  } else if (res.status && res.status.hasBlockInFile) {
    dot.classList.add("active");
    text.textContent = "Прописано в chrome/userChrome.css";
  } else {
    dot.classList.add("warn");
    text.textContent = "Не выбрано ни одного CSS-правила";
  }

  renderPinnedTabs(res.pinnedTabs || []);
}

async function saveCurrentForm() {
  const patch = {
    enabled: document.getElementById("enabled").checked,
    pinInGroupEnabled: document.getElementById("pinInGroupEnabled").checked,
    pinInGroupCompact: document.getElementById("pinInGroupCompact").checked,
    hideEmptyGroupHeaders: document.getElementById("hideEmptyGroupHeaders").checked,
    hideOverflowCounter: document.getElementById("hideOverflowCounter").checked,
    hideGroupLine: document.getElementById("hideGroupLine").checked,
    compactLabels: document.getElementById("compactLabels").checked,
    customCSS: document.getElementById("customCSS").value
  };
  await browser.storage.local.set(patch);
  showSavedIndicator("Записано в userChrome");
  setTimeout(refreshStatus, 80);
}

async function initPopup() {
  const res = await browser.runtime.sendMessage({ action: "getStatus" });
  const s = res.settings;

  document.getElementById("enabled").checked = !!s.enabled;
  document.getElementById("pinInGroupEnabled").checked = !!s.pinInGroupEnabled;
  document.getElementById("pinInGroupCompact").checked = !!s.pinInGroupCompact;
  document.getElementById("hideEmptyGroupHeaders").checked = !!s.hideEmptyGroupHeaders;
  document.getElementById("hideOverflowCounter").checked = !!s.hideOverflowCounter;
  document.getElementById("hideGroupLine").checked = !!s.hideGroupLine;
  document.getElementById("compactLabels").checked = !!s.compactLabels;
  document.getElementById("customCSS").value = s.customCSS || "";

  await refreshStatus();

  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (id === "customCSS") {
      el.addEventListener("input", () => {
        clearTimeout(customCssTimer);
        customCssTimer = setTimeout(saveCurrentForm, 350);
      });
    } else {
      el.addEventListener("change", saveCurrentForm);
    }
  }

  document.getElementById("rollback-btn").addEventListener("click", async () => {
    await browser.runtime.sendMessage({ action: "rollbackNow" });
    document.getElementById("enabled").checked = false;
    await refreshStatus();
    showSavedIndicator("Откат выполнен");
  });

  document.getElementById("reset-btn").addEventListener("click", async () => {
    await browser.runtime.sendMessage({ action: "resetDefaults" });
    await initPopup();
    showSavedIndicator("Сброшено");
  });
}

document.addEventListener("DOMContentLoaded", initPopup);
