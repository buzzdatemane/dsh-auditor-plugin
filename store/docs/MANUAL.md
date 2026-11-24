# Manual mode: продажи без бюджета

Этот режим не требует BTCPay, VPS, домена и ежемесячных платежей.
Лицензии выдаются локально, оплата принимается в крипте вручную, ключи
отправляются в Telegram.

## Что нужно

- Node.js 24+;
- `store/` с зависимостями;
- крипто-кошелёк (USDT TRC20 / BTC / Lightning);
- Telegram-аккаунт для переписки;
- GitHub Pages для лендинга (бесплатно).

BTCPay и Telegram-бот **не нужны**.

## 1. Установка

```powershell
cd store
npm install
Copy-Item .env.example .env
```

Для manual-режима достаточно:

```env
DATA_DIR=./data
# опционально: стабильные ключи лицензий
LICENSE_PRIVATE_KEY=
LICENSE_PUBLIC_KEY=
```

Если ключи не заданы, при первом запуске создастся
`data/license-keypair.json`. Сделай бэкап: без него старые лицензии нельзя
проверить новым публичным ключом.

## 2. Выдать ключи

```powershell
npm run issue-manual -- --tier pro --pack 10 --buyer @alice
```

Пример вывода:

```text
Manual order: manual-...
Tier: pro, keys: 10, seats: 1, price: $9.90
Buyer: @alice

License keys:
1. dsa1....
...
```

Другие примеры:

```powershell
# один Pro-ключ
npm run issue-manual -- --tier pro --pack 1 --buyer @alice

# Team на 5 мест
npm run issue-manual -- --tier team --buyer @team

# Lifetime
npm run issue-manual -- --tier lifetime --buyer @alice

# свой номер заказа и заметка
npm run issue-manual -- --tier pro --pack 10 --order 2026-001 --buyer @alice --note "USDT TRC20"

# список заказов
npm run issue-manual -- --list

# JSON для автоматизации
npm run issue-manual -- --tier pro --pack 10 --json
```

Заказы пишутся в `data/manual-orders.json` (не коммить).

## 3. Процесс продажи

1. Покупатель пишет в Telegram.
2. Согласуйте объём: аудит / Pro-пакет / Team.
3. Отправьте адрес кошелька и сумму.
4. Дождитесь подтверждения сети.
5. Проверьте txid в explorer.
6. Выдайте ключи командой `issue-manual`.
7. Отправьте ключи покупателю в Telegram.
8. Запишите заказ и txid в `manual-orders.json`/CSV.

## 4. Лендинг на GitHub Pages

В `site/index.html` замени:

```html
<a class="button" href="https://t.me/your_bot?start=site">Открыть бота</a>
```

на свой Telegram. Затем:

1. Запушь репозиторий в GitHub.
2. Settings → Pages → Build and deployment → **GitHub Actions**.
3. Workflow `.github/workflows/pages.yml` опубликует `site/`.

Страница не требует сервера и API. Кнопки Pro показывают «в разработке».

## 5. Цены

| SKU | Цена | Комментарий |
|---|---:|---|
| Аудит плагина | $20 | основная услуга на старте |
| Pro ×10 | $9.90 | пакет, когда Pro будет готов |
| Pro ×1 | $0.99 | только автоматизация; вручную невыгодно |
| Team ×5 | $2.99 | когда Pro будет готов |
| Lifetime | $1.99 | когда Pro будет готов |

При ручной продаже **не продавай $0.99**: комиссия сети и переписка дороже.
Минимум — пакет $9.90 или аудит $20.

## 6. Крипта

- **USDT TRC20** — низкая комиссия, удобно для пакетов.
- **BTC Lightning** — лучше для микроцен, если есть кошелёк.
- **On-chain BTC** — только для крупных платежей; комиссия может съесть $0.99.

Всегда проверяй txid и сумму. Крипто-платежи необратимы — условие возврата
согласуй до оплаты.

## 7. Ограничения

- Нет автоматической выдачи: каждый заказ обрабатывается вручную.
- Нет вебхуков и статусов оплаты.
- Pro-функции ещё не реализованы; не продавай Pro как готовый продукт без
  предупреждения.
- Не публикуй `data/` и ключи.
- Для масштабирования позже: BTCPay/Cloudflare Worker + бот.
