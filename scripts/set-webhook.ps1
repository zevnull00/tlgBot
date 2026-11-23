$ErrorActionPreference = 'Stop'

Write-Host 'REG.AI Telegram bot — webhook setup' -ForegroundColor Cyan
$workerUrl = Read-Host 'Worker URL, например https://zevnull-reg-ai-bot.<subdomain>.workers.dev'
$workerUrl = $workerUrl.Trim().TrimEnd('/')
if ($workerUrl -notmatch '^https://[a-zA-Z0-9.-]+workers\.dev$') {
    throw 'Ожидается HTTPS URL вида https://имя.<поддомен>.workers.dev'
}

$tokenSecure = Read-Host 'Telegram bot token (ввод скрыт)' -AsSecureString
$token = [System.Net.NetworkCredential]::new('', $tokenSecure).Password
$secretSecure = Read-Host 'TELEGRAM_WEBHOOK_SECRET (значение из Cloudflare Worker Secrets)' -AsSecureString
$secret = [System.Net.NetworkCredential]::new('', $secretSecure).Password
if ($secret.Length -lt 32 -or $secret.Length -gt 256 -or $secret -notmatch '^[A-Za-z0-9_-]+$') {
    throw 'Webhook secret должен содержать 32–256 символов из A-Z, a-z, 0-9, _ или -.'
}

$body = @{
    url = "$workerUrl/telegram"
    secret_token = $secret
    allowed_updates = '["message","callback_query"]'
}
$result = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/setWebhook" -ContentType 'application/x-www-form-urlencoded' -Body $body
if (-not $result.ok) { throw "Telegram setWebhook failed: $($result.description)" }
Write-Host 'Webhook registered.' -ForegroundColor Green
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getWebhookInfo" | ConvertTo-Json -Depth 6

# Do not print or persist either credential.
$token = $null
$secret = $null
$tokenSecure = $null
$secretSecure = $null
