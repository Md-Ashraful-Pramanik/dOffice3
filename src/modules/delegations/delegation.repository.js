const { query } = require('../../db/pool');

function mapDelegation(row) {
  if (!row) return null;
  return {
    id: row.id,
    delegatorUserId: row.delegator_user_id,
    delegateUserId: row.delegate_user_id,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    status: row.status,
    scope: row.scope || {},
    createdAt: row.created_at,
  };
}

async function findDelegationsByUser(userId, { status } = {}) {
  const conditions = ['d.delegator_user_id = $1', 'd.deleted_at IS NULL'];
  const params = [userId];

  if (status) {
    params.push(status);
    conditions.push(`d.status = $${params.length}`);
  }

  const result = await query(
    `SELECT * FROM delegations d WHERE ${conditions.join(' AND ')} ORDER BY d.created_at DESC`,
    params,
  );
  return result.rows.map(mapDelegation);
}

async function findDelegationByIdAndUser(delegationId, userId) {
  const result = await query(
    'SELECT * FROM delegations WHERE id = $1 AND delegator_user_id = $2 AND deleted_at IS NULL',
    [delegationId, userId],
  );
  return mapDelegation(result.rows[0]);
}

async function createDelegation({ id, delegatorUserId, delegateUserId, startDate, endDate, reason, scope }) {
  const result = await query(
    `INSERT INTO delegations (id, delegator_user_id, delegate_user_id, start_date, end_date, reason, scope)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, delegatorUserId, delegateUserId, startDate, endDate, reason || null, JSON.stringify(scope || {})],
  );
  return mapDelegation(result.rows[0]);
}

async function softDeleteDelegation(delegationId) {
  await query(
    "UPDATE delegations SET deleted_at = NOW(), status = 'revoked', updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
    [delegationId],
  );
}

module.exports = {
  findDelegationsByUser,
  findDelegationByIdAndUser,
  createDelegation,
  softDeleteDelegation,
};
