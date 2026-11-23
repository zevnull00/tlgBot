import { answerCallback, downloadTelegramFile, sendText, sendTyping } from './telegram.js';
import { createCompletion, getModels } from './regcloud.js';
import { extractDocumentText, FILE_LIMIT_BYTES } from './files.js';

const MENU = { inline_keyboard: [
  [{ text: '🤖 Выбрать модель', callback_data: 'models:0' }, { text: '💳 Баланс / расходы', callback_data: 'usage' }],
  [{ text: '🆕 Новый диалог', callback_data: 'new' }, { text: '🗂 История', callback_data: 'history:0' }],
  [{ text: '📎 Файлы', callback_data: 'filehelp' }]
] };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const userId = id => String(id);
const allowed = (env, id) => String(env.ALLOWED_USER_IDS || '').split(',').map(x => x.trim()).filter(Boolean).includes(userId(id));
function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a || '')), y = new TextEncoder().encode(String(b || ''));
  if (x.length !== y.length) return false;
  let diff = 0; for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function getUser(env, id) {
  await env.DB.prepare('INSERT OR IGNORE INTO users (telegram_user_id) VALUES (?)').bind(userId(id)).run();
  return env.DB.prepare('SELECT * FROM users WHERE telegram_user_id = ?').bind(userId(id)).first();
}
async function createChat(env, user) {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO conversations (id, telegram_user_id, title, model_id) VALUES (?, ?, ?, ?)')
    .bind(id, user.telegram_user_id, 'Новый диалог', user.selected_model || null).run();
  await env.DB.prepare('UPDATE users SET active_conversation_id = ? WHERE telegram_user_id = ?')
    .bind(id, user.telegram_user_id).run();
}
async function activeChat(env, user) {
  if (user.active_conversation_id) {
    const chat = await env.DB.prepare('SELECT * FROM conversations WHERE id = ? AND telegram_user_id = ?')
      .bind(user.active_conversation_id, user.telegram_user_id).first();
    if (chat) return chat;
  }
  await createChat(env, user);
  return env.DB.prepare('SELECT * FROM conversations WHERE id = (SELECT active_conversation_id FROM users WHERE telegram_user_id = ?)')
    .bind(user.telegram_user_id).first();
}
async function sendMenu(env, chat, user) {
  await sendText(env.TELEGRAM_BOT_TOKEN, chat,
    'Привет! Я REG.AI — бот для работы с моделями REG.RU AI.\n\nТекущая модель: ' + (user.selected_model || 'не выбрана') +
    '\n\nНапиши сообщение, чтобы начать диалог. Настройки — в меню ниже.', { reply_markup: MENU });
}
async function showModels(env, chat, page = 0) {
  const models = await getModels(env.REGCLOUD_API_KEY), size = 8;
  const pages = Math.max(1, Math.ceil(models.length / size)), p = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const start = p * size;
  const rows = models.slice(start, start + size).map((m, i) => [{ text: String(m.name || m.id).slice(0, 60), callback_data: 'model:' + (start + i) }]);
  const nav = [];
  if (p > 0) nav.push({ text: '⬅️', callback_data: 'models:' + (p - 1) });
  if (p < pages - 1) nav.push({ text: '➡️', callback_data: 'models:' + (p + 1) });
  if (nav.length) rows.push(nav);
  rows.push([{ text: '↩️ Меню', callback_data: 'menu' }]);
  await sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Доступные модели REG.RU · страница ' + (p + 1) + '/' + pages, { reply_markup: { inline_keyboard: rows } });
}
async function showUsage(env, chat, user) {
  const input = Number(user.prompt_tokens || 0), output = Number(user.completion_tokens || 0);
  const text = '💳 Статистика бота\n\nЗапросов: ' + Number(user.request_count || 0) +
    '\nВходящие токены: ' + input + '\nИсходящие токены: ' + output + '\nВсего токенов: ' + (input + output) +
    '\n\nЭто статистика запросов бота, а не денежный остаток. Публичный API REG.RU не документирует метод чтения текущего баланса.';
  await sendText(env.TELEGRAM_BOT_TOKEN, chat, text, { reply_markup: { inline_keyboard: [
    [{ text: 'Открыть REG.RU AI Models', url: 'https://cloud.reg.ru/panel/ai-models' }],
    [{ text: '↩️ Меню', callback_data: 'menu' }]
  ] } });
}
async function showHistory(env, chat, user, page = 0) {
  const size = 8, offset = Math.max(0, Number(page) || 0) * size;
  const result = await env.DB.prepare('SELECT id, title FROM conversations WHERE telegram_user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?')
    .bind(user.telegram_user_id, size + 1, offset).all();
  const rows = (result.results || []).slice(0, size).map(c => [{ text: (c.id === user.active_conversation_id ? '✅ ' : '') + String(c.title || 'Диалог').slice(0, 45), callback_data: 'open:' + c.id }]);
  if ((result.results || []).length > size) rows.push([{ text: 'Следующие ➡️', callback_data: 'history:' + (Number(page) + 1) }]);
  if (page > 0) rows.push([{ text: '⬅️ Назад', callback_data: 'history:' + (Number(page) - 1) }]);
  rows.push([{ text: '↩️ Меню', callback_data: 'menu' }]);
  await sendText(env.TELEGRAM_BOT_TOKEN, chat, rows.length > 1 ? 'Твои диалоги — выбери, чтобы продолжить:' : 'Пока нет сохранённых диалогов.', { reply_markup: { inline_keyboard: rows } });
}
async function handleCallback(env, cb) {
  const chat = cb.message && cb.message.chat && cb.message.chat.id, id = cb.from && cb.from.id;
  await answerCallback(env.TELEGRAM_BOT_TOKEN, cb.id, allowed(env, id) ? '' : 'Нет доступа');
  if (!chat || !allowed(env, id)) return;
  const user = await getUser(env, id), data = String(cb.data || '');
  if (data === 'menu') return sendMenu(env, chat, user);
  if (data === 'usage') return showUsage(env, chat, user);
  if (data === 'new') { await createChat(env, user); return sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Создал новый диалог. Пиши сообщение.', { reply_markup: MENU }); }
  if (data === 'filehelp') return sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Прикрепи документ к сообщению. Поддерживаются PDF с текстовым слоем, DOCX, TXT, Markdown, CSV, JSON и файлы исходного кода. Лимит: 10 МБ; PDF — до 80 страниц; извлечённый текст — до 30 000 символов. Сканированные PDF без OCR не распознаются.', { reply_markup: MENU });
  if (data.startsWith('models:')) return showModels(env, chat, Number(data.split(':')[1]));
  if (data.startsWith('model:')) {
    const model = (await getModels(env.REGCLOUD_API_KEY))[Number(data.split(':')[1])];
    if (!model) return sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Модель не найдена. Открой список ещё раз.');
    await env.DB.prepare('UPDATE users SET selected_model = ? WHERE telegram_user_id = ?').bind(model.id, user.telegram_user_id).run();
    if (user.active_conversation_id) await env.DB.prepare('UPDATE conversations SET model_id = ? WHERE id = ? AND telegram_user_id = ?')
      .bind(model.id, user.active_conversation_id, user.telegram_user_id).run();
    return sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Выбрана модель:\n' + model.id, { reply_markup: MENU });
  }
  if (data.startsWith('history:')) return showHistory(env, chat, user, Number(data.split(':')[1]));
  if (data.startsWith('open:')) {
    const idToOpen = data.slice(5);
    const c = await env.DB.prepare('SELECT * FROM conversations WHERE id = ? AND telegram_user_id = ?').bind(idToOpen, user.telegram_user_id).first();
    if (!c) return sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Диалог не найден.');
    await env.DB.prepare('UPDATE users SET active_conversation_id = ? WHERE telegram_user_id = ?').bind(idToOpen, user.telegram_user_id).run();
    return sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Продолжаем «' + c.title + '». Модель: ' + (c.model_id || user.selected_model || 'не выбрана') + '.', { reply_markup: MENU });
  }
}
async function getMessageContent(env, msg) {
  let text = String(msg.text || msg.caption || '').trim();
  if (msg.document) {
    const file = await downloadTelegramFile(env.TELEGRAM_BOT_TOKEN, msg.document.file_id, FILE_LIMIT_BYTES);
    const doc = await extractDocumentText(msg.document.file_name || 'file', msg.document.mime_type, file.bytes);
    text += '\n\n[Файл: ' + (msg.document.file_name || 'без имени') + '; ' + doc.details + ']\n' + doc.text;
  }
  if (msg.photo && msg.photo.length) throw new Error('Изображения пока не поддерживаются. Отправь документ или текстовый файл.');
  return text.trim();
}
async function replyToUser(env, user, chat, msg) {
  const content = await getMessageContent(env, msg);
  if (!content) return;
  if (!user.selected_model) return sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Сначала выбери модель в меню «Выбрать модель».', { reply_markup: MENU });
  const conversation = await activeChat(env, user);
  await sendTyping(env.TELEGRAM_BOT_TOKEN, chat);
  await env.DB.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').bind(conversation.id, 'user', content).run();
  const result = await env.DB.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 24').bind(conversation.id).all();
  const messages = [];
  if (user.system_prompt) messages.push({ role: 'system', content: user.system_prompt });
  for (const row of (result.results || []).reverse()) messages.push({ role: row.role, content: row.content });
  try {
    const answer = await createCompletion(env.REGCLOUD_API_KEY, { model: conversation.model_id || user.selected_model, messages });
    await env.DB.prepare('INSERT INTO messages (conversation_id, role, content, prompt_tokens, completion_tokens) VALUES (?, ?, ?, ?, ?)')
      .bind(conversation.id, 'assistant', answer.answer, answer.usage.promptTokens, answer.usage.completionTokens).run();
    await env.DB.prepare('UPDATE users SET prompt_tokens = prompt_tokens + ?, completion_tokens = completion_tokens + ?, request_count = request_count + 1 WHERE telegram_user_id = ?')
      .bind(answer.usage.promptTokens, answer.usage.completionTokens, user.telegram_user_id).run();
    const title = content.replace(/\s+/g, ' ').slice(0, 64) || 'Новый диалог';
    await env.DB.prepare('UPDATE conversations SET title = CASE WHEN title = ? THEN ? ELSE title END, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind('Новый диалог', title, conversation.id).run();
    return sendText(env.TELEGRAM_BOT_TOKEN, chat, answer.answer + '\n\n— ' + (conversation.model_id || user.selected_model) +
      '\nТокены: ' + answer.usage.promptTokens + ' / ' + answer.usage.completionTokens, { reply_markup: MENU });
  } catch (error) {
    console.error('REG.RU error:', error && error.message);
    return sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Ошибка REG.RU: ' + String(error && error.message || error).slice(0, 600) + '\n\nСообщение оставлено в истории.', { reply_markup: MENU });
  }
}
async function handleMessage(env, msg) {
  const chat = msg.chat && msg.chat.id, id = msg.from && msg.from.id;
  if (!chat || !id || !msg.chat || msg.chat.type !== 'private') return;
  const raw = String(msg.text || '').trim(), command = raw.match(/^\/(\w+)/);
  const cmd = command ? command[1].toLowerCase() : '';
  if (cmd === 'id') return sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Твой Telegram ID: ' + id + '\n\nДобавь его в Worker Secret ALLOWED_USER_IDS.');
  if (!allowed(env, id)) return sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Нет доступа. Сначала /id, затем добавь свой ID в ALLOWED_USER_IDS в Cloudflare.');
  const user = await getUser(env, id);
  if (['start', 'menu', 'help'].includes(cmd)) return sendMenu(env, chat, user);
  if (cmd === 'new') { await createChat(env, user); return sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Новый диалог создан.', { reply_markup: MENU }); }
  if (cmd === 'models' || cmd === 'model') return showModels(env, chat);
  if (cmd === 'usage' || cmd === 'balance') return showUsage(env, chat, user);
  if (cmd === 'history') return showHistory(env, chat, user);
  if (cmd === 'prompt') {
    const prompt = raw.replace(/^\/prompt\s*/i, '').trim();
    if (!prompt) return sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Задать системную инструкцию: /prompt текст\nСбросить: /resetprompt\n\nСейчас: ' + (user.system_prompt || '(не задана)'));
    if (prompt.length > 3000) return sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Максимальная длина инструкции — 3000 символов.');
    await env.DB.prepare('UPDATE users SET system_prompt = ? WHERE telegram_user_id = ?').bind(prompt, user.telegram_user_id).run();
    return sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Системная инструкция сохранена.');
  }
  if (cmd === 'resetprompt') {
    await env.DB.prepare("UPDATE users SET system_prompt = '' WHERE telegram_user_id = ?").bind(user.telegram_user_id).run();
    return sendText(env.TELEGRAM_BOT_TOKEN, chat, 'Системная инструкция сброшена.');
  }
  return replyToUser(env, user, chat, msg);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') return json({ service: 'REG.RU AI Telegram Bot', status: 'ok' });
    if (request.method === 'GET' && url.pathname === '/health') {
      try { await env.DB.prepare('SELECT 1').first(); return json({ status: 'ok', database: true }); }
      catch { return json({ status: 'error', database: false }, 503); }
    }
    if (request.method !== 'POST' || url.pathname !== '/telegram') return json({ error: 'Not found' }, 404);
    const supplied = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(supplied, env.TELEGRAM_WEBHOOK_SECRET)) return json({ error: 'Forbidden' }, 403);
    if (!env.TELEGRAM_BOT_TOKEN || !env.REGCLOUD_API_KEY || !env.DB) return json({ error: 'Worker not configured' }, 503);
    let update;
    try { update = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!Number.isInteger(update && update.update_id)) return json({ error: 'Invalid update' }, 400);
    try {
      const claim = await env.DB.prepare('INSERT OR IGNORE INTO processed_updates (update_id) VALUES (?)').bind(update.update_id).run();
      if (!Number(claim.meta && claim.meta.changes || 0)) return json({ ok: true, duplicate: true });
      if (update.callback_query) await handleCallback(env, update.callback_query);
      else if (update.message) await handleMessage(env, update.message);
      return json({ ok: true });
    } catch (error) {
      console.error('Webhook error:', error && error.stack || error);
      await env.DB.prepare('DELETE FROM processed_updates WHERE update_id = ?').bind(update.update_id).run().catch(() => {});
      return json({ error: 'Update failed' }, 500);
    }
  }
};