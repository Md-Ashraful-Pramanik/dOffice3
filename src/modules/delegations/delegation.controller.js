const asyncHandler = require('../../utils/async-handler');
const auditService = require('../audits/audit.service');
const delegationService = require('./delegation.service');

async function logFailure(req, action, entityType, entityId, error, metadata = {}) {
  if (!error || !error.statusCode) return;
  await auditService.logAction({
    req,
    userId: req.auth && req.auth.user ? req.auth.user.id : null,
    action,
    entityType,
    entityId,
    statusCode: error.statusCode,
    metadata: { message: error.message, details: error.details || {}, ...metadata },
  });
}

const listDelegations = asyncHandler(async (req, res) => {
  const result = await delegationService.listDelegations(req.params.userId, req.query, req.auth.user);
  res.status(200).json(result);
});

const createDelegation = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await delegationService.createDelegation(req.params.userId, req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'delegations.create_failed', 'user', req.params.userId, error);
    throw error;
  }
  res.status(201).json(result);
});

const revokeDelegation = asyncHandler(async (req, res) => {
  try {
    await delegationService.revokeDelegation(req.params.userId, req.params.delegationId, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'delegations.revoke_failed', 'delegation', req.params.delegationId, error);
    throw error;
  }
  res.status(204).end();
});

module.exports = {
  listDelegations,
  createDelegation,
  revokeDelegation,
};
