# Чек-лист MVP-аудитора DSH-плагинов

Статус: шаг 2 — исследование открытых сканеров и минимальный набор проверок.
Область: статический аудит пакета DSH-плагина **до установки/включения**, без
исполнения кода плагина.

> Статус реализации: `src/index.ts` использует воспроизводимую safety-шкалу
> `100 − weights` (см. README) и покрывает M1, M4 (импорты `child_process` /
> `eval` / `fs` / сети), M5 в части curated-списка опасных пакетов и
> unpinned/remote-зависимостей, а также базовый M6. `npm audit` (CVE),
> репутация URL, credential-пути и полное сопоставление разрешений остаются
> следующими шагами; шкала риска ниже — исследовательская, не текущая
> реализация.

## 1. Что берём из dsh-warden и dshscan

| | `dsh-warden` | `dshscan` |
|---|---|---|
| Подход | Только чтение: `package.json`, исходники, market registry. Ничего не исполняет | Статика + опциональная LLM-семантика, `npm audit`, HTML-отчёт |
| install-скрипты | `preinstall` / `install` / `postinstall` / `prepare` → high | R009: lifecycle-скрипт; `curl/wget/eval/exec/base64/http://` внутри → high, иначе medium |
| Опасные API | `child_process` / `execSync` / `vm` — medium; `eval` / `new Function` / persistence — high | R002: `eval`, `new Function`, `vm.runIn*`, `os.system`, `child_process.exec*` → high; `shell:true` → medium |
| ФС и сеть | Ищет credential-пути, рекурсивное удаление, внешние домены | R004/R004b: HTTP и жёстко заданные публичные IP; R005: чтение секретов + сетевой sink; R012: запись в profile |
| Зависимости | Только наличие native-модулей; **npm audit не запускает** | D001–D003: unpinned, remote source, typosquatting; `npm audit` — **опционально** (`--audit`) |
| Разрешения | Сверяет `capabilities` / `capabilityRedLines` market registry с фактами | DSH-правила R010–R015: patch-инъекции, client-код, tampering, shadowing |
| Шкала | **Safety score**: 100 − high×18 − medium×8 − info×2 − error×40. `safe` ≥75, `caution` ≥50, иначе `risky`; ≥2 high → принудительно `risky` | **Risk score**: critical 50 / high 30 / medium 15 / low 5; в категории берётся максимум, категории суммируются, cap 100. `safe_to_install` только при отсутствии high/critical и score <40 |

Главные выводы:

1. Оба сканера согласны, что install-хуки и `eval` — высокий риск, а
   `child_process` сам по себе — двойственного назначения (medium/caution).
2. `dsh-warden` не проверяет CVE в зависимостях; `dshscan` умеет, но только с
   флагом `--audit`. Для MVP **npm audit должен быть обязательным**, иначе
   типичное упущение — CVE в транзитивном пакете — остаётся.
3. Полезная идея `dshscan`: считать максимум по категории, а не складывать
   каждый повторный regex-хит. Это защищает от «40 × chmod = 100».
4. Полезная идея `dsh-warden`: отдельный жёсткий предохранитель по числу
   high-находок, чтобы одна хорошая оценка не маскировала опасный сигнал.

## 2. Модель оценки

Шесть проверок, у каждой:

- `score_i` — риск **0–100**, где 0 — чисто, 100 — максимальный риск;
- `weight_i` — вклад в итог, сумма весов = 100.

Итоговый балл:

```
weighted = Σ(score_i × weight_i) / 100
```

Но среднее нельзя давать одному критическому сигналу: он растворится в чистых
проверках. Поэтому итог — это `weighted` с нижней границей по худшей проверке:

```
score = weighted
if any critical signal: score = max(score, 80)
if any high signal:     score = max(score, 50)
if any score_i >= 70:   score = max(score, 70)
if any score_i >= 30:   score = max(score, 30)
if audit unavailable:   score = max(score, 40)
```

Критические сигналы, которые всегда поднимают итог до 80+: remote pipe-to-shell,
download-and-execute, чтение credentials с сетевым sink, запись/подмена
profile-конфига, отключение security-строк в patch, remote data → `eval`/`exec`,
critical CVE.

Вердикт:

| Итоговый score | Вердикт | Значение |
|---|---|---|
| 0–29 | `safe` | Можно ставить, но с обычными мерами предосторожности |
| 30–69 | `caution` | Только после ручного просмотра находок; не в основной profile |
| 70–100 | `risky` | Не устанавливать без изоляции и разбора кода |

`safe_to_install = (verdict === "safe")`, причём `safe` запрещён, если
`npm audit` не выполнялся или завершился ошибкой. «Неизвестно» — это не «чисто».

## 3. Чек-лист

### Сводная таблица

| # | Проверка | Вес | Safe 0–29 | Caution 30–69 | Risky 70–100 |
|---|---|---|---|---|---|
| M1 | Install / postinstall-скрипты | 20 | Нет lifecycle-скриптов | Локальная сборка, native-deps | Remote pipe-to-shell, `--unsafe-perm`, запись в profile |
| M2 | Доступ к файловой системе | 15 | Только чтение своих assets | Запись в temp/cache, чтение home/cwd | Credential-пути, рекурсивное удаление, запись в `~/.dsh` |
| M3 | Сетевой доступ | 15 | Нет сети или известный HTTPS-домен | Произвольный HTTPS, HTTP, IP | Отправка секретов/файлов, download-and-execute |
| M4 | Опасные API | 20 | Нет опасных вызовов | `child_process` с фиксированными аргументами, `shell:true` | `eval`, `new Function`, persistence, obfuscation+exec |
| M5 | Уязвимости зависимостей | 20 | `npm audit` чист, lockfile есть | Medium CVE или audit недоступен | High/critical CVE, в том числе транзитивный |
| M6 | Заявленные vs фактические разрешения | 10 | Декларация совпадает с фактами; over-declaration | Нет метаданных | Under-declaration credentials/ФС, red line, patch tampering |

Сумма весов: **100**.

---

### M1. Install / postinstall-скрипты — вес 20

**Что ищем**

- `package.json` → `scripts.preinstall`, `scripts.install`, `scripts.postinstall`,
  `scripts.prepare`.
- Содержимое скрипта: `curl`, `wget`, `Invoke-WebRequest`, `fetch` + пайп в
  `sh` / `bash` / `iex`; `eval`; `base64 -d`; `npm`/`pnpm`/`yarn` с URL или
  `git+`; `--unsafe-perm`; `chmod 777`; запись в `~/.dsh` или startup.
- Native-сборка: `binding.gyp`, `node-gyp`, `node-pre-gyp`, а также зависимости
  `sharp`, `bcrypt`, `sqlite3`, `canvas`, `puppeteer`, `playwright`, `esbuild`,
  `@swc/core` — они могут тянуть бинарники или выполнять код при установке.

**Шкала**

| Баллы | Сигнал |
|---|---|
| 0 | Нет lifecycle-скриптов и native-сборки |
| 30 | Native-зависимость / `binding.gyp` или обычная локальная сборка (`node scripts/build.js`, `tsc`, `node-gyp rebuild`) |
| 50 | Скачивание без исполнения (`curl -o ...`) или установка пакета из remote/git |
| 75 | `curl ... → sh`, `iwr ... → iex`, `eval`, `base64 -d → sh`, `--unsafe-perm` |
| 90 | Запись в profile/startup или другой persistence-путь |
| +10 | Два и более lifecycle-хука (например, `install` + `postinstall`), cap 100 |

**Severity:** 0–29 `safe`, 30–69 `caution`, 70–100 `risky`.

**Почему так:** install-скрипт выполняется до первого аудита кода и с правами
пользователя. Даже «обычная» сборка — это исполнение чужого кода; remote
pipe-to-shell — прямой RCE. `prepare` опасен при установке из git, поэтому
входит в тот же список.

---

### M2. Доступ к файловой системе — вес 15

**Что ищем**

- Импорты `node:fs`, `fs/promises`, вызовы `readFile`, `writeFile`, `appendFile`,
  `rmSync`, `unlinkSync`, `chmod`, `rename`, `copyFile`, `createWriteStream`.
- Пути: `os.homedir()`, `process.env.HOME` / `USERPROFILE`, `path.join` с
  пользовательским вводом, `../`.
- Чувствительные пути: `.ssh`, `.aws`, `.npmrc`, `.git-credentials`, `.env`,
  `credentials.yaml`, `~/.dsh`, `profiles/`, `cordis.yml`, `cordis.patch.yml`,
  `package.json` → `dsh.profile.bundles`, `pnpm-workspace.yaml`.
- Рекурсивное удаление (`rmSync(..., { recursive: true })`, `rmdirSync`) и
  `chmod 777`.

**Шкала**

| Баллы | Сигнал |
|---|---|
| 0 | Нет ФС-доступа или только чтение файлов внутри пакета |
| 20 | Запись в temp/cache с фиксированным путём |
| 35 | Чтение home/cwd-конфигов, не являющихся секретами |
| 55 | Запись вне пакета: home, startup, другие проекты |
| 75 | Credential-пути, рекурсивное удаление, `chmod 777` |
| 100 | Запись/удаление в `~/.dsh`, profile, `cordis.patch.yml`, `dsh.profile.bundles` |
| +10 | Путь из пользовательского ввода без нормализации (`path traversal`), cap 100 |

**Severity:** 0–29 `safe`, 30–69 `caution`, 70–100 `risky`.

**Почему так:** плагин живёт в процессе хоста и видит те же файлы, что и агент.
Чтение `.ssh`/`.env` — это кража секретов; запись в profile — это уже
persistence/tampering, а не просто «работа с файлами».

---

### M3. Сетевой доступ — вес 15

**Что ищем**

- `fetch`, `http.request`, `https.request`, `axios`, `net.connect`, `dns`,
  `WebSocket`, `navigator.sendBeacon`.
- Жёстко заданные URL, HTTP без TLS, публичные IP, нестандартные порты,
  количество разных доменов.
- Отправка `process.env`, токенов, файлов: `POST`, `PUT`, `sendBeacon`,
  `formData`, `upload`.
- Загрузка кода и его исполнение: `fetch(...).then(r => r.text())` → `eval` /
  `new Function` / `import()` / `exec`.

**Шкала**

| Баллы | Сигнал |
|---|---|
| 0 | Сети нет |
| 10 | HTTPS к известному домену: `registry.npmjs.org`, `github.com`, `raw.githubusercontent.com`, `api.deepseek.com`, `localhost` |
| 30 | Произвольный внешний HTTPS-домен |
| 50 | HTTP cleartext, жёстко заданный публичный IP, нестандартный порт |
| 75 | POST/upload/beacon с env, токенами, файлами |
| 100 | Скачивание кода и его исполнение/импорт/eval |
| +10 | 5+ разных доменов; +10 за base64/DNS-подобные поддомены, cap 100 |

**Severity:** 0–29 `safe`, 30–69 `caution`, 70–100 `risky`.

**Почему так:** один известный API-домен — норма для плагина. Неизвестный домен
сам по себе ещё не зло, но требует проверки. Сочетание «читает секреты + шлёт
наружу» или «скачивает и исполняет» — уже критично.

---

### M4. Опасные API — вес 20

**Что ищем**

- `node:child_process`: `exec`, `execSync`, `spawn`, `spawnSync`, `execFile`,
  `fork`.
- `eval`, `new Function`, `vm.runInNewContext` / `runInThisContext`,
  `Module._compile`, `process.binding`.
- `shell: true`, `shell=True`, `os.system`, `subprocess` с `shell=True`.
- Обфускация: `base64`, `atob`, `String.fromCharCode`, `\x..` в сочетании с
  `eval`/`exec`.
- Persistence: `schtasks`, `reg add ...\Run`, `crontab -e`, `launchctl`,
  `systemctl enable`.
- DSH client-side: `sendBeacon`, `WebSocket`, `keydown`/`input`/`paste`,
  `navigator.clipboard`, `innerHTML`, `postMessage('*')` — по правилам R011.

**Шкала**

| Баллы | Сигнал |
|---|---|
| 0 | Нет опасных вызовов |
| 35 | `child_process` импортирован, но вызов с фиксированными аргументами (`spawn('git', ['status'])`) |
| 50 | `shell: true` / `shell=True`; `exec` со статической строкой |
| 65 | `exec`/`execSync` с интерполяцией или пользовательским вводом |
| 75 | `eval`, `new Function`, `vm.runIn*` |
| 85 | Persistence: registry Run, `schtasks`, `crontab`, `launchctl`, `systemctl enable` |
| 90 | Обфускация + `eval`/`exec` |
| 100 | Remote data → `eval`/`exec`/`import`, либо client-код, отправляющий ввод/буфер обмена |
| +10 | Несколько разных опасных категорий, cap 100 |

**Severity:** 0–29 `safe`, 30–69 `caution`, 70–100 `risky`.

**Почему так:** `child_process` — двойственного назначения: браузерному
драйверу он нужен по работе. Поэтому одиночный импорт — `caution`, а не
автоматический `risky`. `eval` и `new Function` почти всегда означают
исполнение данных, поэтому high/risky.

---

### M5. Уязвимости зависимостей — вес 20

**Что ищем**

- `npm audit --json --omit=dev` в копии пакета (runtime-зависимости).
- При наличии lockfile: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`.
- Поля `vulnerabilities`: `name`, `severity`, `range`, `isDirect`, `via`,
  `effects`.
- Дополнительно: `*` / `latest` / `>=` / `x` в версиях; `http(s):`, `git+`,
  `github:` в зависимостях; подозрение на typosquatting (D001–D003).

**Шкала**

| Баллы | Сигнал |
|---|---|
| 0 | `npm audit` чист, lockfile присутствует |
| 20 | Только low/info |
| 40 | Moderate/medium **или** audit недоступен / нет lockfile |
| 70 | High |
| 90 | Critical |
| +10 | Уязвимость в прямой зависимости |
| +5 | Каждая дополнительная high/critical, максимум +10 |
| +20 | Unpinned-версия (`*`, `latest`, `>=`) |
| +30 | Remote/git-зависимость |
| +50 | Подозрение на typosquatting, cap 100 |

Правила:

- Берём **максимальную** severity по пакету, а не суммируем все CVE.
- Транзитивная уязвимость **не** получает скидку: CVE в транзитивном пакете —
  такой же риск, как в прямом. В evidence указываем `via`/путь зависимости.
- Если уязвимы только `devDependencies`, которые не попадают в установку,
  score ограничивается 30 (`caution`), но находка остаётся в отчёте.
- `npm audit` не запустился → **40 / caution**, никогда не `safe`.

**Severity:** 0–29 `safe`, 30–69 `caution`, 70–100 `risky`.

**Почему так:** именно здесь закрывается типичное упущение «аудит только кода».
CVE в транзитивном пакете не виден при чтении исходников плагина, но
устанавливается вместе с ним и исполняется в том же процессе.

---

### M6. Заявленные vs фактические разрешения — вес 10

**Что ищем**

- Заявленные возможности: `capabilities` и `capabilityRedLines` из market
  registry (например, `shell`, `credentials`, `network`, `fs`), поля
  `dsh.bundle` / `dsh.client` / `platforms` и явные обещания в README.
- Фактические возможности: сигналы из M1–M5 (install-хуки, ФС, сеть,
  `child_process`, credential-пути).
- DSH-специфика: `cordis.patch.yml` не должен вставлять опасные loader-строки,
  отключать security-строки (`approval`, `permission`, `tool-bash`,
  `tool-pwsh`, `llm-deepseek`, `session-telemetry-otel`) или подменять
  встроенные инструменты.
- Код не должен писать в `~/.dsh/profiles`, `cordis.yml`, `cordis.patch.yml`,
  `dsh.profile.bundles`, `pnpm-workspace.yaml`.

**Шкала**

| Баллы | Сигнал |
|---|---|
| 0 | Декларация совпадает с фактическим поведением |
| 10 | Только over-declaration: заявлено больше, чем используется (прозрачность, не опасность) |
| 30 | Нет метаданных/декларации — проверить не с чем (`unknown`) |
| 50 | Under-declaration: использует сеть или shell, но не заявил |
| 70 | Under-declaration: читает credentials/ФС, но не заявил |
| 90 | Red line маркетплейса; patch отключает security-строки; tool shadowing; опасный loader |
| 100 | Запись/подмена profile-конфига или remote dynamic loading |
| +10 | Два и более несоответствия, cap 100 |

**Severity:** 0–29 `safe`, 30–69 `caution`, 70–100 `risky`.

**Почему так:** в DSH `package.json` нет универсального поля `permissions`;
источник декларации — market registry и README/манифест. Если метаданных нет,
это не «чисто», а `unknown` → минимум `caution`. Under-declaration опаснее
over-declaration: плагин делает то, о чём пользователь не предупреждён.

---

## 4. Итоговый вердикт

1. Считаем `score_i` для M1–M6.
2. Считаем `weighted`.
3. Применяем нижние границы: critical → 80, high → 50, любой `score_i ≥ 70` →
   70, любой `score_i ≥ 30` → 30, audit unknown → 40.
4. `0–29` → `safe`, `30–69` → `caution`, `70–100` → `risky`.
5. `safe_to_install = true` только для `safe`, при условии что все проверки
   реально выполнялись.

Примеры:

| Сценарий | Расчёт | Итог |
|---|---|---|
| Чистый плагин, audit чист | weighted 0 | `0 / safe` |
| `postinstall: node scripts/build.js` | M1 30, floor 30 | `30 / caution` |
| `child_process` с фиксированными аргументами + один неизвестный HTTPS-домен | weighted ≈ 12, floor 30 | `30 / caution` |
| Только critical CVE в транзитивной зависимости | weighted 18, floor 80 | `80 / risky` |
| Чтение `.ssh` + POST на внешний домен | M2 75, M3 75, floor 80 | `80 / risky` |
| `cordis.patch.yml` отключает `approval` | M6 90, critical gate 80 | `80 / risky` |
| `npm audit` не запустился | floor 40 | `40 / caution` |

## 5. Формат отчёта MVP

JSON — источник истины, текст/HTML — представление.

```json
{
  "tool": "dsh-auditor",
  "version": "0.1.0",
  "target": "dsh-example",
  "risk_score": 35,
  "verdict": "caution",
  "safe_to_install": false,
  "checks": [
    { "id": "M1", "weight": 20, "score": 30, "severity": "caution" },
    { "id": "M2", "weight": 15, "score": 0, "severity": "safe" },
    { "id": "M3", "weight": 15, "score": 30, "severity": "caution" },
    { "id": "M4", "weight": 20, "score": 35, "severity": "caution" },
    { "id": "M5", "weight": 20, "score": 0, "severity": "safe" },
    { "id": "M6", "weight": 10, "score": 0, "severity": "safe" }
  ],
  "findings": [
    {
      "check": "M1",
      "signal": "lifecycle_script",
      "severity": "caution",
      "score": 30,
      "evidence": "package.json: scripts.postinstall = node scripts/build.js",
      "recommendation": "Прочитать scripts/build.js; при возможности ставить с --ignore-scripts."
    }
  ],
  "scan": {
    "files_scanned": 12,
    "audit_ran": true,
    "audit_tool": "npm audit --json --omit=dev"
  }
}
```

Требования к находке: `file:line`, сниппет ≤ 300 символов, правило/сигнал,
рекомендация. Одинаковые сигналы в одном файле дедуплицируются.

## 6. Границы MVP

- **Не исполнять** код плагина и его install-скрипты. Пакет получать через
  `npm pack --ignore-scripts`, распаковывать в temp, сканировать копию.
- **Не делать** поведенческий sandbox/syscall-трейсинг — это следующий этап.
- **Не делать** полноценный taint/dataflow; для MVP достаточно regex +
  AST-lite (импорты, вызовы, строковые литералы).
- **Не сканировать** `node_modules`, `dist`, `build`, `.git`, vendored-код;
  тесты/доки/докерфайлы понижают severity на один уровень (как в dshscan),
  кроме prompt-injection в README.
- **Не считать** отсутствие находок доказательством безопасности: отчёт всегда
  содержит `scan_mode` и `audit_ran`.
- **npm audit** зависит от registry/network и lockfile; при ошибке — `caution`,
  а не `safe`.

## 7. Приёмочные тесты MVP

| Вход | Ожидание |
|---|---|
| Плагин без скриптов, без сети, audit чист | `safe`, score < 30 |
| `postinstall` содержит remote pipe-to-shell | `risky`, M1 ≥ 75 |
| `child_process.spawn('git', ['status'])` | `caution`, M4 ≈ 35 |
| `eval(req.body.code)` | `risky`, M4 ≥ 75 |
| Critical CVE в транзитивной зависимости | `risky`, M5 ≥ 90 |
| Нет lockfile / `npm audit` упал | `caution`, M5 = 40 |
| Код читает `.ssh` и отправляет POST | `risky`, M2 + M3 ≥ 70 |
| `cordis.patch.yml` отключает `approval` | `risky`, M6 ≥ 90 |
| Плагин заявляет `shell`, но не использует | `safe` или `caution`, M6 = 10 |

## 8. Источники

- [dsh-warden — GitHub](https://github.com/Daphne999/dsh-warden)
- [dsh-warden: lib/audit.js](https://github.com/Daphne999/dsh-warden/blob/main/lib/audit.js)
- [dshscan — GitHub](https://github.com/shaoshi20/dshscan)
- [dshscan: src/rules.ts](https://github.com/shaoshi20/dshscan/blob/main/src/rules.ts)
- [dshscan: src/scanner.ts](https://github.com/shaoshi20/dshscan/blob/main/src/scanner.ts)
- [@shaoshi/dshscan — npm](https://www.npmjs.com/package/@shaoshi/dshscan)
