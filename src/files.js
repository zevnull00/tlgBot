import { extractText, getDocumentProxy } from 'unpdf';
import { unzipSync } from 'fflate';

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 30_000;
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml',
  'xml', 'html', 'htm', 'log', 'ini', 'cfg', 'conf', 'toml', 'env.example',
  'c', 'h', 'cpp', 'hpp', 'cc', 'hh', 'py', 'js', 'mjs', 'cjs', 'ts', 'tsx',
  'jsx', 'java', 'kt', 'rs', 'go', 'php', 'sql', 'sh', 'bash', 'ps1', 'bat',
  'cmake', 'make', 'mk', 's', 'asm', 'ino', 'dart', 'swift', 'rb', 'lua', 'css',
  'scss', 'less', 'vue', 'svelte', 'gradle', 'properties', 'gitignore', 'dockerfile',
]);

function extensionOf(name) {
  const lower = String(name || '').toLowerCase();
  const base = lower.split(/[\\/]/).pop() || '';
  if (base === 'dockerfile') return 'dockerfile';
  if (base === '.gitignore') return 'gitignore';
  const index = base.lastIndexOf('.');
  return index >= 0 ? base.slice(index + 1) : '';
}

function xmlText(xml) {
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    throw new Error('Файл не похож на UTF-8 текст. Для бинарных форматов поддерживаются PDF и DOCX.');
  }
}

export async function extractDocumentText(fileName, mimeType, bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('Файл слишком большой. Максимальный размер для обработки — 10 МБ.');
  }

  const ext = extensionOf(fileName);
  let text;
  let details = '';

  if (ext === 'pdf' || mimeType === 'application/pdf') {
    const pdf = await getDocumentProxy(bytes, {
      isEvalSupported: false,
      maxImageSize: 4_000_000,
    });
    if (pdf.numPages > 80) {
      throw new Error('В PDF больше 80 страниц. Раздели документ на части.');
    }
    const result = await extractText(pdf, { mergePages: true });
    text = result.text;
    details = `PDF, страниц: ${result.totalPages}`;
    if (!String(text).trim()) {
      throw new Error('В PDF не найден текстовый слой. Похоже, это скан; OCR пока не подключён.');
    }
  } else if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    if (bytes.byteLength > 5 * 1024 * 1024) {
      throw new Error('DOCX больше 5 МБ. Для этого формата установлен отдельный лимит.');
    }
    const archive = unzipSync(bytes);
    const documentXml = archive['word/document.xml'];
    if (!documentXml) throw new Error('В DOCX не найден word/document.xml.');
    text = xmlText(decodeText(documentXml));
    details = 'DOCX';
  } else if (TEXT_EXTENSIONS.has(ext) || mimeType?.startsWith('text/')) {
    text = decodeText(bytes);
    details = ext ? ext.toUpperCase() : 'текстовый файл';
  } else {
    throw new Error(
      `Формат .${ext || 'без расширения'} пока не поддерживается. Поддерживаются PDF, DOCX, TXT, Markdown, CSV, JSON и распространённые файлы исходного кода.`,
    );
  }

  text = String(text || '').replace(/\u0000/g, '').trim();
  if (!text) throw new Error('В файле не удалось найти текст.');

  const truncated = text.length > MAX_EXTRACTED_CHARS;
  if (truncated) text = `${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[Текст обрезан: достигнут лимит ${MAX_EXTRACTED_CHARS} символов.]`;

  return { text, details, truncated, originalChars: String(text).length };
}

export const FILE_LIMIT_BYTES = MAX_DOWNLOAD_BYTES;
