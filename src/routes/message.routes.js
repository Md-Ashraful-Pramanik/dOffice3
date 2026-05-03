const express = require('express');
const authenticate = require('../middlewares/authenticate');
const messageController = require('../modules/messages/message.controller');

const router = express.Router();

router.get('/messages/search', authenticate, messageController.searchMessages);
router.post('/messages/:messageId/report', authenticate, messageController.reportMessage);
router.get(
  '/organizations/:orgId/moderation/reports',
  authenticate,
  messageController.listModerationReports,
);
router.put(
  '/organizations/:orgId/moderation/reports/:reportId',
  authenticate,
  messageController.resolveModerationReport,
);

router.get('/conversations', authenticate, messageController.listConversations);
router.get('/conversations/:conversationId', authenticate, messageController.getConversation);
router.post('/conversations', authenticate, messageController.createConversation);
router.post(
  '/conversations/:conversationId/participants',
  authenticate,
  messageController.addConversationParticipants,
);
router.delete(
  '/conversations/:conversationId/participants/:userId',
  authenticate,
  messageController.removeConversationParticipant,
);

router.get('/channels/:channelId/messages', authenticate, messageController.listChannelMessages);
router.get('/conversations/:conversationId/messages', authenticate, messageController.listConversationMessages);
router.post('/channels/:channelId/messages', authenticate, messageController.sendChannelMessage);
router.post('/conversations/:conversationId/messages', authenticate, messageController.sendConversationMessage);

router.get('/channels/:channelId/messages/:messageId', authenticate, messageController.getChannelMessage);
router.put('/channels/:channelId/messages/:messageId', authenticate, messageController.updateChannelMessage);
router.delete('/channels/:channelId/messages/:messageId', authenticate, messageController.deleteChannelMessage);
router.post('/channels/:channelId/messages/:messageId/reactions', authenticate, messageController.addChannelMessageReaction);
router.delete('/channels/:channelId/messages/:messageId/reactions/:emoji', authenticate, messageController.removeChannelMessageReaction);

router.get('/conversations/:conversationId/messages/:messageId', authenticate, messageController.getConversationMessage);
router.put('/conversations/:conversationId/messages/:messageId', authenticate, messageController.updateConversationMessage);
router.delete('/conversations/:conversationId/messages/:messageId', authenticate, messageController.deleteConversationMessage);
router.post('/conversations/:conversationId/messages/:messageId/reactions', authenticate, messageController.addConversationMessageReaction);
router.delete('/conversations/:conversationId/messages/:messageId/reactions/:emoji', authenticate, messageController.removeConversationMessageReaction);

router.get('/messages/:messageId/edits', authenticate, messageController.getMessageEdits);
router.get('/messages/:messageId/thread', authenticate, messageController.getThread);
router.post('/messages/:messageId/thread', authenticate, messageController.postThreadReply);
router.post('/messages/:messageId/reactions', authenticate, messageController.addReaction);
router.delete('/messages/:messageId/reactions/:emoji', authenticate, messageController.removeReaction);
router.post('/messages/:messageId/pin', authenticate, messageController.pinMessage);
router.delete('/messages/:messageId/pin', authenticate, messageController.unpinMessage);

router.get('/messages/:messageId', authenticate, messageController.getMessage);
router.put('/messages/:messageId', authenticate, messageController.updateMessage);
router.delete('/messages/:messageId', authenticate, messageController.deleteMessage);

router.get('/channels/:channelId/pins', authenticate, messageController.listChannelPins);

router.get('/user/bookmarks', authenticate, messageController.listBookmarks);
router.post('/user/bookmarks', authenticate, messageController.addBookmark);
router.delete('/user/bookmarks/:messageId', authenticate, messageController.removeBookmark);

router.post('/channels/:channelId/polls', authenticate, messageController.createPoll);
router.post('/polls/:pollId/vote', authenticate, messageController.votePoll);
router.get('/polls/:pollId', authenticate, messageController.getPoll);

module.exports = router;
