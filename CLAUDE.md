# CLAUDE.md

Этот файл даёт указания Claude Code (claude.ai/code) при работе с кодом в этом репозитории.

## Текущее состояние

Авторитетный дизайн — [SPEC.md](SPEC.md), исходный запрос — [user-wish.md](user-wish.md). Опирайся на SPEC.md: там задан побайтовый формат шифрования, WebDAV-протокол, схема манифеста и этапы поставки (M0–M5).

Репозиторий — **npm-workspaces монорепо** (корневой [package.json](package.json), workspaces `crypto-core`, `encryptor`). Общий тулчейн (typescript, vitest, esbuild) поднят в корень; `encryptor` тянет `crypto-core` как workspace-пакет (`import … from "crypto-core"`) — тот же формат байт-в-байт, что пойдёт в плагин.

**Сделано:**
- **M0 · `crypto-core`** — готов. Пакет [crypto-core/](crypto-core/): `deriveKeys`, `deriveName`, `encryptBlob`/`decryptBlob`, `encryptManifest`/`decryptManifest`/`readManifestSalt`, `sha256Hex`, `base32NoPadEncode`. Только Web Crypto. 24 теста (round-trip, детерминизм, golden-вектора) + строгий typecheck зелёные. План: [docs/superpowers/plans/2026-07-01-m0-crypto-core.md](docs/superpowers/plans/2026-07-01-m0-crypto-core.md).
- **M1 · `encryptor`** — готов. Пакет [encryptor/](encryptor/): слоистый CLI на портах `SourceFs`/`WebDav` ([sync.ts](encryptor/src/sync.ts) — ядро `encryptSync`: diff по sha, upload/delete, пересборка `manifest.enc`), Node-адаптеры [walk.ts](encryptor/src/walk.ts)/[webdav.ts](encryptor/src/webdav.ts) (встроенный `fetch`, Basic auth), state с base64-salt ([state.ts](encryptor/src/state.ts)), config file+env ([config.ts](encryptor/src/config.ts)), `--full`/`--config`/`--help` ([cli.ts](encryptor/src/cli.ts)). esbuild → единый `encryptor.mjs` (10 КБ, crypto-core инлайнится, ноль внешних зависимостей). 20 тестов + typecheck зелёные; sync-тест расшифровывает манифест через crypto-core (кросс-проверка формата). Проверен e2e против настоящего WebDAV ([docker-compose.yml](docker-compose.yml)). План: [docs/superpowers/plans/2026-07-02-m1-encryptor-cli.md](docs/superpowers/plans/2026-07-02-m1-encryptor-cli.md).
- **M2 · `plugin`** (ядро синка) — готов. Пакет [plugin/](plugin/): ядро на портах `WebDavClient`/`VaultWriter`/`StateStore` ([engine.ts](plugin/src/engine.ts) — `SyncEngine.run`: скачать+расшифровать манифест → diff → per-file GET+decrypt+write, guard `isSyncing`, пофайловый try/catch, неверный passphrase → throw до записи), [diff.ts](plugin/src/diff.ts)/[paths.ts](plugin/src/paths.ts), Obsidian-адаптеры [webdav.ts](plugin/src/webdav.ts) (`requestUrl` инжектится, `btoa` для Basic), [vault-writer.ts](plugin/src/vault-writer.ts) (рекурсивный mkdir), [state-store.ts](plugin/src/state-store.ts), минимальный [settings.ts](plugin/src/settings.ts) + [main.ts](plugin/src/main.ts) (команда `Sync now`). `manifest.json` c `isDesktopOnly:false`. 22 теста (engine — на фейках портов + реальных зашифрованных фикстурах crypto-core) + typecheck зелёные; esbuild → `main.js` (obsidian external, crypto-core инлайнится). План: [docs/superpowers/plans/2026-07-02-m2-plugin.md](docs/superpowers/plans/2026-07-02-m2-plugin.md).

**Дальше:** M3 (Scheduler + полный SettingsTab + StatusUI: интервалы, sync-on-open, статус-бар) → M4 (edge-cases + релиз BRAT: `versions.json`, ручной e2e на iOS).

## Что это

Односторонняя синхронизация: зашифрованный vault Obsidian лежит в WebDAV под непрозрачными именами; плагин для Obsidian iOS скачивает и расшифровывает его на устройстве. Синк строго `WebDAV → устройство` (на телефоне vault read-only, локальные правки перезаписываются). Шифрование делает отдельный CLI на VPS.

## Архитектура (планируемое монорепо)

Три пакета с единым форматом шифрования:

- `/crypto-core` — общий TS: `deriveKeys`, `encryptBlob`/`decryptBlob`, `deriveName`, кодек манифеста. **Этот же самый код исполняется и в CLI, и в плагине.**
- `/encryptor` — VPS CLI (Node ≥ 20). Инкрементально шифрует исходный vault, делает PUT/DELETE блобов и `manifest.enc` в WebDAV.
- `/plugin` — плагин Obsidian iOS. GET манифеста и блобов, расшифровка, запись в локальный vault. Слоистые модули (см. SPEC §6.1): `SyncEngine`, `WebDavClient`, `CryptoService`, `ManifestService`, `VaultWriter`, `StateStore`, `Scheduler`, `StatusUI` — развязаны (крипто-слой ничего не знает про WebDAV и наоборот).

### Ключевая идея: побайтово совместимый crypto-core

И Node ≥ 20, и iOS WebView предоставляют Web Crypto (`globalThis.crypto.subtle`), поэтому `crypto-core` использует **только Web Crypto — без WASM и без npm-крипто-библиотек**. Именно это позволяет CLI и плагину делить одну реализацию и оставаться совместимыми по формату. Не тащи в `crypto-core` API, специфичные для Node (`node:crypto`, Buffer) или только для браузера.

## Формат шифрования (должен оставаться стабильным — см. SPEC §2)

- AES-256-GCM (12-байтный IV, 16-байтный тег добавляется Web Crypto), PBKDF2-HMAC-SHA-256 с `iterations = 200_000` и глобальным 16-байтным salt, HKDF-SHA-256 для разделения на `contentKey` (info `"content/v1"`) и `nameKey` (info `"filename/v1"`).
- **Мастер-ключ выводится один раз за синк** и переиспользуется для всех файлов — критично для скорости на iOS. Никогда не гоняй PBKDF2 на каждый файл.
- Формат блоба: `[magic(4)="OSD1"][version(1)=0x01][iv(12)][ciphertext+tag]`. Манифест: `[magic(4)="OSDM"][version(1)][salt(16)][iv(12)][ciphertext+tag]` — salt читается как plaintext *до* деривации ключа.
- Удалённые имена: `base32_nopad(HMAC-SHA-256(nameKey, realPath))` — детерминированные, плоско в одной удалённой папке.
- `sha256` в манифесте считается от **plaintext**-содержимого (детектор изменений), вычисляется одинаково на VPS и устройстве.
- Любое изменение формата требует bump версии и обновления golden-векторов.

## Жёсткие ограничения (легко ошибиться)

- **В `manifest.json` обязательно `"isDesktopOnly": false`** — иначе плагин не появится на iOS.
- **Весь HTTP плагина идёт через `requestUrl()` Obsidian**, а не через `fetch` — обычный `fetch` упирается в CORS на iOS. Ответы читать как `arrayBuffer`.
- **Никакого фонового синка на iOS** — ОС не позволяет. Синк работает только пока приложение на переднем плане: `sync-on-open` (`workspace.onLayoutReady`), `setInterval` пока активно, или ручной запуск. Честно отражай это в UX настроек.
- **Encryptor поставляется одним файлом, без зависимостей** — esbuild собирает CLI + crypto-core в единый `encryptor.mjs` (target Node, ESM). На VPS не нужны ни `npm install`, ни `node_modules`. WebDAV-клиент на встроенном `fetch` Node. Так и держи (поэтому CLI на Node, а не на Python).
- Плагин игнорирует `.obsidian/` (исключается на стороне VPS), чтобы конфиг плагина не затирался синком.
- Пофайловая обработка ошибок: битый/недокачанный файл ловится, считается и повторяется на следующем синке — его state **не** обновляется. Один плохой файл не должен валить весь синк. Неверный passphrase = несовпадение GCM-тега манифеста → прерывание до любой записи.

## Сборка и тесты

Из корня репо (workspaces): `npm test` и `npm run typecheck` гоняют **все** пакеты. По одному пакету — `npm test -w crypto-core`, `npm run typecheck -w encryptor`. Один файл/тест — `npm test -w encryptor -- sync` (подстрока), либо из папки пакета `npx vitest run test/sync.test.ts -t "skips unchanged"`. После `npm install` — только из корня.

### `crypto-core` (готов)
Тесты на Vitest, тайпчек на TypeScript. `npm test -w crypto-core`, `npm run typecheck -w crypto-core`, `npm run test:watch -w crypto-core`.

Тулчейн: **TypeScript 6.x** (последняя), `"lib": ["ES2022","DOM"]`, `"types": []` — типы Web Crypto (`CryptoKey`, `crypto.subtle`, `BufferSource`) берутся из DOM-lib (это те же WHATWG-API, что в Node ≥ 20 и iOS WebView); node-типы не подключаются, чтобы случайно не утащить `node:*`/`Buffer` в общий код.

**Тип `Bytes = Uint8Array<ArrayBuffer>`** ([bytes.ts](crypto-core/src/bytes.ts)) — все байты, идущие в `crypto.subtle`/`TextDecoder`, объявляются как `Bytes`, а не голый `Uint8Array`. В TS 5.7+ голый `Uint8Array` = `Uint8Array<ArrayBufferLike>` (включает `SharedArrayBuffer`) и **не** присваивается в `BufferSource`; `Bytes` фиксирует бэкинг `ArrayBuffer`. Не заводи в сигнатурах голый `Uint8Array` для крипто-данных — только `Bytes` (значения из `crypto.getRandomValues`, `new Uint8Array(len|arrayBuffer)`, `requestUrl().arrayBuffer` уже `ArrayBuffer`-backed; Node `Buffer` из `readFile` оберни в `new Uint8Array(buf)`).

**IDE и CLI должны совпадать по TS.** [.vscode/settings.json](.vscode/settings.json) указывает `typescript.tsdk` на воркспейс-версию — VS Code не должен использовать свою встроенную. Иначе `npm run typecheck` зелёный, а в IDE красные ошибки буферов (так и было). Проверяй typecheck именно локальным `tsc`.

**Golden-вектора** — [crypto-core/test/golden.test.ts](crypto-core/test/golden.test.ts): фикс. passphrase/salt/iv → фикс. ciphertext/имя. Любое изменение формата (§2 SPEC) ломает их намеренно — это защита формата, не «чини» константы, а осознанно бампай версию.

### `encryptor` (готов)
`npm test -w encryptor`, `npm run typecheck -w encryptor`. Сборка: **`npm run build -w encryptor`** → `encryptor/encryptor.mjs` (esbuild, target node20, ESM, crypto-core инлайнится, ноль внешних зависимостей; артефакт в `.gitignore`). Деплой на VPS: скопировать `encryptor.mjs` + `config.json`, запуск `node encryptor.mjs [--config <path>] [--full]`. Ядро `encryptSync` тестируется на in-memory фейках портов `SourceFs`/`WebDav`; Node-адаптеры (`NodeSourceFs`, `FetchWebDav`) — свои юнит-тесты + smoke-тест собранного бандла (`node encryptor.mjs --help`).

**Локальный e2e против настоящего WebDAV:** [docker-compose.yml](docker-compose.yml) поднимает `bytemark/webdav` на `http://localhost:8080` (testuser/testpass). `docker compose up -d` → собрать бандл → прогнать `node encryptor/encryptor.mjs --config <cfg>` на тестовом vault → скачать блобы/манифест по HTTP и расшифровать через crypto-core. Проверено сквозняком: initial (3 upload), инкремент (skip), правка+удаление (re-upload+DELETE, блоб отдаёт 404), `--full`, неверный passphrase (GCM-тег не сходится). `docker compose down -v` для очистки.

### `plugin` (M2 готов — ядро синка)
`npm test -w plugin`, `npm run typecheck -w plugin`. Сборка: **`npm run build -w plugin`** → `plugin/main.js` (esbuild, `platform: browser`, `format: cjs`, `obsidian`/electron/node-builtins в external, crypto-core инлайнится; артефакт в `.gitignore`). Для загрузки в Obsidian нужны рядом `main.js` + `manifest.json` + `styles.css`.

**Тестируемость через порты:** `SyncEngine` и хелперы (`computeDiff`, `joinVaultPath`) зависят только от портов (`WebDavClient`/`VaultWriter`/`StateStore`) и напрямую от crypto-core → юнит-тесты на фейках + **реальные зашифрованные фикстуры** (тест шифрует через crypto-core, движок расшифровывает — сквозная проверка формата). Obsidian-адаптеры тонкие: зависимость (`requestUrl`, `vault.adapter`) инжектится через **структурные** интерфейсы (`RequestFn`, `VaultAdapterLike`, type-only импорт из `obsidian`) — тестируются фейками, без рантайма Obsidian. Только `main.ts`/`settings.ts` трогают рантайм Obsidian и проверяются тайпчеком + сборкой, без юнит-тестов.

**Не забывай (легко сломать iOS):** `manifest.json` → `"isDesktopOnly": false`; весь HTTP через `requestUrl()` (не `fetch`); в коде плагина никакого `node:*`/`Buffer` (WebView) — base64 через `btoa`, байты через `Bytes` из crypto-core; `lib: ES2022+DOM`, `types: []`.

### `/plugin` UX (M3, ещё нет)
Scheduler (`setInterval` + `sync-on-open` через `onLayoutReady`), полный SettingsTab (валидация, Test connection), StatusUI (status bar + ribbon spinner), опц. `If-None-Match` по ETag манифеста. Пропиши команды при появлении.

## Установка / релиз

Не публикуется в Community Plugins — ставится через **BRAT** как beta-плагин. GitHub-релизы должны содержать `main.js`, `manifest.json`, `styles.css` и `versions.json`.
