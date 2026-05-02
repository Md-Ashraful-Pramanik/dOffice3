const asyncHandler = require('../../utils/async-handler');
const auditService = require('../audits/audit.service');
const notificationService = require('./notification.service');

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

const listNotifications = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await notificationService.listNotifications(req.query, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'notifications.list_failed', 'user', req.auth.user.id, error);
    throw error;
  }

  res.status(200).json(result);
});

const markNotificationRead = asyncHandler(async (req, res) => {
  try {
    await notificationService.markNotificationRead(req.params.notificationId, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'notifications.read_mark_failed', 'notification', req.params.notificationId, error);
    throw error;
  }

  res.status(204).end();
});

const markAllNotificationsRead = asyncHandler(async (req, res) => {
  try {
    await notificationService.markAllNotificationsRead(req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'notifications.read_all_mark_failed', 'user', req.auth.user.id, error);
    throw error;
  }

  res.status(204).end();
});

const getNotificationPreferences = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await notificationService.getNotificationPreferences(req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'notification_preferences.get_failed', 'user', req.auth.user.id, error);
    throw error;
  }

  res.status(200).json(result);
});

const updateNotificationPreferences = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await notificationService.updateNotificationPreferences(req.body, req.auth.user, req);
  } catch (error) {
    await logFailure(req, 'notification_preferences.update_failed', 'user', req.auth.user.id, error);
    throw error;
  }

  res.status(200).json(result);
});

module.exports = {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getNotificationPreferences,
  updateNotificationPreferences,
};
