const BASE_URL = 'https://ai.reg.cloud/v1';

async function apiRequest(apiKey, path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`REG.RU вернул некорректный ответ (${response.status}).`);
  }

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || `HTTP ${response.status}`;
    throw new Error(String(detail).slice(0, 400));
  }
  return data;
}

export async function getModels(apiKey) {
  const data = await apiRequest(apiKey, '/models', { method: 'GET' });
  if (!Array.isArray(data?.data)) throw new Error('REG.RU вернул неожиданный список моделей.');
  return data.data
    .filter((item) => item && typeof item.id === 'string' && item.id.length > 0)
    .map((item) => ({ id: item.id, name: item.name || item.id }));
}

export async function createCompletion(apiKey, { model, messages, maxTokens = 2500, temperature = 0.6 }) {
  const data = await apiRequest(apiKey, '/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    }),
  });

  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  let answer = '';
  if (typeof content === 'string') {
    answer = content;
  } else if (Array.isArray(content)) {
    answer = content.map((part) => part?.text || '').join('\n');
  }
  if (!answer.trim()) throw new Error('Модель вернула пустой ответ.');

  return {
    answer: answer.trim(),
    usage: {
      promptTokens: Number(data?.usage?.prompt_tokens || 0),
      completionTokens: Number(data?.usage?.completion_tokens || 0),
      totalTokens: Number(data?.usage?.total_tokens || 0),
    },
  };
}
