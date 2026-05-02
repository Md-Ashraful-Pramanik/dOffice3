const express = require('express');
const authenticate = require('../middlewares/authenticate');
const channelController = require('../modules/channels/channel.controller');

const router = express.Router();

// ── Channel categories (reorder must come before :categoryId) ─────────────────
router.get(
  '/organizations/:orgId/channel-categories',
  authenticate,
  channelController.listCategories,
);

router.post(
  '/organizations/:orgId/channel-categories',
  authenticate,
  channelController.createCategory,
);

router.put(
  '/organizations/:orgId/channel-categories/reorder',
  authenticate,
  channelController.reorderCategories,
);

router.put(
  '/organizations/:orgId/channel-categories/:categoryId',
  authenticate,
  channelController.updateCategory,
);

router.delete(
  '/organizations/:orgId/channel-categories/:categoryId',
  authenticate,
  channelController.deleteCategory,
);

// ── Channels ──────────────────────────────────────────────────────────────────
router.get(
  '/organizations/:orgId/channels',
  authenticate,
  channelController.listChannels,
);

router.post(
  '/organizations/:orgId/channels',
  authenticate,
  channelController.createChannel,
);

router.get(
  '/channels/:channelId',
  authenticate,
  channelController.getChannel,
);

router.put(
  '/channels/:channelId',
  authenticate,
  channelController.updateChannel,
);

router.delete(
  '/channels/:channelId',
  authenticate,
  channelController.deleteChannel,
);

// ── Channel membership ────────────────────────────────────────────────────────
router.post(
  '/channels/:channelId/join',
  authenticate,
  channelController.joinChannel,
);

router.post(
  '/channels/:channelId/leave',
  authenticate,
  channelController.leaveChannel,
);

router.post(
  '/channels/:channelId/invite',
  authenticate,
  channelController.inviteToChannel,
);

router.get(
  '/channels/:channelId/members',
  authenticate,
  channelController.listMembers,
);

router.put(
  '/channels/:channelId/members/:userId',
  authenticate,
  channelController.setMemberRole,
);

router.delete(
  '/channels/:channelId/members/:userId',
  authenticate,
  channelController.removeMember,
);

module.exports = router;
