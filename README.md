# REG.AI Telegram Bot

Личный Telegram-клиент для REG.RU AI Models. Работает на Cloudflare Workers, хранит пользователей, отдельные диалоги и историю в Cloudflare D1.

## Возможности

- Получение доступных моделей через GET /v1/models.
- Диалог через POST /v1/chat/completions с сохранением контекста.
- Отдельные диалоги, история и переключение между ними.
- Загрузка TXT, Markdown, CSV, JSON, исходного кода, DOCX и PDF с текстовым слоем.
- Системная инструкция: /prompt текст и /resetprompt.
- Счётчики запросов и токенов.
- Доступ только Telegram ID из ALLOWED_USER_IDS.

Важно: публичный API REG.RU не документирует метод чтения денежного баланса. Кнопка «Баланс / расходы» показывает учёт токенов, накопленный ботом, и ведёт в личный кабинет для проверки реального остатка.

## 1. Создать Cloudflare D1

В терминале с установленным Node.js 20+:

~~~powershell
npm install
npx wrangler login
npx wrangler d1 create tlgbot-db
~~~

Скопируй database_id из ответа и замени REPLACE_WITH_D1_DATABASE_ID в wrangler.toml. Имя базы оставь tlgbot-db.

Затем закоммить изменение wrangler.toml в main. GitHub Actions применит миграцию migrations/0001_initial.sql и опубликует Worker.

## 2. Настроить GitHub Actions

В репозитории GitHub открой Settings → Secrets and variables → Actions → New repository secret и добавь:

- CLOUDFLARE_API_TOKEN — API Token с правами Cloudflare Workers Scripts: Edit и D1: Edit для нужного аккаунта;
- CLOUDFLARE_ACCOUNT_ID — Account ID Cloudflare.

После этого каждый push в main запускает применение D1-миграций и публикацию Worker. Ручной запуск доступен в Actions → Deploy Telegram bot to Cloudflare Workers → Run workflow.

## 3. Добавить секреты Worker

После первого успешного deploy открой Cloudflare → Workers & Pages → zevnull-reg-ai-bot → Settings → Variables and Secrets. Добавь именно как Secrets:

- TELEGRAM_BOT_TOKEN — токен, который выдал BotFather для @zevnull_GptMyBot;
- TELEGRAM_WEBHOOK_SECRET — случайная строка 32–256 символов, только латиница, цифры, _ и -;
- REGCLOUD_API_KEY — API-ключ из панели REG.RU AI Models;
- ALLOWED_USER_IDS — твой числовой Telegram ID. После первого запуска отправь боту /id, затем впиши полученное число.

До заполнения ALLOWED_USER_IDS бот отвечает только на /id и не выполняет запросы к модели. Можно указать несколько ID через запятую, если позже понадобится дать доступ другим людям.

После добавления Secrets сделай повторный deploy (например, пустым commit или ручным запуском workflow).

## 4. Зарегистрировать Telegram webhook

Открой PowerShell в клоне репозитория и запусти:

~~~powershell
.\scripts\set-webhook.ps1
~~~

Скрипт запросит URL Worker вида https://zevnull-reg-ai-bot.<твой-поддомен>.workers.dev, токен Telegram и TELEGRAM_WEBHOOK_SECRET. Ввод токена и секрета скрыт. Скрипт зарегистрирует адрес /telegram и покажет getWebhookInfo.

## 5. Проверка

- Открой https://<worker-url>/health — ожидается JSON со status=ok и database=true.
- Напиши боту /id, пропиши ID в ALLOWED_USER_IDS и повторно deploy.
- Отправь /start, выбери модель и задай вопрос.
- Нажми «Новый диалог», затем проверь «Историю».
- Отправь небольшой TXT или PDF с текстовым слоем.

## Команды

| Команда | Действие |
|---|---|
| /start, /menu | Главное меню |
| /id | Показать Telegram ID |
| /models | Выбрать модель |
| /new | Новый диалог |
| /history | История диалогов |
| /usage | Статистика запросов и токенов |
| /prompt текст | Установить системную инструкцию |
| /resetprompt | Сбросить инструкцию |

## Файлы и ограничения

Telegram Bot API позволяет скачивать файлы размером до 20 МБ, но в этом проекте задан более осторожный лимит 10 МБ. PDF ограничен 80 страницами, DOCX — 5 МБ, извлечённый текст — 30 000 символов. Сканированные PDF без текстового слоя и изображения пока не поддерживаются; OCR и vision не подключены.

Бесплатный Cloudflare Workers имеет жёсткий лимит CPU на один запрос. Разбор больших PDF/DOCX может упереться в него, даже если файл укладывается в размерные ограничения. Для первого запуска используй небольшие документы. При необходимости можно отключить тяжёлый PDF-разбор или перейти на тариф с большим CPU budget.

## Безопасность

- Не коммить Telegram token, REG.RU API key, webhook secret или Cloudflare API token.
- Не отправляй секреты в чаты и issues.
- Вебхук проверяет X-Telegram-Bot-Api-Secret-Token.
- Все команды и диалоги доступны только ID из ALLOWED_USER_IDS.
- Диалоги и извлечённый текст файлов сохраняются в D1.
