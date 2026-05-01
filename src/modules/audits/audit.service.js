const { generateId } = require('../../utils/id');
const auditRepository = require('./audit.repository');

async function logAction(input, db) {
  return auditRepository.createAudit(
    {
      id: generateId('audit'),
      userId: input.userId || null,
      action: input.action,
      entityType: input.entityType || null,
      entityId: input.entityId || null,
      method: input.req.method,
      path: input.req.originalUrl,
      statusCode: input.statusCode || null,
      ip: input.req.ip,
      userAgent: input.req.get('user-agent') || 'unknown',
      metadata: input.metadata || {},
    },
    db,
  );
}

async function listUserAudits(userId) {
  const audits = await auditRepository.listAuditsByUserId(userId);

  return {
    audits,
    totalCount: audits.length,
  };
}

module.exports = {
  logAction,
  listUserAudits,
};
