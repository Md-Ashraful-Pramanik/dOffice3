const asyncHandler = require('../../utils/async-handler');
const auditService = require('../audits/audit.service');
const fileService = require('./file.service');

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

const uploadFile = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await fileService.uploadFile({
      file: req.file,
      fields: req.body || {},
      user: req.auth.user,
      req,
    });
  } catch (error) {
    await logFailure(req, 'files.upload_failed', 'user', req.auth.user.id, error);
    throw error;
  }

  res.status(201).json(result);
});

const getFileMetadata = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await fileService.getFileMetadata(req.params.fileId, req.auth.user);
  } catch (error) {
    await logFailure(req, 'files.get_failed', 'file', req.params.fileId, error);
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'files.viewed',
    entityType: 'file',
    entityId: req.params.fileId,
    statusCode: 200,
  });

  res.status(200).json(result);
});

const downloadFile = asyncHandler(async (req, res) => {
  let file;
  try {
    file = await fileService.getFileDownload(req.params.fileId, req.auth.user);
  } catch (error) {
    await logFailure(req, 'files.download_failed', 'file', req.params.fileId, error);
    throw error;
  }

  await auditService.logAction({
    req,
    userId: req.auth.user.id,
    action: 'files.downloaded',
    entityType: 'file',
    entityId: req.params.fileId,
    statusCode: 200,
  });

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
  res.status(200).send(file.content);
});

const deleteFile = asyncHandler(async (req, res) => {
  try {
    await fileService.deleteFile(req.params.fileId, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'files.delete_failed', 'file', req.params.fileId, error);
    throw error;
  }

  res.status(204).end();
});

module.exports = {
  uploadFile,
  getFileMetadata,
  downloadFile,
  deleteFile,
};
