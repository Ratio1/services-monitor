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
