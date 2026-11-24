# Listing kit: dshmarket / dsh.so / dshbase

Готовые тексты для каталогов. Отправлять после того, как репозиторий публичен и
есть рабочая ссылка на лендинг/бота.

## Короткое описание

**RU:** Read-only аудит безопасности DSH-плагинов: install-скрипты, опасные
зависимости, child_process/eval/fs/network, score 0–100 и evidence.

**EN:** Read-only security audit for DSH plugins: install scripts, risky
dependencies, child_process/eval/fs/network, 0–100 score and evidence.

## Длинное описание

DSH Auditor проверяет плагин до установки: читает `package.json` и исходники,
ищет install/postinstall-скрипты, известные скомпрометированные зависимости,
`child_process`, `eval`, доступ к файлам и сети. Код плагина не запускается.
Результат — JSON/отчёт с score 0–100 и evidence. Есть ручной аудит и
manual-лицензии; Pro-функции в разработке.

## Категории

- Security & Permissions
- Development & Runtime
- Tools & Capabilities

## Ключевые слова

`dsh`, `dsh-plugin`, `security`, `audit`, `supply-chain`, `static-analysis`,
`auditor`, `plugin-security`

## Ссылки

- GitHub: https://github.com/buzzdatemane/dsh-auditor-plugin
- Landing: https://buzzdatemane.github.io/dsh-auditor-plugin/
- Telegram bot: `https://t.me/<bot>` после создания
- npm: `https://www.npmjs.com/package/dsh-auditor-plugin` после публикации

## Куда отправлять

| Каталог | Ссылка |
|---|---|
| dsh.so | https://www.dsh.so/submit/ |
| dsh-market | https://dshmarket.com/ (каталог собирается из awesome-dsh-plugin) |
| dshbase | https://dshbase.com/ |
| DSHHub | https://www.dshhub.co/ |

Проверь актуальную форму на сайте: каталоги меняют процесс.

## Чек-лист перед отправкой

- [ ] репозиторий публичный;
- [ ] npm-пакет опубликован или есть tarball;
- [ ] лендинг открывается по HTTPS;
- [ ] бот отвечает на `/start`;
- [ ] в README есть ссылка на бота и лендинг;
- [ ] `PRO_AVAILABLE=false`, Pro честно помечен «в разработке»;
- [ ] нет секретов в git;
- [ ] контакт для связи указан.
