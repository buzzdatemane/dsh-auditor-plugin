# Deploy

Store — обычный Node.js HTTP-сервис. Ему нужен публичный HTTPS для Telegram и
BTCPay webhook.

## Локально

```powershell
cd store
npm install
Copy-Item .env.example .env
npm run dev
```

Открой `http://localhost:8787`.

## Быстрый публичный HTTPS без VPS

```powershell
cloudflared tunnel --url http://localhost:8787
```

Полученный `https://*.trycloudflare.com` поставь в `BASE_URL`, перезапусти
store. Это только для теста: URL меняется.

## VPS + Caddy

```caddyfile
auditor.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8787
}
```

```powershell
npm ci
npm run build
npm start
```

Systemd unit — в `deploy/dsh-auditor-store.service`. Замени пути, пользователя
и домен.

## Docker

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

`data/` — volume; без него потеряются заказы и ключ лицензий.

## Production checklist

- [ ] HTTPS и домен
- [ ] `PRO_AVAILABLE` решаешь осознанно; сейчас `false`
- [ ] BTCPay webhook указывает на `/api/btcpay/webhook`
- [ ] Telegram webhook установлен через `npm run telegram:setup`
- [ ] `data/` в бэкапе, права 600
- [ ] `.env` не в git
- [ ] тестовая оплата $0.99 прошла
- [ ] refund policy опубликована
- [ ] налоги/AML проверены
- [ ] rate limit на Caddy/Cloudflare для `/api/checkout`

## Проверка

```powershell
curl https://auditor.example.com/health
npm run btcpay:check
npm run telegram:setup
```
