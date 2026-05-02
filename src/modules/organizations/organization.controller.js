const asyncHandler = require('../../utils/async-handler');
const auditService = require('../audits/audit.service');
const organizationService = require('./organization.service');

const listOrganizations = asyncHandler(async (req, res) => {
  let result;

  try {
    result = await organizationService.listOrganizations(req.query, req.auth.user);
  } catch (error) {
    if (error && error.statusCode === 422) {
      await auditService.logAction({
        req,
        userId: req.auth.user.id,
        action: 'organizations.list_failed',
        entityType: 'organization',
        entityId: req.auth.user.orgId,
        statusCode: 422,
        metadata: {
          limit: req.query.limit ?? null,
          offset: req.query.offset ?? null,
          errors: error.details || {},
        },
      });
    }

    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'organizations.listed',
    entityType: 'organization',
    entityId: req.auth.user.orgId,
    statusCode: 200,
    metadata: {
      limit: result.limit,
      offset: result.offset,
      totalCount: result.totalCount,
    },
  });

  res.status(200).json(result);
});

const getOrganizationTree = asyncHandler(async (req, res) => {
  const result = await organizationService.getOrganizationTree(req.query, req.auth.user);

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'organizations.tree_viewed',
    entityType: 'organization',
    entityId: req.query.rootId || req.auth.user.orgId,
    statusCode: 200,
    metadata: {
      rootId: req.query.rootId || null,
      depth: req.query.depth || null,
    },
  });

  res.status(200).json(result);
});

const getOrganization = asyncHandler(async (req, res) => {
  const result = await organizationService.getOrganization(req.params.orgId, req.auth.user);

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'organization.viewed',
    entityType: 'organization',
    entityId: req.params.orgId,
    statusCode: 200,
  });

  res.status(200).json(result);
});

const createOrganization = asyncHandler(async (req, res) => {
  const result = await organizationService.createOrganization(req.body, req.auth.user, req);
  res.status(201).json(result);
});

const createChildOrganization = asyncHandler(async (req, res) => {
  const result = await organizationService.createChildOrganization(
    req.params.orgId,
    req.body,
    req.auth.user,
    req,
  );

  res.status(201).json(result);
});

const updateOrganization = asyncHandler(async (req, res) => {
  const result = await organizationService.updateOrganization(
    req.params.orgId,
    req.body,
    req.auth.user,
    req,
  );

  res.status(200).json(result);
});

const moveOrganization = asyncHandler(async (req, res) => {
  const result = await organizationService.moveOrganization(
    req.params.orgId,
    req.body,
    req.auth.user,
    req,
  );

  res.status(200).json(result);
});

const mergeOrganizations = asyncHandler(async (req, res) => {
  const result = await organizationService.mergeOrganizations(req.body, req.auth.user, req);
  res.status(200).json(result);
});

const cloneOrganization = asyncHandler(async (req, res) => {
  const result = await organizationService.cloneOrganization(
    req.params.orgId,
    req.body,
    req.auth.user,
    req,
  );

  res.status(201).json(result);
});

const archiveOrganization = asyncHandler(async (req, res) => {
  const result = await organizationService.archiveOrganization(req.params.orgId, req.auth.user, req);
  res.status(200).json(result);
});

const restoreOrganization = asyncHandler(async (req, res) => {
  const result = await organizationService.restoreOrganization(req.params.orgId, req.auth.user, req);
  res.status(200).json(result);
});

const deleteOrganization = asyncHandler(async (req, res) => {
  try {
    await organizationService.deleteOrganization(req.params.orgId, req.auth.user, req);
  } catch (error) {
    if (error && error.statusCode) {
      await auditService.logAction({
        req,
        userId: req.auth.user.id,
        action: 'organization.delete_failed',
        entityType: 'organization',
        entityId: req.params.orgId,
        statusCode: error.statusCode,
        metadata: {
          message: error.message,
          details: error.details || {},
        },
      });
    }

    throw error;
  }

  res.status(204).send();
});

const listRelationships = asyncHandler(async (req, res) => {
  const result = await organizationService.listRelationships(req.params.orgId, req.auth.user);

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'relationships.listed',
    entityType: 'organization',
    entityId: req.params.orgId,
    statusCode: 200,
    metadata: {
      totalCount: result.totalCount,
    },
  });

  res.status(200).json(result);
});

const createRelationship = asyncHandler(async (req, res) => {
  const result = await organizationService.createRelationship(
    req.params.orgId,
    req.body,
    req.auth.user,
    req,
  );

  res.status(201).json(result);
});

const deleteRelationship = asyncHandler(async (req, res) => {
  try {
    await organizationService.deleteRelationship(
      req.params.orgId,
      req.params.relationshipId,
      req.auth.user,
      req,
    );
  } catch (error) {
    if (error && error.statusCode) {
      await auditService.logAction({
        req,
        userId: req.auth.user.id,
        action: 'relationship.delete_failed',
        entityType: 'relationship',
        entityId: req.params.relationshipId,
        statusCode: error.statusCode,
        metadata: {
          orgId: req.params.orgId,
          message: error.message,
          details: error.details || {},
        },
      });
    }

    throw error;
  }

  res.status(204).send();
});

module.exports = {
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
