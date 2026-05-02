const { query } = require('../../db/pool');

const ORGANIZATION_COLUMNS = `
  o.id,
  o.name,
  o.code,
  o.type,
  o.status,
  o.logo,
  o.parent_id,
  o.depth,
  o.metadata,
  o.created_at,
  o.updated_at,
  o.merged_into_org_id,
  COALESCE(child_counts.children_count, 0)::INT AS children_count,
  COALESCE(user_counts.user_count, 0)::INT AS user_count
`;

function buildOrganizationSelect(fromClause, whereClause = '') {
  return `
    SELECT ${ORGANIZATION_COLUMNS}
    ${fromClause}
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::INT AS children_count
      FROM organizations child
      WHERE child.parent_id = o.id AND child.deleted_at IS NULL
    ) child_counts ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::INT AS user_count
      FROM users u
      WHERE u.org_id = o.id AND u.deleted_at IS NULL
    ) user_counts ON TRUE
    ${whereClause ? `WHERE ${whereClause}` : ''}
  `;
}

function mapOrganization(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    code: row.code,
    type: row.type,
    status: row.status,
    logo: row.logo,
    parentId: row.parent_id,
    depth: row.depth,
    childrenCount: row.children_count,
    userCount: row.user_count,
    metadata: row.metadata || {},
    mergedIntoOrgId: row.merged_into_org_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildListFilters(filters = {}) {
  const clauses = ['o.deleted_at IS NULL'];
  const params = [];

  if (Array.isArray(filters.organizationIds)) {
    if (filters.organizationIds.length === 0) {
      return { clauses, params, isEmpty: true };
    }

    params.push(filters.organizationIds);
    clauses.push(`o.id = ANY($${params.length})`);
  }

  if (filters.search) {
    params.push(`%${filters.search}%`);
    clauses.push(`(o.name ILIKE $${params.length} OR o.code ILIKE $${params.length})`);
  }

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`o.status = $${params.length}`);
  }

  if (filters.parentId !== undefined) {
    if (filters.parentId === null) {
      clauses.push('o.parent_id IS NULL');
    } else {
      params.push(filters.parentId);
      clauses.push(`o.parent_id = $${params.length}`);
    }
  }

  return { clauses, params, isEmpty: false };
}

async function findOrganizationById(orgId, db = { query }) {
  const result = await db.query(
    buildOrganizationSelect('FROM organizations o', 'o.id = $1 AND o.deleted_at IS NULL'),
    [orgId],
  );

  return mapOrganization(result.rows[0]);
}

async function findOrganizationByCode(code, options = {}, db = { query }) {
  const params = [code];
  const clauses = ['LOWER(o.code) = LOWER($1)', 'o.deleted_at IS NULL'];

  if (options.excludeId) {
    params.push(options.excludeId);
    clauses.push(`o.id <> $${params.length}`);
  }

  const result = await db.query(
    buildOrganizationSelect('FROM organizations o', clauses.join(' AND ')),
    params,
  );

  return mapOrganization(result.rows[0]);
}

async function listOrganizations(filters = {}, db = { query }) {
  const { clauses, params, isEmpty } = buildListFilters(filters);

  if (isEmpty) {
    return {
      organizations: [],
      totalCount: 0,
    };
  }

  const countResult = await db.query(
    `SELECT COUNT(*)::INT AS count FROM organizations o WHERE ${clauses.join(' AND ')}`,
    params,
  );

  const listParams = [...params, filters.limit, filters.offset];
  const result = await db.query(
    `${buildOrganizationSelect('FROM organizations o', clauses.join(' AND '))}
     ORDER BY o.depth ASC, o.name ASC, o.created_at ASC
     LIMIT $${listParams.length - 1}
     OFFSET $${listParams.length}`,
    listParams,
  );

  return {
    organizations: result.rows.map(mapOrganization),
    totalCount: countResult.rows[0].count,
  };
}

async function listActiveOrganizations(db = { query }) {
  const result = await db.query(
    `${buildOrganizationSelect('FROM organizations o', 'o.deleted_at IS NULL')}
     ORDER BY o.depth ASC, o.name ASC, o.created_at ASC`,
  );

  return result.rows.map(mapOrganization);
}

async function listOrganizationsByIds(ids, db = { query }) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  const result = await db.query(
    `${buildOrganizationSelect('FROM organizations o', 'o.id = ANY($1) AND o.deleted_at IS NULL')}
     ORDER BY o.depth ASC, o.name ASC, o.created_at ASC`,
    [ids],
  );

  return result.rows.map(mapOrganization);
}

async function listSubtree(rootId, maxDepth = null, db = { query }) {
  const result = await db.query(
    `${buildOrganizationSelect(
      `FROM (
        WITH RECURSIVE subtree AS (
          SELECT id, 0::INT AS relative_depth
          FROM organizations
          WHERE id = $1 AND deleted_at IS NULL
          UNION ALL
          SELECT child.id, subtree.relative_depth + 1
          FROM organizations child
          INNER JOIN subtree ON child.parent_id = subtree.id
          WHERE child.deleted_at IS NULL
            AND ($2::INT IS NULL OR subtree.relative_depth < $2)
        )
        SELECT id, relative_depth
        FROM subtree
      ) subtree
      INNER JOIN organizations o ON o.id = subtree.id`,
      'o.deleted_at IS NULL',
    )}
     ORDER BY o.depth ASC, o.name ASC, o.created_at ASC`,
    [rootId, maxDepth],
  );

  return result.rows.map(mapOrganization);
}

async function listDescendantIds(rootId, db = { query }) {
  const result = await db.query(
    `WITH RECURSIVE subtree AS (
      SELECT id
      FROM organizations
      WHERE id = $1 AND deleted_at IS NULL
      UNION ALL
      SELECT child.id
      FROM organizations child
      INNER JOIN subtree ON child.parent_id = subtree.id
      WHERE child.deleted_at IS NULL
    )
    SELECT id FROM subtree`,
    [rootId],
  );

  return result.rows.map((row) => row.id);
}

async function listDirectChildIds(parentId, db = { query }) {
  const result = await db.query(
    `SELECT id
     FROM organizations
     WHERE parent_id = $1 AND deleted_at IS NULL
     ORDER BY name ASC, created_at ASC`,
    [parentId],
  );

  return result.rows.map((row) => row.id);
}

async function createOrganization(organization, db = { query }) {
  await db.query(
    `INSERT INTO organizations (
      id,
      name,
      code,
      type,
      status,
      logo,
      parent_id,
      depth,
      metadata,
      merged_into_org_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      organization.id,
      organization.name,
      organization.code,
      organization.type,
      organization.status,
      organization.logo,
      organization.parentId,
      organization.depth,
      JSON.stringify(organization.metadata || {}),
      organization.mergedIntoOrgId || null,
    ],
  );

  return findOrganizationById(organization.id, db);
}

async function updateOrganization(orgId, changes, db = { query }) {
  const fields = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(changes, 'name')) {
    params.push(changes.name);
    fields.push(`name = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'code')) {
    params.push(changes.code);
    fields.push(`code = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'type')) {
    params.push(changes.type);
    fields.push(`type = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'status')) {
    params.push(changes.status);
    fields.push(`status = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'logo')) {
    params.push(changes.logo);
    fields.push(`logo = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'parentId')) {
    params.push(changes.parentId);
    fields.push(`parent_id = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'depth')) {
    params.push(changes.depth);
    fields.push(`depth = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'metadata')) {
    params.push(JSON.stringify(changes.metadata || {}));
    fields.push(`metadata = $${params.length}::jsonb`);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'mergedIntoOrgId')) {
    params.push(changes.mergedIntoOrgId);
    fields.push(`merged_into_org_id = $${params.length}`);
  }

  if (fields.length === 0) {
    return findOrganizationById(orgId, db);
  }

  params.push(orgId);
  await db.query(
    `UPDATE organizations
     SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length} AND deleted_at IS NULL`,
    params,
  );

  return findOrganizationById(orgId, db);
}

async function updateStatusForSubtree(rootId, status, db = { query }) {
  await db.query(
    `WITH RECURSIVE subtree AS (
      SELECT id
      FROM organizations
      WHERE id = $1 AND deleted_at IS NULL
      UNION ALL
      SELECT child.id
      FROM organizations child
      INNER JOIN subtree ON child.parent_id = subtree.id
      WHERE child.deleted_at IS NULL
    )
    UPDATE organizations o
    SET status = $2,
        updated_at = NOW()
    FROM subtree
    WHERE o.id = subtree.id`,
    [rootId, status],
  );
}

async function recalculateSubtreeDepths(rootId, rootDepth, db = { query }) {
  await db.query(
    `WITH RECURSIVE subtree AS (
      SELECT id, 0::INT AS level
      FROM organizations
      WHERE id = $1 AND deleted_at IS NULL
      UNION ALL
      SELECT child.id, subtree.level + 1
      FROM organizations child
      INNER JOIN subtree ON child.parent_id = subtree.id
      WHERE child.deleted_at IS NULL
    )
    UPDATE organizations o
    SET depth = $2 + subtree.level,
        updated_at = NOW()
    FROM subtree
    WHERE o.id = subtree.id`,
    [rootId, rootDepth],
  );
}

async function reassignDirectChildren(sourceOrgId, targetOrgId, db = { query }) {
  await db.query(
    `UPDATE organizations
     SET parent_id = $2,
         updated_at = NOW()
     WHERE parent_id = $1 AND deleted_at IS NULL`,
    [sourceOrgId, targetOrgId],
  );
}

async function reassignUsersToOrganization(sourceOrgId, targetOrgId, db = { query }) {
  await db.query(
    `UPDATE users
     SET org_id = $2,
         updated_at = NOW()
     WHERE org_id = $1 AND deleted_at IS NULL`,
    [sourceOrgId, targetOrgId],
  );
}

async function countChildren(orgId, db = { query }) {
  const result = await db.query(
    `SELECT COUNT(*)::INT AS count
     FROM organizations
     WHERE parent_id = $1 AND deleted_at IS NULL`,
    [orgId],
  );

  return result.rows[0].count;
}

async function countUsers(orgId, db = { query }) {
  const result = await db.query(
    `SELECT COUNT(*)::INT AS count
     FROM users
     WHERE org_id = $1 AND deleted_at IS NULL`,
    [orgId],
  );

  return result.rows[0].count;
}

async function softDeleteOrganization(orgId, options = {}, db = { query }) {
  await db.query(
    `UPDATE organizations
     SET status = 'archived',
         merged_into_org_id = $2,
         deleted_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`,
    [orgId, options.mergedIntoOrgId || null],
  );
}

module.exports = {
  mapOrganization,
  findOrganizationById,
  findOrganizationByCode,
  listOrganizations,
  listActiveOrganizations,
  listOrganizationsByIds,
  listSubtree,
  listDescendantIds,
  listDirectChildIds,
  createOrganization,
  updateOrganization,
  updateStatusForSubtree,
  recalculateSubtreeDepths,
  reassignDirectChildren,
  reassignUsersToOrganization,
  countChildren,
  countUsers,
  softDeleteOrganization,
};
