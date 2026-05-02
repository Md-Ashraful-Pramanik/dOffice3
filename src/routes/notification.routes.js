const express = require('express');
const authenticate = require('../middlewares/authenticate');
const notificationController = require('../modules/notifications/notification.controller');

const router = express.Router();

router.get('/notifications', authenticate, notificationController.listNotifications);
router.put('/notifications/:notificationId/read', authenticate, notificationController.markNotificationRead);
router.post('/notifications/read-all', authenticate, notificationController.markAllNotificationsRead);
router.get('/user/notification-preferences', authenticate, notificationController.getNotificationPreferences);
router.put('/user/notification-preferences', authenticate, notificationController.updateNotificationPreferences);

module.exports = router;
