const { AppError, validationError } = require('../../utils/errors');
const auditService = require('../audits/audit.service');
const notificationRepository = require('./notification.repository');

const NOTIFICATION_TYPES = new Set(['mention', 'reply', 'reaction', 'channel_invite', 'system']);

function notFound() {
  return new AppError(404, 'Resource not found.');
}

function parsePagination(rawQuery) {
  const errors = {};

  if (rawQuery.limit !== undefined && (!Number.isInteger(Number(rawQuery.limit)) || Number(rawQuery.limit) < 1)) {
    errors.limit = ['must be an integer greater than or equal to 1'];
  }

  if (rawQuery.offset !== undefined && (!Number.isInteger(Number(rawQuery.offset)) || Number(rawQuery.offset) < 0)) {
    errors.offset = ['must be an integer greater than or equal to 0'];
  }

  if (rawQuery.type !== undefined && !NOTIFICATION_TYPES.has(String(rawQuery.type).trim())) {
    errors.type = ['is invalid'];
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  return {
    unread: String(rawQuery.unread || '').toLowerCase() === 'true',
    type: rawQuery.type ? String(rawQuery.type).trim() : null,
    limit: rawQuery.limit !== undefined ? Number(rawQuery.limit) : 30,
    offset: rawQuery.offset !== undefined ? Number(rawQuery.offset) : 0,
  };
}

function isBoolean(value) {
  return typeof value === 'boolean';
}

function validatePreferencePayload(body) {
  const preferences = body && body.preferences;
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    throw validationError({ preferences: ["can't be blank"] });
  }

  const errors = {};

  const channels = ['email', 'push', 'inApp'];
  for (const channel of channels) {
    if (preferences[channel] !== undefined) {
      const config = preferences[channel];
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        errors[channel] = ['must be an object'];
      } else {
        for (const key of ['mentions', 'directMessages', 'channelActivity']) {
          if (!isBoolean(config[key])) {
            errors[channel] = ['is invalid'];
            break;
          }
        }
      }
    }
  }

  if (preferences.muteChannels !== undefined) {
    if (!Array.isArray(preferences.muteChannels) || preferences.muteChannels.some((id) => typeof id !== 'string')) {
      errors.muteChannels = ['is invalid'];
    }
  }

  if (preferences.doNotDisturb !== undefined) {
    const dnd = preferences.doNotDisturb;
    if (!dnd || typeof dnd !== 'object' || Array.isArray(dnd)) {
      errors.doNotDisturb = ['must be an object'];
    } else if (!isBoolean(dnd.enabled)) {
      errors.doNotDisturb = ['is invalid'];
    }
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  return preferences;
}

async function listNotifications(rawQuery, user, req) {
  const query = parsePagination(rawQuery);

  const result = await notificationRepository.listNotifications(user.id, query);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'notifications.listed',
    entityType: 'user',
    entityId: user.id,
    statusCode: 200,
    metadata: {
      totalCount: result.totalCount,
      unreadCount: result.unreadCount,
      limit: query.limit,
      offset: query.offset,
    },
  });

  return {
    notifications: result.notifications,
    totalCount: result.totalCount,
    unreadCount: result.unreadCount,
    limit: query.limit,
    offset: query.offset,
  };
}

async function markNotificationRead(notificationId, user, req) {
  const updated = await notificationRepository.markNotificationRead(notificationId, user.id);
  if (!updated) throw notFound();

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'notifications.read_marked',
    entityType: 'notification',
    entityId: notificationId,
    statusCode: 204,
  });
}

async function markAllNotificationsRead(user, req) {
  await notificationRepository.markAllNotificationsRead(user.id);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'notifications.read_all_marked',
    entityType: 'user',
    entityId: user.id,
    statusCode: 204,
  });
}

async function getNotificationPreferences(user, req) {
  let preferences = await notificationRepository.findNotificationPreferences(user.id);
  if (!preferences) {
    preferences = notificationRepository.DEFAULT_PREFERENCES;
    await notificationRepository.upsertNotificationPreferences(user.id, preferences);
  }

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'notification_preferences.viewed',
    entityType: 'user',
    entityId: user.id,
    statusCode: 200,
  });

  return { preferences };
}

async function updateNotificationPreferences(body, user, req) {
  const preferences = validatePreferencePayload(body);
  const updated = await notificationRepository.upsertNotificationPreferences(user.id, preferences);

  await auditService.logAction({
    req,
    userId: user.id,
    action: 'notification_preferences.updated',
    entityType: 'user',
    entityId: user.id,
    statusCode: 200,
  });

  return { preferences: updated };
}

module.exports = {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getNotificationPreferences,
  updateNotificationPreferences,
};
