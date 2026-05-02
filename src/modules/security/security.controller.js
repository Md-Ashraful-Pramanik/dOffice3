const asyncHandler = require('../../utils/async-handler');
const auditService = require('../audits/audit.service');
const securityService = require('./security.service');

async function logFailure(req, action, entityType, entityId, error, metadata = {}) {
  if (!error || !error.statusCode) return;

  await auditService.logAction({
    req,
    userId: req.auth && req.auth.user ? req.auth.user.id : null,
    action,
    entityType,
    entityId,
    statusCode: error.statusCode,
    metadata: {
      message: error.message,
      details: error.details || {},
      ...metadata,
    },
  });
}

const uploadPreKeyBundle = asyncHandler(async (req, res) => {
  try {
    await securityService.uploadPreKeyBundle(req.body, req.auth, req);
  } catch (error) {
    await logFailure(req, 'keys.upload_failed', 'user', req.auth.user.id, error);
    throw error;
  }

  res.status(201).end();
});

const getUserPreKeyBundle = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await securityService.getUserPreKeyBundle(req.params.userId, req.query, req.auth, req);
  } catch (error) {
    await logFailure(req, 'keys.bundle_view_failed', 'user', req.params.userId, error);
    throw error;
  }

  res.status(200).json(result);
});

const listCurrentUserDevices = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await securityService.listCurrentUserDevices(req.auth, req);
  } catch (error) {
    await logFailure(req, 'devices.list_failed', 'user', req.auth.user.id, error);
    throw error;
  }

  res.status(200).json(result);
});

const removeCurrentUserDevice = asyncHandler(async (req, res) => {
  try {
    await securityService.removeCurrentUserDevice(req.params.deviceId, req.auth, req);
  } catch (error) {
    await logFailure(req, 'devices.remove_failed', 'device', req.params.deviceId, error);
    throw error;
  }

  res.status(204).end();
});

const getUserKeyFingerprint = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await securityService.getUserKeyFingerprint(req.params.userId, req.auth, req);
  } catch (error) {
    await logFailure(req, 'keys.fingerprint_view_failed', 'user', req.params.userId, error);
    throw error;
  }

  res.status(200).json(result);
});

module.exports = {
  uploadPreKeyBundle,
  getUserPreKeyBundle,
  listCurrentUserDevices,
  removeCurrentUserDevice,
  getUserKeyFingerprint,
};
