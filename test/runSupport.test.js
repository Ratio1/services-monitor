const test = require('node:test');
const assert = require('node:assert/strict');

const { uploadBufferToR1fs } = require('../src/runSupport');

test('uploadBufferToR1fs uploads buffers through addFile', async () => {
  let seenPayload = null;

  const result = await uploadBufferToR1fs({
    sdk: {
      r1fs: {
        addFile: async (payload) => {
          seenPayload = payload;
          return { cid: 'cid-1' };
        }
      }
    },
    buffer: Buffer.from('abc'),
    filename: 'test.txt'
  });

  assert.equal(result.cid, 'cid-1');
  assert.equal(seenPayload.filename, 'test.txt');
  assert.equal(Buffer.isBuffer(seenPayload.file), true);
  assert.equal(seenPayload.file.toString('utf8'), 'abc');
});

test('uploadBufferToR1fs retries once after a transport-level fetch failure', async () => {
  let calls = 0;

  const result = await uploadBufferToR1fs({
    sdk: {
      r1fs: {
        addFile: async () => {
          calls += 1;
          if (calls === 1) {
            const err = new TypeError('fetch failed');
            err.cause = new Error('write EPIPE');
            throw err;
          }
          return { cid: 'cid-retry' };
        }
      }
    },
    buffer: Buffer.from('retry'),
    filename: 'retry.txt'
  });

  assert.equal(result.cid, 'cid-retry');
  assert.equal(calls, 2);
});

test('uploadBufferToR1fs retries once when EPIPE is present in the top-level error message', async () => {
  let calls = 0;

  const result = await uploadBufferToR1fs({
    sdk: {
      r1fs: {
        addFile: async () => {
          calls += 1;
          if (calls === 1) {
            throw new Error('request to http://172.17.0.2:31235/add_file failed, reason: write EPIPE');
          }
          return { cid: 'cid-epipe' };
        }
      }
    },
    buffer: Buffer.from('retry'),
    filename: 'retry.txt'
  });

  assert.equal(result.cid, 'cid-epipe');
  assert.equal(calls, 2);
});

test('uploadBufferToR1fs retries once when the transport resets with socket hang up', async () => {
  let calls = 0;

  const result = await uploadBufferToR1fs({
    sdk: {
      r1fs: {
        addFile: async () => {
          calls += 1;
          if (calls === 1) {
            const err = new Error(
              'request to http://172.17.0.2:31235/add_file failed, reason: socket hang up'
            );
            err.code = 'ECONNRESET';
            throw err;
          }
          return { cid: 'cid-reset' };
        }
      }
    },
    buffer: Buffer.from('retry'),
    filename: 'retry.txt'
  });

  assert.equal(result.cid, 'cid-reset');
  assert.equal(calls, 2);
});

test('uploadBufferToR1fs does not retry non-transport errors', async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      uploadBufferToR1fs({
        sdk: {
          r1fs: {
            addFile: async () => {
              calls += 1;
              throw new Error('Request failed with status 400');
            }
          }
        },
        buffer: Buffer.from('fail'),
        filename: 'fail.txt'
      }),
    /Request failed with status 400/
  );

  assert.equal(calls, 1);
});
