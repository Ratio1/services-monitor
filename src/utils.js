const crypto = require('crypto');

const escapeHtml = (input) =>
  String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatMs = (ms) => `${(ms / 1000).toFixed(2)}s`;

const shortId = () => crypto.randomBytes(4).toString('hex');

const createTestFile = (label) => {
  const base = `Ratio1 is the best ${label}! `;
  const targetBytes = 1_048_576; // ~1MB
  let content = '';
  while (Buffer.byteLength(content) < targetBytes) {
    content += base;
  }
  const buffer = Buffer.from(content);
  const preview = buffer.toString('utf8', 0, Math.min(50, buffer.length));
  return { buffer, preview, size: buffer.byteLength };
};

const buildHtmlPreamble = () =>
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<title>Services Monitor</title>' +
  '<style>body{margin:0;padding:16px;background:#0d1117;color:#d1d5db;font-family:SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:14px;line-height:1.5;}' +
  '.line{margin:0 0 8px 0;}.muted{color:#9ca3af;}.error{color:#f87171;}.success{color:#34d399;}.step{color:#93c5fd;}.payload{display:none;white-space:pre-wrap;word-break:break-word;}' +
  '</style></head><body><div id="log">';

const buildHtmlFooter = () => '</div></body></html>';

const logChunk = async (res, message, cssClass = '') => {
  const line = `<div class="line${cssClass ? ` ${cssClass}` : ''}">${escapeHtml(message)}</div>\n`;
  await writeChunk(res, line);
};

const writeChunk = (res, chunk) =>
  new Promise((resolve, reject) => {
    res.write(chunk, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

const safeParseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const readR1fsPayload = async (result) => {
  const streamStart = Date.now();
  if (result && typeof result.arrayBuffer === 'function') {
    const buf = Buffer.from(await result.arrayBuffer());
    return { buffer: buf, streamMs: Date.now() - streamStart };
  }
  if (result && typeof result.file_base64_str === 'string') {
    const buf = Buffer.from(result.file_base64_str, 'base64');
    return { buffer: buf, streamMs: Date.now() - streamStart };
  }
  if (result && typeof result.file_data !== 'undefined') {
    const serialized =
      typeof result.file_data === 'string' ? result.file_data : JSON.stringify(result.file_data);
    const buf = Buffer.from(serialized);
    return { buffer: buf, streamMs: Date.now() - streamStart };
  }
  if (result && typeof result.file_path === 'string') {
    const buf = Buffer.from(result.file_path);
    return { buffer: buf, streamMs: Date.now() - streamStart };
  }
  throw new Error('Unexpected R1FS response shape');
};

module.exports = {
  escapeHtml,
  sleep,
  formatMs,
  shortId,
  createTestFile,
  buildHtmlPreamble,
  buildHtmlFooter,
  logChunk,
  writeChunk,
  safeParseJson,
  readR1fsPayload
};
