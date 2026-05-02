const { query } = require('../../db/pool');

function mapFile(row) {
  if (!row) return null;

  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: Number(row.size),
    uploadedBy: row.uploaded_by_user_id,
    orgId: row.org_id,
    context: row.context,
    contextId: row.context_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    content: row.content,
  };
}

async function createFile(input, db = { query }) {
  const result = await db.query(
    `INSERT INTO files (
      id,
      filename,
      mime_type,
      size,
      content,
      uploaded_by_user_id,
      org_id,
      context,
      context_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      input.id,
      input.filename,
      input.mimeType,
      input.size,
      input.content,
      input.uploadedByUserId,
      input.orgId,
      input.context,
      input.contextId || null,
    ],
  );

  return mapFile(result.rows[0]);
}

async function findFileById(fileId, db = { query }) {
  const result = await db.query(
    `SELECT *
     FROM files
     WHERE id = $1
       AND deleted_at IS NULL`,
    [fileId],
  );

  return mapFile(result.rows[0]);
}

async function softDeleteFile(fileId, db = { query }) {
  const result = await db.query(
    `UPDATE files
     SET deleted_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND deleted_at IS NULL`,
    [fileId],
  );

  return result.rowCount;
}

async function findChannelById(channelId, db = { query }) {
  const result = await db.query(
    `SELECT id, org_id, type
     FROM channels
     WHERE id = $1
       AND deleted_at IS NULL`,
    [channelId],
  );

  return result.rows[0] || null;
}

async function findConversationById(conversationId, db = { query }) {
  const result = await db.query(
    `SELECT id
     FROM conversations
     WHERE id = $1
       AND deleted_at IS NULL`,
    [conversationId],
  );

  return result.rows[0] || null;
}

async function findConversationParticipant(conversationId, userId, db = { query }) {
  const result = await db.query(
    `SELECT 1
     FROM conversation_participants
     WHERE conversation_id = $1
       AND user_id = $2
       AND deleted_at IS NULL`,
    [conversationId, userId],
  );

  return result.rowCount > 0;
}

async function findChannelMembership(channelId, userId, db = { query }) {
  const result = await db.query(
    `SELECT role
     FROM channel_members
     WHERE channel_id = $1
       AND user_id = $2
       AND deleted_at IS NULL`,
    [channelId, userId],
  );

  return result.rows[0] || null;
}

async function findOrganizationById(orgId, db = { query }) {
  const result = await db.query(
    `SELECT id
     FROM organizations
     WHERE id = $1
       AND deleted_at IS NULL`,
    [orgId],
  );

  return result.rows[0] || null;
}

module.exports = {
  mapFile,
  createFile,
  findFileById,
  softDeleteFile,
  findChannelById,
  findConversationById,
  findConversationParticipant,
  findChannelMembership,
  findOrganizationById,
};
