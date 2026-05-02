const express = require('express');
const multer = require('multer');
const authenticate = require('../middlewares/authenticate');
const fileController = require('../modules/files/file.controller');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

router.post('/files', authenticate, upload.single('file'), fileController.uploadFile);
router.get('/files/:fileId', authenticate, fileController.getFileMetadata);
router.get('/files/:fileId/download', authenticate, fileController.downloadFile);
router.delete('/files/:fileId', authenticate, fileController.deleteFile);

module.exports = router;
