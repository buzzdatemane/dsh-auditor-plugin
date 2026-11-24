# Telegram: BotFather и выдача ключей

Бот создаётся **вручную** в Telegram. Скрипт `npm run telegram:setup` не может
создать бота — он проверяет токен, ставит webhook и показывает диагностику.

## 1. Создать бота

1. Открой Telegram и найди **@BotFather**.
2. Отправь `/newbot`.
3. Display name: `DSH Auditor` (или свой).
4. Username: например `dsh_auditor_<nick>_bot` — обязательно заканчивается на
   `bot`.
5. Скопируй **HTTP API token**. Не присылай его в чат и не коммить.

Опционально у BotFather:

```text
/setdescription  — Read-only security audit for DSH plugins
/setabouttext    — Buy a license, get the key in Telegram
/setcommands     — start - Получить ключи
/setjoingroups   — Disable
/setuserpic      — логотип
```

## 2. Заполнить `.env`

```text
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_BOT_USERNAME=dsh_auditor_your_bot
TELEGRAM_WEBHOOK_SECRET=<random 32+ chars>
BASE_URL=https://<публичный-https-адрес>
```

Сгенерировать secret:

```powershell
node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
```

## 3. Публичный HTTPS

Telegram не принимает `http://localhost`. Для локального теста используй
Cloudflare quick tunnel:

```powershell
cloudflared tunnel --url http://localhost:8787
```

Он напечатает `https://<random>.trycloudflare.com`. Поставь этот URL в
`BASE_URL`, перезапусти store. Для production нужен домен + Caddy/Nginx.

## 4. Поставить webhook

```powershell
cd store
npm run telegram:setup
```

Скрипт вызовет `getMe`, `setWebhook` и `getWebhookInfo`. Проверить вручную:

```text
https://api.telegram.org/bot<TOKEN>/getWebhookInfo
```

Удалить webhook:

```powershell
npm run telegram:setup -- --delete
```

## 5. Проверить выдачу

1. Запусти store в mock-режиме с `PRO_AVAILABLE=true` (для теста оплаты).
2. Создай и оплати заказ.
3. Открой `https://t.me/<bot>?start=<orderId>`.
4. Бот должен прислать ключи; если заказ ещё не оплачен — сообщение об
   ожидании.

Если бот не отвечает:

- `BASE_URL` не HTTPS или webhook не установлен;
- неверный `TELEGRAM_WEBHOOK_SECRET`;
- store не запущен/недоступен из интернета;
- бот не был запущен пользователем (нажми Start).

## Безопасность

- Токен и webhook secret — только в `.env`/секретах деплоя.
- При утечке: BotFather `/revoke` и новый токен.
- Бот не должен принимать платежи; он только доставляет ключи.
- Ключи можно переслать, поэтому для команд используй `team-5` и правила
  возврата.
