const API_BASE = 'https://api.telegram.org';

export async function telegramCall(token, method, payload = {}) {
  const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Telegram вернул некорректный ответ (${response.status}).`);
  }

  if (!response.ok || !data.ok) {
    const description = String(data?.description || `HTTP ${response.status}`).slice(0, 300);
    throw new Error(`Telegram API: ${description}`);
  }
  return data.result;
}

function splitText(text, limit = 3900) {
  const chunks = [];
  let rest = String(text ?? '');
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.55) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.55) cut = limit;
    // Avoid cutting a UTF-16 surrogate pair in half.
    if (cut > 0 && /[\uD800-\uDBFF]/.test(rest[cut - 1])) cut -= 1;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest || chunks.length === 0) chunks.push(rest);
  return chunks;
}

export async function sendText(token, chatId, text, extra = {}) {
  const chunks = splitText(text);
  let result;
  for (let i = 0; i < chunks.length; i += 1) {
    result = await telegramCall(token, 'sendMessage', {
      chat_id: chatId,
      text: chunks[i],
      disable_web_page_preview: true,
      ...(i === chunks.length - 1 ? extra : {}),
    });
  }
  return result;
}

export async function sendTyping(token, chatId) {
  return telegramCall(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
}

export async function answerCallback(token, callbackQueryId, text) {
  return telegramCall(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text: String(text).slice(0, 180) } : {}),
  });
}

export async function downloadTelegramFile(token, fileId, maxBytes) {
  const file = await telegramCall(token, 'getFile', { file_id: fileId });
  if (!file?.file_path) throw new Error('Telegram не вернул путь к файлу.');
  if (Number(file.file_size || 0) > maxBytes) {
    throw new Error(`Файл превышает лимит ${Math.floor(maxBytes / 1024 / 1024)} МБ.`);
  }

  const response = await fetch(`${API_BASE}/file/bot${token}/${file.file_path}`);
  if (!response.ok) throw new Error(`Не удалось скачать файл из Telegram (${response.status}).`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Файл превышает лимит ${Math.floor(maxBytes / 1024 / 1024)} МБ.`);
  }
  return { bytes: new Uint8Array(buffer), file };
}
