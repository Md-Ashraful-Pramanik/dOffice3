const express = require('express');
const multer = require('multer');
const authenticate = require('../middlewares/authenticate');
const { validationError } = require('../utils/errors');
const auditService = require('../modules/audits/audit.service');
const fileController = require('../modules/files/file.controller');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

function uploadSingleFileWithAudit(req, res, next) {
  upload.single('file')(req, res, async (error) => {
    if (!error) {
      next();
      return;
    }

    const appError = error.code === 'LIMIT_FILE_SIZE'
      ? validationError({ file: 'File size exceeds 25MB limit.' })
      : validationError({ file: 'Invalid file upload.' });

    const userId = req.auth && req.auth.user ? req.auth.user.id : null;
    if (userId) {
      await auditService.logAction({
        req,
        userId,
        action: 'files.upload_failed',
        entityType: 'user',
        entityId: userId,
        statusCode: appError.statusCode,
        metadata: {
          message: appError.message,
          details: appError.details || {},
        },
      });
    }

    next(appError);
  });
}

router.post('/files', authenticate, uploadSingleFileWithAudit, fileController.uploadFile);
router.get('/files/:fileId', authenticate, fileController.getFileMetadata);
router.get('/files/:fileId/download', authenticate, fileController.downloadFile);
router.delete('/files/:fileId', authenticate, fileController.deleteFile);

module.exports = router;
