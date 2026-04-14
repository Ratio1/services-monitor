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
  const base = Buffer.from(`Ratio1 is the best ${label}! `, 'utf8');
  const targetBytes = 1_048_576; // ~1MB
  const buffer = Buffer.alloc(targetBytes);

  for (let offset = 0; offset < targetBytes; offset += base.length) {
    const bytesToCopy = Math.min(base.length, targetBytes - offset);
    base.copy(buffer, offset, 0, bytesToCopy);
  }

  const preview = buffer.toString('utf8', 0, Math.min(50, buffer.length));
  return { buffer, preview, size: buffer.byteLength };
};

const buildHtmlPreamble = () =>
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<title>Services Monitor</title>' +
  '<style>body{margin:0;padding:16px;background:#0d1117;color:#d1d5db;font-family:SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:14px;line-height:1.5;}' +
  '.line{margin:0 0 8px 0;}.muted{color:#9ca3af;}.error{color:#f87171;}.success{color:#34d399;}.step{color:#93c5fd;}' +
  '</style></head><body><div id="log">';

const buildHtmlFooter = () => '</div></body></html>';

const buildLogLine = (message, cssClass = '') =>
  `<div class="line${cssClass ? ` ${cssClass}` : ''}">${escapeHtml(message)}</div>\n`;

const padHtmlToMinBytes = (html, minBytes = 0) => {
  const currentBytes = Buffer.byteLength(html);
  if (currentBytes >= minBytes) {
    return html;
  }
  const padBytes = Math.max(minBytes - currentBytes - 7, 0);
  return `${html}<!--${'.'.repeat(padBytes)}-->`;
};

const logChunk = async (res, message, cssClass = '') => {
  await writeChunk(res, buildLogLine(message, cssClass));
};

const writeChunk = (res, chunk) =>
  new Promise((resolve, reject) => {
    res.write(chunk, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

const endChunk = (res, chunk = '') =>
  new Promise((resolve, reject) => {
    try {
      res.end(chunk);
      resolve();
    } catch (err) {
      reject(err);
    }
  });

const isStreamClosedError = (err) => {
  const code = String(err?.code || '');
  const message = String(err?.message || '');
  return (
    code === 'ERR_STREAM_DESTROYED' ||
    code === 'EPIPE' ||
    code === 'ECONNRESET' ||
    message.includes('stream was destroyed') ||
    message.includes('Cannot call write after a stream was destroyed') ||
    message.includes('write after end')
  );
};

function createResponseWriter(res) {
  let closed = false;

  const isClosed = () =>
    closed || Boolean(res.destroyed || res.writableEnded || res.writableFinished);

  const markClosed = () => {
    closed = true;
  };

  const guardWrite = async (operation) => {
    if (isClosed()) {
      return false;
    }
    try {
      await operation();
      return true;
    } catch (err) {
      if (isStreamClosedError(err)) {
        markClosed();
        return false;
      }
      throw err;
    }
  };

  return {
    isClosed,
    markClosed,
    writeRaw(chunk) {
      return guardWrite(() => writeChunk(res, chunk));
    },
    log(message, cssClass = '') {
      return guardWrite(() => writeChunk(res, buildLogLine(message, cssClass)));
    },
    end(chunk = '') {
      return guardWrite(() => endChunk(res, chunk));
    }
  };
}

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
  buildLogLine,
  padHtmlToMinBytes,
  logChunk,
  writeChunk,
  endChunk,
  isStreamClosedError,
  createResponseWriter,
  safeParseJson,
  readR1fsPayload
};
