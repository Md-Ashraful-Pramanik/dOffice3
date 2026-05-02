const { withTransaction } = require('../../db/pool');
const { AppError, validationError } = require('../../utils/errors');
const { generateId } = require('../../utils/id');
const auditService = require('../audits/audit.service');
const organizationRepository = require('./organization.repository');

const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';
const NOT_FOUND_MESSAGE = 'Resource not found.';
const ORGANIZATION_STATUSES = new Set(['active', 'archived', 'deactivated']);
const SUPER_ADMIN_ROLES = new Set(['super_admin', 'role_super_admin']);
const ORG_ADMIN_ROLES = new Set(['org_admin', 'role_org_admin']);

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function isSuperAdmin(user) {
  return (user.roleIds || []).some((role) => SUPER_ADMIN_ROLES.has(normalizeRole(role)));
}

function isOrgAdmin(user) {
  return isSuperAdmin(user)
    || (user.roleIds || []).some((role) => ORG_ADMIN_ROLES.has(normalizeRole(role)));
}

function forbidden() {
  return new AppError(403, FORBIDDEN_MESSAGE);
}

function notFound(details) {
  return new AppError(404, NOT_FOUND_MESSAGE, details);
}

function normalizeString(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  return value.trim();
}

function parsePositiveInteger(value, fallback, minimum = 0) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < minimum) {
    return fallback;
  }

  return parsed;
}

function parseIntegerQueryValue(value) {
  if (value === undefined) {
    return {
      hasValue: false,
      isValid: true,
      value: undefined,
    };
  }

  if (Array.isArray(value)) {
    return {
      hasValue: true,
      isValid: false,
      value: undefined,
    };
  }

  if (typeof value === 'string' && value.trim() === '') {
    return {
      hasValue: true,
      isValid: false,
      value: undefined,
    };
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return {
      hasValue: true,
      isValid: false,
      value: undefined,
    };
  }

  return {
    hasValue: true,
    isValid: true,
    value: parsed,
  };
}

function ensurePlainObject(value, field, errors) {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors[field] = ['must be an object'];
    return undefined;
  }

  return value;
}

function validateCreatePayload(payload, fallbackParentId) {
  const errors = {};
  const organization = payload && payload.organization;

  if (!organization || typeof organization !== 'object' || Array.isArray(organization)) {
    throw validationError({ organization: ["can't be blank"] });
  }

  const name = normalizeString(organization.name);
  const code = normalizeString(organization.code);
  const type = normalizeString(organization.type);
  const logo = Object.prototype.hasOwnProperty.call(organization, 'logo')
    ? organization.logo === null
      ? null
      : normalizeString(organization.logo)
    : null;
  const metadata = ensurePlainObject(organization.metadata, 'metadata', errors);
  const parentId = fallbackParentId || normalizeString(organization.parentId) || null;

  if (!name) {
    errors.name = ["can't be blank"];
  }

  if (!code) {
    errors.code = ["can't be blank"];
  }

  if (Object.prototype.hasOwnProperty.call(organization, 'type') && !type) {
    errors.type = ["can't be blank"];
  }

  if (Object.prototype.hasOwnProperty.call(organization, 'logo') && organization.logo !== null && !logo) {
    errors.logo = ["can't be blank"];
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  return {
    name,
    code,
    type: type || null,
    logo,
    metadata: metadata || {},
    parentId,
  };
}

function validateUpdatePayload(payload) {
  const errors = {};
  const organization = payload && payload.organization;

  if (!organization || typeof organization !== 'object' || Array.isArray(organization)) {
    throw validationError({ organization: ["can't be blank"] });
  }

  const changes = {};

  if (Object.prototype.hasOwnProperty.call(organization, 'name')) {
    const name = normalizeString(organization.name);

    if (!name) {
      errors.name = ["can't be blank"];
    } else {
      changes.name = name;
    }
  }

  if (Object.prototype.hasOwnProperty.call(organization, 'code')) {
    const code = normalizeString(organization.code);

    if (!code) {
      errors.code = ["can't be blank"];
    } else {
      changes.code = code;
    }
  }

  if (Object.prototype.hasOwnProperty.call(organization, 'type')) {
    const type = normalizeString(organization.type);

    if (!type) {
      errors.type = ["can't be blank"];
    } else {
      changes.type = type;
    }
  }

  if (Object.prototype.hasOwnProperty.call(organization, 'logo')) {
    if (organization.logo === null) {
      changes.logo = null;
    } else {
      const logo = normalizeString(organization.logo);

      if (!logo) {
        errors.logo = ["can't be blank"];
      } else {
        changes.logo = logo;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(organization, 'metadata')) {
    const metadata = ensurePlainObject(organization.metadata, 'metadata', errors);

    if (metadata) {
      changes.metadata = metadata;
    }
  }

  if (Object.keys(changes).length === 0 && Object.keys(errors).length === 0) {
    errors.organization = ['must include at least one updatable field'];
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  return changes;
}

function validateMovePayload(payload) {
  const newParentId = normalizeString(payload && payload.newParentId);

  if (!newParentId) {
    throw validationError({ newParentId: ["can't be blank"] });
  }

  return { newParentId };
}

function validateMergePayload(payload) {
  const sourceOrgId = normalizeString(payload && payload.sourceOrgId);
  const targetOrgId = normalizeString(payload && payload.targetOrgId);
  const errors = {};

  if (!sourceOrgId) {
    errors.sourceOrgId = ["can't be blank"];
  }

  if (!targetOrgId) {
    errors.targetOrgId = ["can't be blank"];
  }

  if (sourceOrgId && targetOrgId && sourceOrgId === targetOrgId) {
    errors.targetOrgId = ['must be different from sourceOrgId'];
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  return { sourceOrgId, targetOrgId };
}

function validateClonePayload(payload) {
  const newName = normalizeString(payload && payload.newName);
  const newCode = normalizeString(payload && payload.newCode);
  const errors = {};

  if (!newName) {
    errors.newName = ["can't be blank"];
  }

  if (!newCode) {
    errors.newCode = ["can't be blank"];
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  return {
    newName,
    newCode,
    includeRoles: Boolean(payload && payload.includeRoles),
    includeNavConfig: Boolean(payload && payload.includeNavConfig),
    includeUsers: Boolean(payload && payload.includeUsers),
  };
}

function validateRelationshipPayload(payload) {
  const relationship = payload && payload.relationship;

  if (!relationship || typeof relationship !== 'object' || Array.isArray(relationship)) {
    throw validationError({ relationship: ["can't be blank"] });
  }

  const targetOrgId = normalizeString(relationship.targetOrgId);
  const type = normalizeString(relationship.type);
  const errors = {};

  if (!targetOrgId) {
    errors.targetOrgId = ["can't be blank"];
  }

  if (!type) {
    errors.type = ["can't be blank"];
  }

  let description = null;

  if (Object.prototype.hasOwnProperty.call(relationship, 'description')) {
    if (relationship.description === null) {
      description = null;
    } else {
      description = normalizeString(relationship.description);

      if (!description) {
        errors.description = ["can't be blank"];
      }
    }
  }

  let sharedModules = [];

  if (Object.prototype.hasOwnProperty.call(relationship, 'sharedModules')) {
    if (!Array.isArray(relationship.sharedModules)) {
      errors.sharedModules = ['must be an array'];
    } else {
      const normalizedModules = relationship.sharedModules
        .map((moduleName) => normalizeString(moduleName))
        .filter((moduleName) => Boolean(moduleName));

      if (normalizedModules.length !== relationship.sharedModules.length) {
        errors.sharedModules = ['must contain non-empty strings'];
      } else {
        sharedModules = Array.from(new Set(normalizedModules));
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  return {
    targetOrgId,
    type: type.toLowerCase(),
    description,
    sharedModules,
  };
}

function validateStatusFilter(status) {
  if (!status) {
    return null;
  }

  const normalized = normalizeString(status);

  if (!ORGANIZATION_STATUSES.has(normalized)) {
    throw validationError({ status: ['is invalid'] });
  }

  return normalized;
}

function validateOrganizationListPagination(query) {
  const errors = {};
  const parsedLimit = parseIntegerQueryValue(query.limit);
  const parsedOffset = parseIntegerQueryValue(query.offset);

  if (parsedLimit.hasValue && (!parsedLimit.isValid || parsedLimit.value < 1)) {
    errors.limit = ['must be an integer greater than or equal to 1'];
  }

  if (parsedOffset.hasValue && (!parsedOffset.isValid || parsedOffset.value < 0)) {
    errors.offset = ['must be an integer greater than or equal to 0'];
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  return {
    limit: parsedLimit.hasValue ? parsedLimit.value : 20,
    offset: parsedOffset.hasValue ? parsedOffset.value : 0,
  };
}

async function ensureCodeAvailable(code, excludeId, db) {
  const existing = await organizationRepository.findOrganizationByCode(code, { excludeId }, db);

  if (existing) {
    throw validationError({ code: ['has already been taken'] });
  }
}

async function getOrganizationOrThrow(orgId, db) {
  const organization = await organizationRepository.findOrganizationById(orgId, db);

  if (!organization) {
    throw notFound();
  }

  return organization;
}

async function getAccessibleOrganizationIds(user, db) {
  if (isSuperAdmin(user)) {
    return null;
  }

  if (!user.orgId) {
    return [];
  }

  if (isOrgAdmin(user)) {
    return organizationRepository.listDescendantIds(user.orgId, db);
  }

  return [user.orgId];
}

function ensureOrgAdmin(user) {
  if (!isOrgAdmin(user)) {
    throw forbidden();
  }
}

function ensureSuperAdmin(user) {
  if (!isSuperAdmin(user)) {
    throw forbidden();
  }
}

async function ensureAccessibleOrganization(user, orgId, options = {}, db) {
  const organization = await getOrganizationOrThrow(orgId, db);
  const accessibleIds = options.accessibleIds || await getAccessibleOrganizationIds(user, db);

  if (accessibleIds !== null && !accessibleIds.includes(orgId)) {
    throw forbidden();
  }

  return {
    organization,
    accessibleIds,
  };
}

async function ensureSourceAndTargetAccess(user, sourceOrgId, targetOrgId, db) {
  const source = await getOrganizationOrThrow(sourceOrgId, db);
  const target = await getOrganizationOrThrow(targetOrgId, db);

  if (isSuperAdmin(user)) {
    return { source, target };
  }

  ensureOrgAdmin(user);
  const accessibleIds = await getAccessibleOrganizationIds(user, db);

  if (!accessibleIds.includes(sourceOrgId) || !accessibleIds.includes(targetOrgId)) {
    throw forbidden();
  }

  return { source, target };
}

function toOrganizationSummary(organization) {
  return {
    id: organization.id,
    name: organization.name,
    code: organization.code,
    type: organization.type,
    status: organization.status,
    parentId: organization.parentId,
    childrenCount: organization.childrenCount,
    userCount: organization.userCount,
  };
}

function toOrganizationPayload(organization) {
  return {
    id: organization.id,
    name: organization.name,
    code: organization.code,
    type: organization.type,
    status: organization.status,
    logo: organization.logo,
    parentId: organization.parentId,
    depth: organization.depth,
    childrenCount: organization.childrenCount,
    userCount: organization.userCount,
    metadata: organization.metadata || {},
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

function toSingleOrganizationResponse(organization) {
  return {
    organization: toOrganizationPayload(organization),
  };
}

function toRelationshipPayload(relationship) {
  return {
    id: relationship.id,
    sourceOrgId: relationship.sourceOrgId,
    targetOrgId: relationship.targetOrgId,
    type: relationship.type,
    description: relationship.description,
    sharedModules: relationship.sharedModules || [],
    createdAt: relationship.createdAt,
  };
}

function toSingleRelationshipResponse(relationship) {
  return {
    relationship: toRelationshipPayload(relationship),
  };
}

function toMultipleRelationshipsResponse(relationships) {
  return {
    relationships: relationships.map(toRelationshipPayload),
    totalCount: relationships.length,
  };
}

function toMultipleOrganizationsResponse(result, limit, offset) {
  return {
    organizations: result.organizations.map(toOrganizationSummary),
    totalCount: result.totalCount,
    limit,
    offset,
  };
}

function trimTreeNode(node, currentDepth, maxDepth) {
  if (maxDepth === null || currentDepth >= maxDepth) {
    return {
      ...node,
      children: maxDepth !== null && currentDepth >= maxDepth ? [] : node.children,
    };
  }

  return {
    ...node,
    children: node.children.map((child) => trimTreeNode(child, currentDepth + 1, maxDepth)),
  };
}

function buildTree(organizations, rootIds = null) {
  const nodes = new Map();
  const organizationIds = new Set(organizations.map((organization) => organization.id));

  organizations.forEach((organization) => {
    nodes.set(organization.id, {
      id: organization.id,
      name: organization.name,
      code: organization.code,
      type: organization.type,
      status: organization.status,
      children: [],
    });
  });

  const roots = [];
  const explicitRoots = rootIds ? new Set(rootIds) : null;

  organizations.forEach((organization) => {
    const node = nodes.get(organization.id);

    if (explicitRoots && explicitRoots.has(organization.id)) {
      roots.push(node);
      return;
    }

    if (!organization.parentId || !organizationIds.has(organization.parentId)) {
      roots.push(node);
      return;
    }

    const parentNode = nodes.get(organization.parentId);

    if (parentNode) {
      parentNode.children.push(node);
    }
  });

  return roots;
}

function normalizeCodeKey(code) {
  return String(code || '').trim().toLowerCase();
}

function cloneMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }

  return JSON.parse(JSON.stringify(metadata));
}

function toClonedStatus(status) {
  return status === 'archived' ? 'archived' : 'active';
}

function buildClonedCodeBase(sourceCode, sourceRootCode, clonedRootCode) {
  const normalizedSourceCode = String(sourceCode || '').trim();
  const normalizedSourceRootCode = String(sourceRootCode || '').trim();
  const normalizedClonedRootCode = String(clonedRootCode || '').trim();

  if (!normalizedSourceCode) {
    return normalizedClonedRootCode;
  }

  if (
    normalizedSourceRootCode
    && normalizedSourceCode.toLowerCase().startsWith(normalizedSourceRootCode.toLowerCase())
  ) {
    const suffix = normalizedSourceCode.slice(normalizedSourceRootCode.length);

    if (suffix) {
      return `${normalizedClonedRootCode}${suffix}`;
    }
  }

  return `${normalizedClonedRootCode}-${normalizedSourceCode}`;
}

async function reserveClonedOrganizationCode(baseCode, reservedCodes, db) {
  let candidate = baseCode;
  let counter = 2;

  while (
    reservedCodes.has(normalizeCodeKey(candidate))
    || await organizationRepository.findOrganizationByCode(candidate, {}, db)
  ) {
    candidate = `${baseCode}-${counter}`;
    counter += 1;
  }

  reservedCodes.add(normalizeCodeKey(candidate));
  return candidate;
}

async function cloneOrganizationSubtree(source, input, db) {
  const subtree = await organizationRepository.listSubtree(source.id, null, db);
  const clonedIdsBySourceId = new Map();
  const clonedDepthsBySourceId = new Map();
  const reservedCodes = new Set([normalizeCodeKey(input.newCode)]);
  let clonedRoot = null;

  for (const organization of subtree) {
    const isRoot = organization.id === source.id;
    const clonedParentId = isRoot ? source.parentId : clonedIdsBySourceId.get(organization.parentId);
    const parentDepth = isRoot ? source.depth - 1 : clonedDepthsBySourceId.get(organization.parentId);

    if (!isRoot && !clonedParentId) {
      throw new AppError(500, 'Failed to clone organization hierarchy.');
    }

    const clonedOrganization = await organizationRepository.createOrganization(
      {
        id: generateId('org'),
        name: isRoot ? input.newName : organization.name,
        code: isRoot
          ? input.newCode
          : await reserveClonedOrganizationCode(
            buildClonedCodeBase(organization.code, source.code, input.newCode),
            reservedCodes,
            db,
          ),
        type: organization.type,
        status: toClonedStatus(organization.status),
        logo: organization.logo,
        parentId: clonedParentId || null,
        depth: parentDepth + 1,
        metadata: cloneMetadata(organization.metadata),
      },
      db,
    );

    clonedIdsBySourceId.set(organization.id, clonedOrganization.id);
    clonedDepthsBySourceId.set(organization.id, clonedOrganization.depth);

    if (isRoot) {
      clonedRoot = clonedOrganization;
    }
  }

  return clonedRoot;
}

async function listOrganizations(query, user) {
  const { limit, offset } = validateOrganizationListPagination(query);
  const status = validateStatusFilter(query.status);
  const search = normalizeString(query.search) || null;
  const parentId = normalizeString(query.parentId);
  const accessibleIds = await getAccessibleOrganizationIds(user);

  if (parentId) {
    await ensureAccessibleOrganization(user, parentId, { accessibleIds });
  }

  const result = await organizationRepository.listOrganizations({
    search,
    status,
    parentId: parentId || undefined,
    limit,
    offset,
    organizationIds: accessibleIds,
  });

  return toMultipleOrganizationsResponse(result, limit, offset);
}

async function getOrganizationTree(query, user) {
  const depth = query.depth === undefined ? null : parsePositiveInteger(query.depth, null, 0);
  const rootId = normalizeString(query.rootId);
  const accessibleIds = await getAccessibleOrganizationIds(user);

  if (rootId) {
    await ensureAccessibleOrganization(user, rootId, { accessibleIds });
    const subtree = await organizationRepository.listSubtree(rootId, depth);

    return {
      tree: buildTree(subtree, [rootId]),
    };
  }

  const organizations = accessibleIds === null
    ? await organizationRepository.listActiveOrganizations()
    : await organizationRepository.listOrganizationsByIds(accessibleIds);

  const tree = buildTree(organizations)
    .map((node) => trimTreeNode(node, 0, depth));

  return { tree };
}

async function getOrganization(orgId, user) {
  const { organization } = await ensureAccessibleOrganization(user, orgId);
  return toSingleOrganizationResponse(organization);
}

async function createOrganization(payload, user, req) {
  ensureSuperAdmin(user);
  const input = validateCreatePayload(payload, null);

  return withTransaction(async (db) => {
    let parent = null;

    if (input.parentId) {
      parent = await getOrganizationOrThrow(input.parentId, db);

      if (parent.status !== 'active') {
        throw validationError({ parentId: ['must reference an active organization'] });
      }
    }

    await ensureCodeAvailable(input.code, null, db);

    const createdOrganization = await organizationRepository.createOrganization(
      {
        id: generateId('org'),
        name: input.name,
        code: input.code,
        type: input.type || (parent ? 'unit' : 'root'),
        status: 'active',
        logo: input.logo,
        parentId: parent ? parent.id : null,
        depth: parent ? parent.depth + 1 : 0,
        metadata: input.metadata,
      },
      db,
    );

    await auditService.logAction(
      {
        req,
        userId: user.id,
        action: 'organization.created',
        entityType: 'organization',
        entityId: createdOrganization.id,
        statusCode: 201,
        metadata: {
          parentId: createdOrganization.parentId,
        },
      },
      db,
    );

    return toSingleOrganizationResponse(createdOrganization);
  });
}

async function createChildOrganization(orgId, payload, user, req) {
  ensureOrgAdmin(user);

  return withTransaction(async (db) => {
    const { organization: parent } = await ensureAccessibleOrganization(user, orgId, {}, db);

    if (parent.status !== 'active') {
      throw validationError({ orgId: ['must reference an active organization'] });
    }

    const input = validateCreatePayload(payload, orgId);
    await ensureCodeAvailable(input.code, null, db);

    const createdOrganization = await organizationRepository.createOrganization(
      {
        id: generateId('org'),
        name: input.name,
        code: input.code,
        type: input.type || 'unit',
        status: 'active',
        logo: input.logo,
        parentId: parent.id,
        depth: parent.depth + 1,
        metadata: input.metadata,
      },
      db,
    );

    await auditService.logAction(
      {
        req,
        userId: user.id,
        action: 'organization.child_created',
        entityType: 'organization',
        entityId: createdOrganization.id,
        statusCode: 201,
        metadata: {
          parentId: parent.id,
        },
      },
      db,
    );

    return toSingleOrganizationResponse(createdOrganization);
  });
}

async function updateOrganization(orgId, payload, user, req) {
  ensureOrgAdmin(user);
  const changes = validateUpdatePayload(payload);

  return withTransaction(async (db) => {
    await ensureAccessibleOrganization(user, orgId, {}, db);

    if (changes.code) {
      await ensureCodeAvailable(changes.code, orgId, db);
    }

    const updatedOrganization = await organizationRepository.updateOrganization(orgId, changes, db);

    await auditService.logAction(
      {
        req,
        userId: user.id,
        action: 'organization.updated',
        entityType: 'organization',
        entityId: updatedOrganization.id,
        statusCode: 200,
        metadata: {
          changedFields: Object.keys(changes),
        },
      },
      db,
    );

    return toSingleOrganizationResponse(updatedOrganization);
  });
}

async function moveOrganization(orgId, payload, user, req) {
  const input = validateMovePayload(payload);

  return withTransaction(async (db) => {
    const { source, target } = await ensureSourceAndTargetAccess(user, orgId, input.newParentId, db);

    if (source.id === target.id) {
      throw validationError({ newParentId: ['must be different from orgId'] });
    }

    if (target.status !== 'active') {
      throw validationError({ newParentId: ['must reference an active organization'] });
    }

    const sourceDescendantIds = await organizationRepository.listDescendantIds(source.id, db);

    if (sourceDescendantIds.includes(target.id)) {
      throw validationError({ newParentId: ['cannot reference a descendant organization'] });
    }

    if (source.parentId === target.id) {
      return toSingleOrganizationResponse(source);
    }

    await organizationRepository.updateOrganization(
      source.id,
      {
        parentId: target.id,
        depth: target.depth + 1,
      },
      db,
    );
    await organizationRepository.recalculateSubtreeDepths(source.id, target.depth + 1, db);

    const movedOrganization = await organizationRepository.findOrganizationById(source.id, db);

    await auditService.logAction(
      {
        req,
        userId: user.id,
        action: 'organization.moved',
        entityType: 'organization',
        entityId: movedOrganization.id,
        statusCode: 200,
        metadata: {
          previousParentId: source.parentId,
          newParentId: target.id,
        },
      },
      db,
    );

    return toSingleOrganizationResponse(movedOrganization);
  });
}

async function mergeOrganizations(payload, user, req) {
  ensureSuperAdmin(user);
  const input = validateMergePayload(payload);

  return withTransaction(async (db) => {
    const source = await getOrganizationOrThrow(input.sourceOrgId, db);
    const target = await getOrganizationOrThrow(input.targetOrgId, db);
    const sourceDescendantIds = await organizationRepository.listDescendantIds(source.id, db);

    if (sourceDescendantIds.includes(target.id)) {
      throw validationError({ targetOrgId: ['cannot reference a descendant organization'] });
    }

    const childIds = await organizationRepository.listDirectChildIds(source.id, db);

    await organizationRepository.reassignDirectChildren(source.id, target.id, db);

    for (const childId of childIds) {
      await organizationRepository.recalculateSubtreeDepths(childId, target.depth + 1, db);
    }

    await organizationRepository.reassignUsersToOrganization(source.id, target.id, db);
    await organizationRepository.softDeleteOrganization(source.id, { mergedIntoOrgId: target.id }, db);

    const mergedOrganization = await organizationRepository.findOrganizationById(target.id, db);

    await auditService.logAction(
      {
        req,
        userId: user.id,
        action: 'organization.merged',
        entityType: 'organization',
        entityId: mergedOrganization.id,
        statusCode: 200,
        metadata: {
          sourceOrgId: source.id,
          targetOrgId: target.id,
          movedChildrenCount: childIds.length,
        },
      },
      db,
    );

    return toSingleOrganizationResponse(mergedOrganization);
  });
}

async function cloneOrganization(orgId, payload, user, req) {
  ensureOrgAdmin(user);
  const input = validateClonePayload(payload);

  return withTransaction(async (db) => {
    const { organization: source } = await ensureAccessibleOrganization(user, orgId, {}, db);
    await ensureCodeAvailable(input.newCode, null, db);

    const clonedOrganization = await cloneOrganizationSubtree(source, input, db);
    const descendantIds = await organizationRepository.listDescendantIds(clonedOrganization.id, db);

    await auditService.logAction(
      {
        req,
        userId: user.id,
        action: 'organization.cloned',
        entityType: 'organization',
        entityId: clonedOrganization.id,
        statusCode: 201,
        metadata: {
          sourceOrgId: source.id,
          includeRoles: input.includeRoles,
          includeNavConfig: input.includeNavConfig,
          includeUsers: input.includeUsers,
          clonedDescendantCount: Math.max(descendantIds.length - 1, 0),
        },
      },
      db,
    );

    return toSingleOrganizationResponse(clonedOrganization);
  });
}

async function archiveOrganization(orgId, user, req) {
  ensureOrgAdmin(user);

  return withTransaction(async (db) => {
    const { organization } = await ensureAccessibleOrganization(user, orgId, {}, db);
    await organizationRepository.updateStatusForSubtree(organization.id, 'archived', db);

    const archivedOrganization = await organizationRepository.findOrganizationById(orgId, db);

    await auditService.logAction(
      {
        req,
        userId: user.id,
        action: 'organization.archived',
        entityType: 'organization',
        entityId: archivedOrganization.id,
        statusCode: 200,
      },
      db,
    );

    return toSingleOrganizationResponse(archivedOrganization);
  });
}

async function restoreOrganization(orgId, user, req) {
  ensureOrgAdmin(user);

  return withTransaction(async (db) => {
    const { organization } = await ensureAccessibleOrganization(user, orgId, {}, db);

    if (organization.parentId) {
      const parent = await getOrganizationOrThrow(organization.parentId, db);

      if (parent.status !== 'active') {
        throw validationError({ orgId: ['cannot be restored while parent organization is not active'] });
      }
    }

    await organizationRepository.updateStatusForSubtree(organization.id, 'active', db);

    const restoredOrganization = await organizationRepository.findOrganizationById(orgId, db);

    await auditService.logAction(
      {
        req,
        userId: user.id,
        action: 'organization.restored',
        entityType: 'organization',
        entityId: restoredOrganization.id,
        statusCode: 200,
      },
      db,
    );

    return toSingleOrganizationResponse(restoredOrganization);
  });
}

async function deleteOrganization(orgId, user, req) {
  ensureSuperAdmin(user);

  return withTransaction(async (db) => {
    const organization = await getOrganizationOrThrow(orgId, db);
    const activeChildCount = await organizationRepository.countActiveChildren(organization.id, db);
    const userCount = await organizationRepository.countUsers(organization.id, db);

    if (activeChildCount > 0 || userCount > 0) {
      throw new AppError(
        409,
        'Organization cannot be deleted while child organizations or users still exist.',
        {
          activeChildCount,
          userCount,
        },
      );
    }

    await organizationRepository.softDeleteOrganization(organization.id, {}, db);
    await auditService.logAction(
      {
        req,
        userId: user.id,
        action: 'organization.deleted',
        entityType: 'organization',
        entityId: organization.id,
        statusCode: 204,
      },
      db,
    );
  });
}

async function listRelationships(orgId, user) {
  await ensureAccessibleOrganization(user, orgId);
  const relationships = await organizationRepository.listRelationshipsByOrganizationId(orgId);

  return toMultipleRelationshipsResponse(relationships);
}

async function createRelationship(orgId, payload, user, req) {
  ensureOrgAdmin(user);
  const input = validateRelationshipPayload(payload);

  if (input.targetOrgId === orgId) {
    throw validationError({ targetOrgId: ['must be different from orgId'] });
  }

  return withTransaction(async (db) => {
    const { organization: source, accessibleIds } = await ensureAccessibleOrganization(user, orgId, {}, db);
    const target = await getOrganizationOrThrow(input.targetOrgId, db);

    if (source.id === target.id) {
      throw validationError({ targetOrgId: ['must be different from orgId'] });
    }

    if (source.status !== 'active') {
      throw validationError({ orgId: ['must reference an active organization'] });
    }

    if (target.status !== 'active') {
      throw validationError({ targetOrgId: ['must reference an active organization'] });
    }

    if (!isSuperAdmin(user) && !accessibleIds.includes(target.id)) {
      throw forbidden();
    }

    const existingRelationship = await organizationRepository.findActiveRelationshipBetweenOrganizations(
      source.id,
      target.id,
      input.type,
      db,
    );

    if (existingRelationship) {
      throw validationError({ type: ['relationship already exists for the selected organizations'] });
    }

    const relationship = await organizationRepository.createRelationship(
      {
        id: generateId('rel'),
        sourceOrgId: source.id,
        targetOrgId: target.id,
        type: input.type,
        description: input.description,
        sharedModules: input.sharedModules,
        createdByUserId: user.id,
      },
      db,
    );

    await auditService.logAction(
      {
        req,
        userId: user.id,
        action: 'relationship.created',
        entityType: 'relationship',
        entityId: relationship.id,
        statusCode: 201,
        metadata: {
          sourceOrgId: relationship.sourceOrgId,
          targetOrgId: relationship.targetOrgId,
          type: relationship.type,
          sharedModulesCount: relationship.sharedModules.length,
        },
      },
      db,
    );

    return toSingleRelationshipResponse(relationship);
  });
}

async function deleteRelationship(orgId, relationshipId, user, req) {
  ensureOrgAdmin(user);

  return withTransaction(async (db) => {
    const relationship = await organizationRepository.findRelationshipByIdIncludingDeleted(
      relationshipId,
      db,
    );

    if (!relationship) {
      throw notFound({
        orgId,
        relationshipId,
        reason: 'missing',
      });
    }

    if (relationship.deletedAt) {
      throw notFound({
        orgId,
        relationshipId,
        reason: 'already_deleted',
      });
    }

    if (relationship.sourceOrgId !== orgId && relationship.targetOrgId !== orgId) {
      throw notFound({
        orgId,
        relationshipId,
        reason: 'org_mismatch',
      });
    }

    if (!isSuperAdmin(user)) {
      const accessibleIds = await getAccessibleOrganizationIds(user, db);

      if (
        !accessibleIds.includes(relationship.sourceOrgId)
        && !accessibleIds.includes(relationship.targetOrgId)
      ) {
        throw forbidden();
      }
    }

    const deletedCount = await organizationRepository.softDeleteRelationship(relationship.id, db);

    if (deletedCount === 0) {
      throw notFound({
        orgId,
        relationshipId,
        reason: 'already_deleted',
      });
    }

    await auditService.logAction(
      {
        req,
        userId: user.id,
        action: 'relationship.deleted',
        entityType: 'relationship',
        entityId: relationship.id,
        statusCode: 204,
        metadata: {
          sourceOrgId: relationship.sourceOrgId,
          targetOrgId: relationship.targetOrgId,
          type: relationship.type,
        },
      },
      db,
    );
  });
}

module.exports = {
  isSuperAdmin,
  isOrgAdmin,
  toSingleOrganizationResponse,
  toSingleRelationshipResponse,
  listOrganizations,
  getOrganizationTree,
  getOrganization,
  createOrganization,
  createChildOrganization,
  updateOrganization,
  moveOrganization,
  mergeOrganizations,
  cloneOrganization,
  archiveOrganization,
  restoreOrganization,
  deleteOrganization,
  listRelationships,
  createRelationship,
  deleteRelationship,
};
