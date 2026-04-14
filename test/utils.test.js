const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestFile } = require('../src/utils');

test('createTestFile returns an exact 1 MiB buffer with a preview derived from that buffer', () => {
  const { buffer, preview, size } = createTestFile('bench');

  assert.equal(Buffer.isBuffer(buffer), true);
  assert.equal(size, 1_048_576);
  assert.equal(buffer.length, 1_048_576);
  assert.equal(preview, buffer.toString('utf8', 0, Math.min(50, buffer.length)));
  assert.match(preview, /^Ratio1 is the best bench!/);
});
