const test = require('node:test');
const assert = require('node:assert/strict');

const { uploadBufferToR1fs } = require('../src/runSupport');

test('uploadBufferToR1fs uploads buffers through addFileBase64', async () => {
  let seenPayload = null;

  const result = await uploadBufferToR1fs({
    sdk: {
      r1fs: {
        addFileBase64: async (payload) => {
          seenPayload = payload;
          return { cid: 'cid-1' };
        }
      }
    },
    buffer: Buffer.from('abc'),
    filename: 'test.txt'
  });

  assert.equal(result.cid, 'cid-1');
  assert.deepEqual(seenPayload, {
    file_base64_str: Buffer.from('abc').toString('base64'),
    filename: 'test.txt'
  });
});

test('uploadBufferToR1fs retries once after a transport-level fetch failure', async () => {
  let calls = 0;

  const result = await uploadBufferToR1fs({
    sdk: {
      r1fs: {
        addFileBase64: async () => {
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

test('uploadBufferToR1fs does not retry non-transport errors', async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      uploadBufferToR1fs({
        sdk: {
          r1fs: {
            addFileBase64: async () => {
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
