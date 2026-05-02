const crypto = require('crypto');
const { AppError, validationError } = require('../../utils/errors');
const { generateId } = require('../../utils/id');
const auditService = require('../audits/audit.service');
const authRepository = require('../auth/auth.repository');
const userRepository = require('../users/user.repository');
const securityRepository = require('./security.repository');

function notFound() {
  return new AppError(404, 'Resource not found.');
}

function formatFingerprint(hex) {
  return hex
    .toUpperCase()
    .match(/.{1,4}/g)
    .join(' ');
}

function buildFingerprint(identityKey) {
  const digest = crypto.createHash('sha256').update(String(identityKey)).digest('hex');
  return formatFingerprint(digest.slice(0, 60));
}

function buildSafetyFingerprint(ownIdentityKey, remoteIdentityKey) {
  const parts = [String(ownIdentityKey), String(remoteIdentityKey)].sort();
  const digest = crypto.createHash('sha256').update(parts.join('|')).digest('hex');
  return formatFingerprint(digest.slice(0, 60));
}

function deriveDeviceName(session) {
  if (session && session.userAgent && String(session.userAgent).trim()) {
    const raw = String(session.userAgent).trim();
    return raw.slice(0, 120);
  }

  return 'Unknown device';
}

function validateKeysPayload(body) {
  const keys = body && body.keys;
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
    throw validationError({ keys: "can't be blank" });
  }

  const errors = {};

  if (!keys.identityKey || typeof keys.identityKey !== 'string' || !keys.identityKey.trim()) {
    errors.identityKey = ["can't be blank"];
  }

  if (!keys.signedPreKey || typeof keys.signedPreKey !== 'object' || Array.isArray(keys.signedPreKey)) {
    errors.signedPreKey = ["can't be blank"];
  } else {
    if (!Number.isInteger(Number(keys.signedPreKey.keyId))) {
      errors.signedPreKey = ['is invalid'];
    }
    if (typeof keys.signedPreKey.publicKey !== 'string' || !keys.signedPreKey.publicKey.trim()) {
      errors.signedPreKey = ['is invalid'];
    }
    if (typeof keys.signedPreKey.signature !== 'string' || !keys.signedPreKey.signature.trim()) {
      errors.signedPreKey = ['is invalid'];
    }
  }

  if (!Array.isArray(keys.oneTimePreKeys) || keys.oneTimePreKeys.length === 0) {
    errors.oneTimePreKeys = ["can't be blank"];
  } else {
    for (const item of keys.oneTimePreKeys) {
      if (!item || typeof item !== 'object' || !Number.isInteger(Number(item.keyId)) || typeof item.publicKey !== 'string' || !item.publicKey.trim()) {
        errors.oneTimePreKeys = ['is invalid'];
        break;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  return {
    identityKey: keys.identityKey.trim(),
    signedPreKey: {
      keyId: Number(keys.signedPreKey.keyId),
      publicKey: keys.signedPreKey.publicKey.trim(),
      signature: keys.signedPreKey.signature.trim(),
    },
    oneTimePreKeys: keys.oneTimePreKeys.map((item) => ({
      keyId: Number(item.keyId),
      publicKey: item.publicKey.trim(),
    })),
  };
}

async function uploadPreKeyBundle(body, auth, req) {
  const payload = validateKeysPayload(body);
  const identityKeyFingerprint = buildFingerprint(payload.identityKey);

  const device = await securityRepository.ensureDevice({
    id: generateId('dev'),
    userId: auth.user.id,
    sessionId: auth.session.id,
    name: deriveDeviceName(auth.session),
    identityKeyFingerprint,
  });

  await securityRepository.upsertKeyBundle({
    id: generateId('ukb'),
    userId: auth.user.id,
    deviceId: device.id,
    identityKey: payload.identityKey,
    signedPreKey: payload.signedPreKey,
    oneTimePreKeys: payload.oneTimePreKeys,
  });

  await auditService.logAction({
    req,
    userId: auth.user.id,
    action: 'keys.uploaded',
    entityType: 'device',
    entityId: device.id,
    statusCode: 201,
    metadata: { oneTimePreKeyCount: payload.oneTimePreKeys.length },
  });
}

async function getUserPreKeyBundle(userId, query, auth, req) {
  const user = await userRepository.findActiveUserById(userId);
  if (!user) throw notFound();

  const deviceId = query && query.deviceId ? String(query.deviceId).trim() : null;
  const bundle = await securityRepository.findKeyBundleForUser(userId, deviceId);
  if (!bundle) throw notFound();

  const consumedResult = await securityRepository.consumeKeyBundleOneTimeKey(bundle.id);
  if (!consumedResult) throw notFound();

  await auditService.logAction({
    req,
    userId: auth.user.id,
    action: 'keys.bundle_viewed',
    entityType: 'user',
    entityId: userId,
    statusCode: 200,
    metadata: { deviceId: bundle.deviceId, consumedOneTimeKey: Boolean(consumedResult.consumed) },
  });

  return {
    keys: {
      identityKey: bundle.identityKey,
      signedPreKey: bundle.signedPreKey,
      oneTimePreKey: consumedResult.consumed,
    },
    deviceId: bundle.deviceId,
  };
}

async function listCurrentUserDevices(auth, req) {
  await securityRepository.ensureDevice({
    id: generateId('dev'),
    userId: auth.user.id,
    sessionId: auth.session.id,
    name: deriveDeviceName(auth.session),
  });

  const rows = await securityRepository.listDevicesByUser(auth.user.id);
  const devices = rows.map((row) => securityRepository.mapDevice(row, auth.session.id));

  await auditService.logAction({
    req,
    userId: auth.user.id,
    action: 'devices.listed',
    entityType: 'user',
    entityId: auth.user.id,
    statusCode: 200,
    metadata: { count: devices.length },
  });

  return { devices };
}

async function removeCurrentUserDevice(deviceId, auth, req) {
  const device = await securityRepository.findDeviceByIdForUser(deviceId, auth.user.id);
  if (!device) throw notFound();

  await securityRepository.softDeleteDevice(deviceId, auth.user.id);

  if (device.session_id) {
    await authRepository.revokeUserSession(device.session_id, auth.user.id);
  }

  await auditService.logAction({
    req,
    userId: auth.user.id,
    action: 'devices.removed',
    entityType: 'device',
    entityId: deviceId,
    statusCode: 204,
  });
}

async function getUserKeyFingerprint(userId, auth, req) {
  const user = await userRepository.findActiveUserById(userId);
  if (!user) throw notFound();

  const remoteBundles = await securityRepository.listBundlesByUser(userId);

  if (remoteBundles.length === 0) {
    throw notFound();
  }

  const ownBundles = auth.user.id === userId ? remoteBundles : await securityRepository.listBundlesByUser(auth.user.id);

  const fingerprint = ownBundles.length > 0
    ? buildSafetyFingerprint(ownBundles[0].identityKey, remoteBundles[0].identityKey)
    : buildFingerprint(remoteBundles[0].identityKey);

  await auditService.logAction({
    req,
    userId: auth.user.id,
    action: 'keys.fingerprint_viewed',
    entityType: 'user',
    entityId: userId,
    statusCode: 200,
  });

  return {
    userId,
    fingerprint,
  };
}

module.exports = {
  uploadPreKeyBundle,
  getUserPreKeyBundle,
  listCurrentUserDevices,
  removeCurrentUserDevice,
  getUserKeyFingerprint,
};
