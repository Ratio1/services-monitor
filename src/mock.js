const { randomUUID } = require('crypto');
const { createTestFile } = require('./utils');

function createMockSdk(hostAddr, peers) {
  const files = new Map();
  const hsets = new Map();

  const cstore = {
    async hset({ hkey, key, value }) {
      const bucket = ensureBucket(hsets, hkey);
      bucket.set(key, String(value));
      return true;
    },
    async hget({ hkey, key }) {
      const bucket = hsets.get(hkey);
      if (!bucket) return null;
      return bucket.get(key) ?? null;
    },
    async hgetall({ hkey }) {
      const bucket = hsets.get(hkey);
      if (!bucket) return {};
      const obj = {};
      for (const [k, v] of bucket.entries()) obj[k] = v;
      return obj;
    }
  };

  const r1fs = {
    async addFile({ file, filename }) {
      const buffer = Buffer.isBuffer(file) ? file : Buffer.from(String(file));
      const cid = `mock-${randomUUID()}`;
      files.set(cid, buffer);
      return { cid, message: `stored ${filename || cid}` };
    },
    async getFileFull({ cid }) {
      if (!files.has(cid)) throw new Error(`CID not found: ${cid}`);
      const buffer = files.get(cid);
      return {
        result: {
          async arrayBuffer() {
            return buffer;
          }
        }
      };
    },
    async deleteFiles() {
      return { success: Array.from(files.keys()), failed: [], total: files.size };
    }
  };

  return { cstore, r1fs, _mock: { files, hsets, hostAddr, peers } };
}

function seedReverseFiles(mockSdk, runId, peers) {
  for (const peer of peers) {
    const { buffer, preview } = createTestFile(peer);
    mockSdk.r1fs
      .addFile({ file: buffer, filename: `reverse-${peer}-${runId}.txt` })
      .then((res) => {
        return mockSdk.cstore.hset({
          hkey: 'services-monitor',
          key: `reverse:${runId}:${peer}`,
          value: JSON.stringify({
            runId,
            peer,
            initiator: 'initiator-local',
            fileCid: res.cid,
            uploadedAt: Date.now(),
            uploadMs: 5,
            preview,
            peerSignature: null
          })
        });
      })
      .catch(() => {});
  }
}

function ensureBucket(store, hkey) {
  if (!store.has(hkey)) store.set(hkey, new Map());
  return store.get(hkey);
}

module.exports = { createMockSdk, seedReverseFiles };
