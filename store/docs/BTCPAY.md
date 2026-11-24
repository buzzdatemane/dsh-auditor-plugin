# BTCPay Server: приём крипты

Store поддерживает BTCPay Greenfield API: создание invoice, webhook с
HMAC-подписью, статусы `InvoiceSettled` / `InvoiceExpired` / `InvoiceInvalid`.

## Hosted или self-hosted

- **Hosted BTCPay** — быстрее: не нужно поднимать Bitcoin/Lightning node.
  Подходит для первых продаж.
- **Self-hosted BTCPay** — полный контроль, но нужен сервер, диск и
  обслуживание node. Для micro-цен это заметно дороже, чем сам store.

Для микроцен используй **Lightning** (низкая комиссия) или USDT. On-chain BTC
на $0.99 может стоить дороже покупки.

## 1. Store и кошелёк

1. Создай store в BTCPay.
2. Подключи wallet (on-chain и/или Lightning).
3. Включи нужную валюту/методы оплаты.

## 2. API key

Создай API key с доступом к этому store:

- создание и чтение invoices;
- чтение store;
- управление webhooks (если используешь `--create-webhook`).

Точные названия permissions зависят от версии BTCPay; если `btcpay:check`
получает 403 — добавь права на store/invoices/webhooks.

## 3. `.env`

```text
PAYMENT_PROVIDER=btcpay
BASE_URL=https://auditor.example.com
BTCPAY_URL=https://btcpay.example.com
BTCPAY_STORE_ID=...
BTCPAY_API_KEY=...
BTCPAY_WEBHOOK_SECRET=<random secret>
```

## 4. Webhook

URL:

```text
https://<домен>/api/btcpay/webhook
```

События:

- `InvoiceSettled` — выдаёт лицензии;
- `InvoiceExpired` — помечает заказ `expired`;
- `InvoiceInvalid` — помечает `failed`.

Можно создать webhook скриптом:

```powershell
npm run btcpay:check -- --create-webhook
```

Или вручную в BTCPay: Store → Webhooks → Create. Секрет должен совпадать с
`BTCPAY_WEBHOOK_SECRET`.

## 5. Проверка

```powershell
npm run btcpay:check
```

Скрипт покажет store и список webhooks. Затем:

1. Создай тестовый заказ на минимальную сумму.
2. Оплати Lightning/USDT.
3. Убедись, что заказ стал `paid`, ключи появились на success-page/в Telegram.
4. Проверь повторный webhook: ключи не должны дублироваться.

## Важно

- Не выдавай ключи по `InvoiceProcessing`; жди `InvoiceSettled`.
- Настрой HTTPS: BTCPay не отправит webhook на localhost.
- Для локального теста используй Cloudflare quick tunnel.
- Крипто-платежи необратимы: опубликуй refund policy.
- Налоги, AML/KYC и ограничения по крипте — проверь с юристом/бухгалтером.
