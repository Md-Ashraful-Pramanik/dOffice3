const { AppError, validationError } = require('../../utils/errors');
const { generateId } = require('../../utils/id');
const auditService = require('../audits/audit.service');
const organizationRepository = require('../organizations/organization.repository');
const fileRepository = require('./file.repository');

const FILE_CONTEXTS = new Set(['channel', 'conversation', 'avatar']);

function isSuperAdmin(user) {
  return (user.roleIds || []).some((role) => ['super_admin', 'role_super_admin'].includes(String(role).toLowerCase()));
}

function isOrgAdmin(user) {
  return isSuperAdmin(user) || (user.roleIds || []).some((role) => ['org_admin', 'role_org_admin'].includes(String(role).toLowerCase()));
}

function forbidden() {
  return new AppError(403, 'You do not have permission to perform this action.');
}

function notFound() {
  return new AppError(404, 'Resource not found.');
}

function toFileObject(file) {
  return {
    id: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    size: file.size,
    url: `/api/v1/files/${file.id}/download`,
    uploadedBy: file.uploadedBy,
    orgId: file.orgId,
    createdAt: file.createdAt,
  };
}

async function ensureOrgAccess(orgId, user) {
  const org = await fileRepository.findOrganizationById(orgId);
  if (!org) throw notFound();

  if (isSuperAdmin(user)) return;

  if (isOrgAdmin(user)) {
    const allowedIds = await organizationRepository.listDescendantIds(user.orgId);
    if (!allowedIds.includes(orgId)) {
      throw forbidden();
    }
    return;
  }

  if (user.orgId !== orgId) {
    throw forbidden();
  }
}

async function ensureContextAccess(context, contextId, orgId, user) {
  if (context === 'channel') {
    if (!contextId) throw validationError({ contextId: "can't be blank" });

    const channel = await fileRepository.findChannelById(contextId);
    if (!channel || channel.org_id !== orgId) throw notFound();

    if (channel.type === 'private' && !isOrgAdmin(user)) {
      const membership = await fileRepository.findChannelMembership(contextId, user.id);
      if (!membership) throw forbidden();
    }
  }

  if (context === 'conversation') {
    if (!contextId) throw validationError({ contextId: "can't be blank" });

    const conversation = await fileRepository.findConversationById(contextId);
    if (!conversation) throw notFound();

    const isParticipant = await fileRepository.findConversationParticipant(contextId, user.id);
    if (!isParticipant) throw forbidden();
  }
}

async function uploadFile({ file, fields, user, req }) {
  if (!file) {
    throw validationError({ file: "can't be blank" });
  }

  const orgId = fields.orgId ? String(fields.orgId).trim() : '';
  const context = fields.context ? String(fields.context).trim().toLowerCase() : '';
  const contextId = fields.contextId ? String(fields.contextId).trim() : null;

  const errors = {};

  if (!orgId) errors.orgId = "can't be blank";
  if (!context) errors.context = "can't be blank";
  else if (!FILE_CONTEXTS.has(context)) errors.context = 'is invalid';

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  await ensureOrgAccess(orgId, user);
  await ensureContextAccess(context, contextId, orgId, user);

  const created = await fileRepository.createFile({
    id: generateId('file'),
    filename: file.originalname,
    mimeType: file.mimetype || 'application/octet-stream',
    size: file.size,
    content: file.buffer,
    uploadedByUserId: user.id,
    orgId,
    context,
    contextId,
  });

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'files.uploaded',
    entityType: 'file',
    entityId: created.id,
    statusCode: 201,
    metadata: { orgId, context, contextId },
  });

  return { file: toFileObject(created) };
}

async function getFileMetadata(fileId, user) {
  const file = await fileRepository.findFileById(fileId);
  if (!file) throw notFound();

  await ensureOrgAccess(file.orgId, user);

  return { file: toFileObject(file) };
}

async function getFileDownload(fileId, user) {
  const file = await fileRepository.findFileById(fileId);
  if (!file) throw notFound();

  await ensureOrgAccess(file.orgId, user);

  return file;
}

async function deleteFile(fileId, user, req) {
  const file = await fileRepository.findFileById(fileId);
  if (!file) throw notFound();

  await ensureOrgAccess(file.orgId, user);

  if (!isOrgAdmin(user) && file.uploadedBy !== user.id) {
    throw forbidden();
  }

  const deleted = await fileRepository.softDeleteFile(fileId);
  if (!deleted) throw notFound();

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'files.deleted',
    entityType: 'file',
    entityId: fileId,
    statusCode: 204,
  });
}

module.exports = {
  uploadFile,
  getFileMetadata,
  getFileDownload,
  deleteFile,
};
