# STG Native Tab Groups CSS Fix (userChrome)

Расширение для **Firefox Developer Edition / Nightly / ESR**, которое устраняет визуальный баг нативных групп вкладок Firefox при использовании **Simple Tab Groups (STG)** — пустой цветной прямоугольник (`.tab-group-label-container`), остающийся на панели вкладок после переключения в другую группу STG.

В отличие от JS-решений, которые вынуждены разгруппировывать и заново группировать вкладки через WebExtensions API, это расширение решает проблему **на уровне нативного CSS-движка Gecko (`userChrome.css` + `nsIStyleSheetService`)**:
- **0 мс задержки** при переключении групп даже при 500+ открытых вкладках;
- Нативные группы `<tab-group>` не разрушаются и не пересоздаются;
- **📌 Опция закрепления вкладок внутри групп**: возможность оставлять первую или помеченную ключевым словом вкладку (например, `Чат`) видимой даже тогда, когда группа свёрнута, а вы переключились на другую вкладку;
- **Компактный режим закрепления**: сжатие закреплённой вкладки до размера иконки (`max-width: 44px`, только фавиконка, как у pinned tab);
- **Автоматическая запись в `<профиль>/chrome/userChrome.css`** без затирания других ваших стилей;
- **Мгновенное применение на лету** при изменении настроек в окне расширения (без перезапуска браузера);
- **Полный авто-откат** при отключении или удалении расширения.

---

## 🚀 Быстрая установка в 1 команду (Windows PowerShell)

Чтобы установить расширение сразу во все профили Firefox на любом компьютере, откройте **PowerShell** и выполните:

```powershell
irm https://raw.githubusercontent.com/olegius88/stg-native-groups-css-fix/main/install.ps1 | iex
```

Что делает эта команда:
1. Скачивает свежий пакет `stg-native-groups-css.xpi` из этого репозитория;
2. Прописывает в `user.js` профилей необходимые флаги для работы привилегированного API и таблиц стилей (`toolkit.legacyUserProfileCustomizations.stylesheets = true`, `extensions.experiments.enabled = true`, `xpinstall.signatures.required = false`);
3. Устанавливает расширение `stg-native-groups-css@olegius.org.xpi` в папку `extensions` каждого профиля Firefox.

После выполнения команды просто **перезапустите Firefox**.

---

## 🗑 Полное удаление / откат

1. **Через интерфейс Firefox**: просто отключите или удалите расширение в `about:addons` — перехватчик `onShutdown` автоматически вырежет блок стилей из `chrome/userChrome.css` и выгрузит CSS из оперативной памяти.
2. **Или одной командой в PowerShell**:
   ```powershell
   irm https://raw.githubusercontent.com/olegius88/stg-native-groups-css-fix/main/uninstall.ps1 | iex
   ```

---

## ⚙️ Как это работает под капотом

### 1. CSS-селектор на базе `:has()` без нагрузки на CPU
Когда **Simple Tab Groups** переключает активную группу, он скрывает вкладки предыдущей группы, выставляя им DOM-атрибут `hidden="true"`. Однако родительский элемент `<tab-group>` и его цветной ярлык `.tab-group-label-container` в Firefox по умолчанию не проверяют, остались ли внутри видимые вкладки.

Расширение добавляет следующее правило:
```css
/* === BEGIN STG-NATIVE-GROUPS-CSS-FIX === */
#tabbrowser-tabs tab-group:not(:has(tab.tabbrowser-tab:not([hidden]))) > :is(.tab-group-label-container, .tab-group-overflow-count-container) {
    display: none !important;
}
/* === END STG-NATIVE-GROUPS-CSS-FIX === */
```
Как только внутри `<tab-group>` не остаётся ни одной видимой вкладки (`tab.tabbrowser-tab:not([hidden])`), движок стилей Firefox (Stylo) мгновенно скрывает заголовок и счётчик группы без участия JavaScript.

### 2. Привилегированный мост (`experiment_apis.userChromeManager`)
В [`experiments/api.js`](experiments/api.js) реализован системный модуль:
- Через `Services.prefs.setBoolPref("toolkit.legacyUserProfileCustomizations.stylesheets", true)` включает чтение `userChrome.css`.
- Через `Services.dirsvc.get("ProfD", Ci.nsIFile).path` и `IOUtils` находит папку активного профиля и записывает блок между маркерами `BEGIN` и `END` в `chrome/userChrome.css`, сохраняя любые другие пользовательские правила в файле.
- Через `nsIStyleSheetService.loadAndRegisterSheet(uri, sss.AGENT_SHEET)` регистрирует таблицу стилей прямо в оперативной памяти браузера, поэтому переключение режимов в попапе расширения применяется мгновенно без перезапуска Firefox.
- В хуке `onShutdown(isAppShutdown)` проверяет причину остановки: если расширение было отключено или удалено пользователем (`!isAppShutdown`), автоматически очищает `chrome/userChrome.css` от своего блока.

---

## 📦 Структура репозитория

- [`manifest.json`](manifest.json) — манифест расширения (ID `stg-native-groups-css@olegius.org`, настроен `update_url` на этот репозиторий)
- [`experiments/schema.json`](experiments/schema.json) и [`experiments/api.js`](experiments/api.js) — привилегированный API для работы с `chrome/userChrome.css` и `nsIStyleSheetService`
- [`background.js`](background.js) — генератор CSS по выбранным настройкам
- [`popup/`](popup/) — интерфейс настроек и просмотра текущего пути к `userChrome.css`
- [`stg-native-groups-css.xpi`](stg-native-groups-css.xpi) — собранный пакет расширения
- [`install.ps1`](install.ps1) / [`install-on-machine.bat`](install-on-machine.bat) — автоматический установщик
- [`uninstall.ps1`](uninstall.ps1) — скрипт удаления и отката
- [`updates.json`](updates.json) — манифест автообновлений Firefox
