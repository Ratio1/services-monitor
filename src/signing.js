const { createPasswordHasher } = require('@ratio1/cstore-auth-ts');

let hasher = null;
try {
  hasher = createPasswordHasher({ logger: console });
} catch (err) {
  console.warn('[services-monitor] password hasher unavailable; signatures disabled', err?.message);
}

async function maybeSign(config, input) {
  if (!hasher) return null;
  try {
    const record = await hasher.hashPassword(input, config.pepper);
    return `${record.algo}:${record.hash}`;
  } catch (err) {
    console.warn('[services-monitor] unable to derive signature', err?.message);
    hasher = null;
    return null;
  }
}

module.exports = { maybeSign };
