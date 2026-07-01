# Спецификация: Obsidian WebDAV Decrypt Sync (iOS)

> Односторонняя синхронизация зашифрованного vault из WebDAV в мобильный Obsidian
> с расшифровкой на устройстве. Шифрование выполняется на VPS (Ubuntu).

## 1. Обзор

### 1.1 Цель
Иметь на iPhone (Obsidian iOS) актуальную **расшифрованную** копию заметок,
которые в облаке (WebDAV) лежат **зашифрованными** и под непрозрачными именами.
Синхронизация односторонняя: `WebDAV → устройство`. На телефоне vault трактуется
как read-only (правки не выгружаются и будут перезаписаны).

### 1.2 Две части системы
| Часть | Платформа | Роль |
|---|---|---|
| **Encryptor CLI** | VPS Ubuntu (Node.js ≥ 20) | Шифрует исходный vault, заливает в WebDAV, собирает манифест. Реализуется в этом репозитории, деплой — один файл без зависимостей (§5.1) |
| **Plugin** | Obsidian iOS (позже Android) | Скачивает, расшифровывает, пишет в локальный vault |
| **crypto-core** | Общий TS-модуль | Единый формат шифрования для обеих частей |

Ключевая идея: **crypto-core — один и тот же код** для CLI и плагина. Node ≥ 20 и
iOS WebView оба предоставляют Web Crypto (`globalThis.crypto.subtle`), поэтому
формат гарантированно совместим байт-в-байт.

### 1.3 Non-goals
- Обратная синхронизация (device → WebDAV).
- Разрешение конфликтов / merge. Локальные правки молча перезаписываются.
- Настоящая фоновая синхронизация на iOS (ОС не позволяет; см. §6.3).
- Публикация в Community Plugins (ставим через BRAT).
- Android (архитектура готова, но не в фокусе v1).

## 2. Формат шифрования (crypto-core)

### 2.1 Примитивы
- **Шифр**: AES-256-GCM (12-байтный IV, 16-байтный тег, тег добавляется Web Crypto автоматически).
- **Деривация ключа**: PBKDF2-HMAC-SHA-256, `iterations = 200_000`, глобальный `salt` (16 байт).
- **Разделение ключей**: HKDF-SHA-256 из rootKey:
  - `contentKey` = HKDF(rootKey, info="content/v1") → AES-GCM 256-bit
  - `nameKey` = HKDF(rootKey, info="filename/v1") → HMAC-SHA-256 key
- Всё нативно в Web Crypto, **без WASM**.

### 2.2 Деривация (один раз за синк)
```
rootBits = PBKDF2(passphrase, salt, 200_000, SHA-256) → 32 байта
contentKey = HKDF(rootBits, info="content/v1")
nameKey    = HKDF(rootBits, info="filename/v1")
```
`salt` глобальный, хранится в открытом виде в заголовке манифеста (соль не секретна).
Мастер-ключ выводится **однократно** и переиспользуется для всех файлов — это
критично для скорости на iOS (иначе PBKDF2 прогонялся бы на каждый файл).

### 2.3 Формат зашифрованного блоба (файл-заметка)
```
[ magic(4) = "OSD1" ][ version(1) = 0x01 ][ iv(12) ][ ciphertext + gcmTag ]
```
- IV генерируется случайно на каждый файл (уникальность IV под одним ключом обязательна).
- Расшифровка: `AES-GCM-decrypt(contentKey, iv, ct)`. Ошибка тега = битый файл/неверный пароль.

### 2.4 Формат манифеста `manifest.enc`
```
[ magic(4)="OSDM" ][ version(1) ][ salt(16) ][ iv(12) ][ ciphertext + gcmTag ]
```
- `salt` читается **до** деривации ключа (plaintext), затем расшифровывается тело.
- Тело (после расшифровки) — UTF-8 JSON (§4).

### 2.5 Непрозрачные имена файлов на сервере
```
remoteName = base32_nopad( HMAC-SHA-256(nameKey, realPath) )
```
- Детерминировано → VPS переиспользует имя при инкрементальных заливках,
  переименование файла на источнике = старое имя исчезает, новое появляется.
- base32 без паддинга (регистронезависимо, безопасно для WebDAV-путей), ~52 симв.
- Все блобы лежат **плоско** в одной удалённой папке + `manifest.enc` рядом.

## 3. WebDAV-протокол

### 3.1 Раскладка на сервере
```
<remoteBase>/
  manifest.enc
  <remoteName1>
  <remoteName2>
  ...
```

### 3.2 Операции плагина (только чтение)
- `GET <remoteBase>/manifest.enc` — всегда в начале синка.
- `GET <remoteBase>/<remoteName>` — по одному на изменённый файл.
- **PROPFIND не требуется**: список файлов берётся из манифеста, не с сервера.
- Аутентификация: HTTP Basic (`Authorization: Basic ...`) поверх HTTPS.
- **Все запросы через `requestUrl()` Obsidian** (обход CORS; обычный `fetch` на iOS
  упрётся в CORS). Ответ читаем как `arrayBuffer`.
- Опциональная оптимизация: условный `GET` манифеста с `If-None-Match` по сохранённому
  ETag → `304` = ничего не менялось, синк пропускаем.

### 3.3 Операции CLI (запись, §5)
`PUT` блобов и `manifest.enc`, `DELETE` устаревших блобов. На сервере CORS не мешает.
Реализуется на **встроенном `fetch` Node** (без npm-зависимостей), см. §5.1.1.

## 4. Структура манифеста (JSON внутри `manifest.enc`)
```jsonc
{
  "version": 1,
  "generatedAt": "2026-07-01T10:00:00Z",
  "files": [
    {
      "path": "Notes/idea.md",   // реальный путь в vault
      "name": "mzx4...q7",       // remoteName (base32 HMAC)
      "size": 1234,              // размер plaintext
      "sha256": "…",             // hash PLAINTEXT-содержимого (детектор изменений)
      "mtime": 1690000000        // mtime источника, для инфо
    }
  ]
}
```
`sha256` считается от **расшифрованного** содержимого — стабилен и одинаково
вычисляется на VPS и в плагине. Манифест — единственный источник правды о составе vault.

## 5. Encryptor CLI (VPS Ubuntu, Node ≥ 20)

### 5.1 Назначение и способ поставки
Инкрементально зашифровать исходный vault и синхронизировать его с WebDAV.

**Реализуется в этом же репозитории** (папка `/encryptor`). Требования к поставке:
- **Один файл, без внешних зависимостей.** Node ≥ 20 даёт всё из коробки: крипту —
  `crypto.subtle` (тот же `crypto-core`), сеть — встроенный `fetch` (WebDAV `PUT`/`DELETE`).
  `npm install` на VPS не нужен, `node_modules` нет.
- **Сборка**: esbuild бандлит CLI + `crypto-core` в единый `encryptor.mjs`
  (target Node, format ESM). Это и есть артефакт для копирования.
- **Деплой пользователем**: скопировать `encryptor.mjs` + `config.json` на VPS,
  прописать cron/systemd самому. Запуск: `node encryptor.mjs`.
- Язык: **Node.js** (а не Python) — ради нулевых зависимостей и общего формата с плагином.
  Python потребовал бы `cryptography` + `requests`, т.е. терял бы «один файл».

### 5.1.1 WebDAV-клиент в CLI
Пишется на встроенном `fetch` (не npm-пакет): `PUT` блобов и `manifest.enc`,
`DELETE` устаревших блобов, Basic auth. На сервере CORS не мешает.

### 5.2 Конфиг (`config.json` / env)
```
webdavUrl, webdavUser, webdavPass
passphrase           // тот же, что в плагине
sourceDir            // путь к исходному vault
statePath            // локальный файл состояния CLI
```

### 5.3 Состояние CLI (`state.json`)
```
{ "salt": "base64", "files": { "<path>": { "sha256", "name", "mtime" } } }
```
`salt` генерируется один раз при первом запуске и далее переиспользуется
(иначе поменяются все имена и придётся перезаливать весь vault).

### 5.4 Алгоритм `encrypt-sync`
1. Загрузить state (или инициализировать: сгенерировать salt).
2. Вывести `contentKey`, `nameKey` (crypto-core).
3. Обойти `sourceDir` (с учётом ignore-правил, напр. `.obsidian/`, `.trash/`).
4. Для каждого файла:
   - `sha256(plaintext)`; если совпал с state → пропуск.
   - иначе: `remoteName = HMAC(nameKey, path)`, зашифровать (§2.3), `PUT`.
   - обновить запись в state.
5. Файлы, которые есть в state, но исчезли из `sourceDir` → `DELETE <oldName>`,
   удалить из state.
6. Пересобрать манифест (§4), зашифровать (§2.4), `PUT manifest.enc`.
7. Сохранить state.
- Флаг `--full` — форс перешифровки всего (игнор state).

### 5.5 Запуск
Разово руками или по расписанию: `systemd timer` / cron. Инкрементальность делает
частые прогоны дешёвыми.

## 6. Плагин (Obsidian iOS)

### 6.1 Модули
```
main.ts          жизненный цикл, команды, ribbon, регистрация таймера
SettingsTab      UI настроек + валидация
WebDavClient     requestUrl: GET манифеста и блобов, Basic auth
CryptoService    обёртка над crypto-core (deriveKeys, decryptBlob, decryptManifest)
ManifestService  скачать + расшифровать + распарсить манифест
SyncEngine       оркестрация синка (diff, download, decrypt, write, delete)
VaultWriter      vault.adapter: writeBinary, mkdir(recursive), remove
StateStore       локальный стейт: path→sha256, lastSync, manifestEtag
Scheduler        setInterval по пресету + sync-on-open (onLayoutReady)
StatusUI         status bar + Notice + индикатор на ribbon
```
Слои развязаны: `CryptoService` не знает про WebDAV, `WebDavClient` — про шифрование.

### 6.2 Поток `SyncEngine.run()`
1. Guard: если уже идёт синк — выйти (флаг `isSyncing`).
2. `GET manifest.enc` (при наличии — с `If-None-Match`). `304` → обновить lastSync, выход.
3. Считать `salt` из заголовка → `deriveKeys(passphrase, salt)`.
4. Расшифровать манифест → список `files[]`.
5. Diff с `StateStore`:
   - `toDownload` = записи, где `manifest.sha256 != state[path].sha256` (или нет в state).
   - `toDelete` = пути в state/локальном vault, которых нет в манифесте.
6. Для каждого `toDownload` (батчами, с `await`-паузами, обновляя прогресс):
   - `GET <name>` → `decryptBlob(contentKey, blob)` → `VaultWriter.writeBinary(path)`.
   - только при успешной записи → `state[path] = {sha256}`.
   - ошибку по файлу ловим, считаем в `failed`, продолжаем.
7. `toDelete` → `VaultWriter.remove(path)` (если включена опция удаления).
8. Сохранить state (`lastSync`, `manifestEtag`).
9. `StatusUI`: `Notice("Synced N, failed M")`, обновить status bar.

### 6.3 Планировщик и iOS-ограничения
- iOS **не** даёт фоновой работы. Синк идёт только пока приложение активно.
- Триггеры: (а) `sync-on-open` через `workspace.onLayoutReady`; (б) `setInterval`
  по выбранному пресету пока app на переднем плане; (в) ручной запуск (ribbon/команда).
- Это явно отражается в UX-тексте настроек, чтобы не было ложных ожиданий.

### 6.4 Настройки (data.json)
```
webdavUrl, webdavUser, webdavPass
passphrase                      // хранится в открытом виде в data.json (принято)
remoteBase                      // подпуть на сервере (default "/")
targetFolder                    // куда класть в vault (default корень)
syncInterval                    // Off | 5 | 15 | 30 | 60 (мин)
syncOnOpen                      // bool
deleteMissing                   // bool, default true
lastSync, manifestEtag, fileState  // служебное
```
Кнопка «Test connection» и «Sync now» в настройках. Пароль/passphrase — поля password.

### 6.5 UI статуса
- **Status bar**: `Synced 5m ago` / `Syncing… 12/40` / `Sync failed` (постоянно виден).
- **Notice** (тост, аналог SnackBar): по завершении и на ошибках.
- **Ribbon icon**: ручной запуск + spinner во время синка.
- **Команды**: `Sync now`, `Reset local sync state` (форс полной перекачки).

## 7. Обработка ошибок и edge-cases
- **Нет сети / offline**: синк пропускается, статус `offline`, повтор на следующем интервале.
- **Неверный passphrase**: GCM-тег манифеста не сойдётся → явная ошибка
  «Decryption failed — check passphrase», синк прерывается до записи.
- **Битый/недокачанный файл**: per-file try/catch; state для файла **не** обновляется →
  повторная попытка на следующем синке. Один битый файл не валит весь синк.
- **Манифест отсутствует на сервере**: ошибка «Manifest not found».
- **Перекрывающиеся синки**: флаг `isSyncing`.
- **Локальные правки на телефоне**: перезаписываются при несовпадении hash (ожидаемо для one-way).
- **Создание папок**: `adapter.mkdir` рекурсивно перед записью; санитизация путей.
- **Атомарность записи**: при сбое посреди записи — на следующем синке hash не сойдётся,
  файл перекачается. (Опционально: запись во временный файл + rename.)
- **Большие вложения**: GCM — one-shot, файл целиком в память. Для v1 приемлемо;
  потоковое/чанковое шифрование — на будущее.
- **Игнор `.obsidian/`**: конфиг плагина не должен затираться синком (исключается на VPS).

## 8. Структура репозитория (монорепо)
```
/crypto-core     общий TS: deriveKeys, encryptBlob/decryptBlob, deriveName, manifest codec
/encryptor       VPS CLI (Node ≥ 20, crypto-core + встроенный fetch; без npm-зависимостей)
                 → esbuild bundle → encryptor.mjs (единственный файл для деплоя на VPS)
/plugin          Obsidian-плагин (esbuild, manifest.json, versions.json)
  manifest.json  { "isDesktopOnly": false, "minAppVersion": ... }  // false ОБЯЗАТЕЛЬНО для iOS
```
Сборка плагина: TypeScript + esbuild (стандартный шаблон Obsidian). Выход: `main.js`,
`manifest.json`, `styles.css`.

## 9. Установка через BRAT
- Репозиторий на GitHub с релизами, содержащими `main.js`, `manifest.json`, `styles.css`.
- `versions.json` для соответствия версий Obsidian.
- `manifest.json`: **`"isDesktopOnly": false`** — иначе плагин не появится на iOS.
- В BRAT добавляется как beta-плагин по URL репозитория.

## 10. Тестирование
- **crypto-core (unit)**: round-trip encrypt→decrypt; детерминизм `deriveName`;
  golden-вектора (фикс. salt/iv/passphrase → фикс. ciphertext) для защиты формата.
- **Кросс-тест**: зашифровать тестовый vault в Node → скормить тем же функциям на
  «стороне плагина» → сравнить с оригиналом (тот же код, но проверяем сквозной путь).
- **SyncEngine (unit)**: diff-логика (download/delete), обработка per-file ошибок,
  guard от параллельных синков — на моках WebDavClient/VaultWriter.
- **Ручной e2e на iOS** через BRAT: полный синк, инкрементальный синк, удаление,
  неверный пароль, offline.

## 11. Этапы поставки
- **M0** — `crypto-core` + тесты + golden-вектора.
- **M1** — Encryptor CLI (`encrypt-sync`, инкрементальность, манифест) + esbuild-бандл
  в единый `encryptor.mjs` без зависимостей для копирования на VPS.
- **M2** — Плагин: WebDavClient + ManifestService + расшифровка + запись, команда `Sync now`.
- **M3** — Scheduler + SettingsTab + StatusUI (интервалы, sync-on-open, статус).
- **M4** — Edge-cases, релиз для BRAT (`manifest.json`/`versions.json`, `isDesktopOnly:false`).
- **M5** (позже) — Android, потоковое шифрование больших файлов, keyfile вместо passphrase.

## 12. Открытые вопросы на будущее
- Опциональный keyfile / ввод пароля в память вместо data.json (безопасность).
- Ротация ключа / смена passphrase (перешифровка всего vault).
- Прогресс-бар для больших синков; ограничение параллелизма загрузок.
```
