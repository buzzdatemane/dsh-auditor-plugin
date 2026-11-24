# dsh-auditor-store

Отдельный сервис продажи лицензий для `dsh-auditor-plugin`: лендинг,
крипто-счёт, webhook, выдача Ed25519-лицензий и доставка в Telegram.

Сервис **не входит** в npm-пакет плагина. Плагин остаётся бесплатным; store
продаёт Pro/Team/Lifetime-лицензии и пакеты кодов.

## Прайс

| SKU | Цена | Что это |
|---|---:|---|
| `pro-1` | $0.99/год | 1 Pro-ключ |
| `pro-10` | $9.90 | 10 Pro-ключей (основной SKU) |
| `team-5` | $2.99/год | 1 ключ на 5 разработчиков |
| `lifetime-1` | $1.99 | 1 бессрочный ключ |

Микроцены имеют смысл только пакетами: одна крипто-транзакция должна
покрывать сетевую комиссию. Основной поток — `pro-10`.

## Pro пока в разработке

По умолчанию `PRO_AVAILABLE=false`:

- кнопки покупки на лендинге отключены и показывают «В разработке»;
- `POST /api/checkout` возвращает `503`;
- store всё равно можно проверить в mock-режиме, поставив
  `PRO_AVAILABLE=true` **только локально**.

`PRO_AVAILABLE=true` имеет смысл включать после того, как в плагине появится
проверка лицензии и реальные Pro-функции. Иначе покупатель получит ключ,
который ничего не открывает.

## Manual mode без бюджета

Если нет денег на BTCPay/VPS, используй ручной режим: оплата в крипте
напрямую, ключи выдаются локально, лендинг — на GitHub Pages.

```powershell
cd store
npm install
Copy-Item .env.example .env

# выдать 10 Pro-ключей
npm run issue-manual -- --tier pro --pack 10 --buyer @alice

# посмотреть заказы
npm run issue-manual -- --list
```

Заказы сохраняются в `data/manual-orders.json`. Никакого сервера и BTCPay не
нужно. Подробно: [docs/MANUAL.md](docs/MANUAL.md).

Для приёма заявок есть Telegram-бот на long polling — без HTTPS и webhook:

```powershell
npm run bot
```

Бот создаётся в BotFather, токен и `TELEGRAM_OWNER_CHAT_ID` кладутся в `.env`.
Подробно: [docs/BOT.md](docs/BOT.md). Пока ПК выключен, бот офлайн.

Статическая страница для GitHub Pages лежит в [../site/](../site/); workflow
`.github/workflows/pages.yml` публикует её после push.

## Быстрый старт (mock, без денег)

```powershell
cd store
npm install
Copy-Item .env.example .env
# для локального теста покупки:
# в .env поставь PRO_AVAILABLE=true
npm run dev
```

Открой `http://localhost:8787`, выбери **Pro ×10**, нажми «Оплатить (mock)».
Появится 10 ключей; они же придут в Telegram, если бот настроен.

```powershell
npm run check
npm test
```

22 теста покрывают подпись лицензий, идемпотентность заказа, webhook BTCPay,
Telegram, HTTP-flow, manual-выдачу, sales-бота и отключение покупки при
`PRO_AVAILABLE=false`.

## Переменные окружения

Скопируй `.env.example` в `.env`. Секреты в git не коммить.

| Переменная | Зачем |
|---|---|
| `BASE_URL` | Публичный URL с HTTPS; используется в redirect и Telegram |
| `PAYMENT_PROVIDER` | `mock` или `btcpay` |
| `PRO_AVAILABLE` | `false` по умолчанию; включает покупку Pro только после готовности gating |
| `BTCPAY_URL` | URL BTCPay Server |
| `BTCPAY_STORE_ID` | ID store в BTCPay |
| `BTCPAY_API_KEY` | Greenfield API key с правом создавать/читать invoices |
| `BTCPAY_WEBHOOK_SECRET` | секрет webhook, тот же в BTCPay |
| `TELEGRAM_BOT_TOKEN` | токен бота от @BotFather |
| `TELEGRAM_BOT_USERNAME` | username бота без `@` |
| `TELEGRAM_WEBHOOK_SECRET` | secret_token для Telegram webhook |
| `TELEGRAM_OWNER_CHAT_ID` | твой chat id для sales-бота (`npm run bot`) |
| `ADMIN_TOKEN` | доступ к `GET /api/admin/orders` |
| `DATA_DIR` | где лежат `orders.json` и `license-keypair.json` |
| `LICENSE_PRIVATE_KEY` | опционально: стабильный Ed25519 private key |
| `LICENSE_PUBLIC_KEY` | опционально: публичный ключ для плагина |

Если ключи не заданы, сервис сгенерирует пару в `data/license-keypair.json`
при первом запуске. Для production лучше задать ключи через env и сделать
бэкап.

Проверка интеграций:

```powershell
npm run telegram:setup
npm run btcpay:check
```

Подробные инструкции: [docs/TELEGRAM.md](docs/TELEGRAM.md),
[docs/BTCPAY.md](docs/BTCPAY.md), [docs/MANUAL.md](docs/MANUAL.md),
[docs/BOT.md](docs/BOT.md), [docs/LISTINGS.md](docs/LISTINGS.md),
[docs/DEPLOY.md](docs/DEPLOY.md).

## BTCPay Server

1. Создай store в BTCPay.
2. Создай API key с доступом к invoices этого store.
3. Добавь webhook:
   `https://<твой-домен>/api/btcpay/webhook`
   с секретом `BTCPAY_WEBHOOK_SECRET`.
4. Включи события `InvoiceSettled`, `InvoiceExpired`, `InvoiceInvalid`.
5. Заполни `.env`:

```text
PAYMENT_PROVIDER=btcpay
BTCPAY_URL=https://btcpay.example.com
BTCPAY_STORE_ID=...
BTCPAY_API_KEY=...
BTCPAY_WEBHOOK_SECRET=...
BASE_URL=https://auditor.example.com
```

6. Сделай тестовый счёт на минимальную сумму и проверь, что заказ стал `paid`,
   а ключи появились в success-page/Telegram.

Для микроцен используй Lightning или USDT. On-chain BTC на $0.99 может стоить
дороже самой покупки.

## Telegram

1. Создай бота у `@BotFather`, получи token и username.
2. Заполни `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
   `TELEGRAM_WEBHOOK_SECRET`.
3. Поставь `BASE_URL` с публичным HTTPS.
4. При старте сервис сам вызовет `setWebhook`, если `BASE_URL` начинается с
   `https://`. Либо вызови вручную:

```text
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<domain>/telegram/webhook&secret_token=<SECRET>
```

Покупатель после оплаты открывает
`https://t.me/<bot>?start=<orderId>`; бот запоминает chat_id и отправляет
ключи. Если Telegram недоступен, ключи всё равно показываются на success-page.

## API

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/` | лендинг |
| `GET` | `/api/skus` | тарифы |
| `POST` | `/api/checkout` | `{ "skuId": "pro-10" }` → invoice URL |
| `GET` | `/api/orders/:id` | статус и ключи после оплаты |
| `POST` | `/api/btcpay/webhook` | BTCPay webhook |
| `POST` | `/telegram/webhook` | Telegram `/start <orderId>` |
| `POST` | `/api/mock/pay` | только `PAYMENT_PROVIDER=mock` |
| `GET` | `/api/license/public-key` | PEM публичного ключа |
| `GET` | `/api/admin/orders` | `Authorization: Bearer <ADMIN_TOKEN>` |

## Формат лицензии

```text
dsa1.<base64url(payload)>.<base64url(ed25519-signature)>
```

Payload:

```json
{
  "v": 1,
  "id": "...",
  "order": "...",
  "tier": "pro",
  "seats": 1,
  "issuedAt": "...",
  "expiresAt": "...",
  "packIndex": 0
}
```

Плагин проверяет подпись публичным ключом. Приватный ключ никогда не попадает
в клиент. Пока платные функции не реализованы, store выдаёт валидные ключи,
но gating в плагине — следующий шаг.

## Деплой

Минимально: VPS + Caddy/Nginx + HTTPS.

```caddyfile
auditor.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

Docker:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

`data/` должен быть на постоянном диске и в бэкапе: там заказы и приватный
ключ лицензий.

## Безопасность и юридические заметки

- Не коммить `.env`, `data/`, `license-keypair.json`.
- HTTPS обязателен для BTCPay и Telegram webhook.
- Не выдавай ключи до `InvoiceSettled`; mock-режим только для локальной
  проверки.
- Крипто-платежи необратимы: опубликуй refund policy и лимиты поддержки.
- Проверь налоги, AML/KYC и ограничения по крипте в своей юрисдикции с
  юристом/бухгалтером. Этот сервис — техническая часть, не юридическая.
- Не обещай «100% безопасность»: `dsh-auditor` снижает риск, но не заменяет
  sandbox и ручной аудит.
