# REG.AI Telegram Bot

Личный Telegram-клиент для REG.RU AI Models. Работает на Cloudflare Workers, хранит пользователей, отдельные диалоги и историю в Cloudflare D1.

## Возможности

- Получение списка доступных моделей через GET /v1/models.
- Диалог через POST /v1/chat/completions с сохранением контекста.
- Несколько отдельных диалогов, история и переключение между ними.
- Загрузка TXT, Markdown, CSV, JSON, исходного кода, DOCX и PDF с текстовым слоем.
- Системная инструкция: /prompt текст и /resetprompt.
- Статистика запросов и токенов.
- Доступ только Telegram ID из ALLOWED_USER_IDS.

Важно: публичный API REG.RU не документирует метод чтения денежного баланса. Кнопка «Баланс / расходы» показывает учёт токенов, накопленный ботом, и ведёт в личный кабинет для проверки реального остатка.

## 1. Создать базу Cloudflare D1

В Cloudflare Dashboard открой Storage & Databases → D1 SQL Database → Create. Назови базу tlgbot-db. После создания скопируй Database ID.

В файле wrangler.toml замени REPLACE_WITH_D1_DATABASE_ID на скопированный ID. Имя базы оставь tlgbot-db.

## 2. Настроить GitHub Actions

В репозитории GitHub открой Settings → Secrets and variables → Actions → New repository secret и добавь:

- CLOUDFLARE_API_TOKEN — API Token с правами Cloudflare Workers Scripts: Edit и D1: Edit для нужного аккаунта;
- CLOUDFLARE_ACCOUNT_ID — Account ID Cloudflare.

Закоммить изменённый wrangler.toml в main. GitHub Actions применит миграцию migrations/0001_initial.sql и опубликует Worker. Каждый последующий push в main будет запускать публикацию. Ручной запуск: Actions → Deploy Telegram bot to Cloudflare Workers → Run workflow.

## 3. Добавить секреты Worker

После первого успешного deploy открой Cloudflare → Workers & Pages → zevnull-reg-ai-bot → Settings → Variables and Secrets. Добавь как Secrets:

- TELEGRAM_BOT_TOKEN — токен, который выдал BotFather для @zevnull_GptMyBot;
- TELEGRAM_WEBHOOK_SECRET — случайная строка 32–256 символов, только латиница, цифры, _ и -;
- REGCLOUD_API_KEY — API-ключ из панели REG.RU AI Models;
- ALLOWED_USER_IDS — твой числовой Telegram ID.

До заполнения ALLOWED_USER_IDS бот отвечает только на /id и не выполняет запросы к модели. Поэтому после первого deploy напиши боту /id, затем добавь полученное число в ALLOWED_USER_IDS. Можно указать несколько ID через запятую.

## 4. Зарегистрировать Telegram webhook

Открой PowerShell в клоне репозитория и запусти:

~~~powershell
.\scripts\set-webhook.ps1
~~~

URL созданного Worker: https://zevnull-reg-ai-bot.volt7459.workers.dev. Скрипт запросит этот URL, токен Telegram и значение TELEGRAM_WEBHOOK_SECRET из Worker Secrets. Ввод токена и секрета скрыт. Скрипт зарегистрирует адрес /telegram и покажет getWebhookInfo.

## 5. Проверка

- Открой https://<worker-url>/health — ожидается JSON со status=ok и database=true.
- Напиши боту /id и добавь ID в ALLOWED_USER_IDS.
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

Telegram Bot API позволяет скачивать файлы размером до 20 МБ, но в этом проекте установлен лимит 10 МБ. PDF ограничен 80 страницами, DOCX — 5 МБ, извлечённый текст — 30 000 символов. Сканированные PDF без текстового слоя и изображения пока не поддерживаются; OCR и vision не подключены.

На бесплатном Cloudflare Workers действует лимит CPU 10 мс на запрос. Разбор больших PDF/DOCX может превысить его даже при соблюдении ограничений размера. Для начала используй небольшие документы; если разбор регулярно упирается в лимит, можно перейти на тариф с большим CPU budget или перенести извлечение текста во внешний сервис.

## Безопасность

- Не коммить Telegram token, REG.RU API key, webhook secret или Cloudflare API token.
- Не отправляй секреты в чаты и issues.
- Вебхук проверяет X-Telegram-Bot-Api-Secret-Token.
- Все команды и диалоги доступны только ID из ALLOWED_USER_IDS.
- Диалоги и извлечённый текст файлов сохраняются в D1.
