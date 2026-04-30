# Digital Office — API Documentation

> REST API endpoints for **Organization & Hierarchy Management**, **User & Role Management**, and **Internal Messaging System**. Real-time features (messaging, notifications, presence) use **WebSocket** connections.

**Base URL:** `/api/v1`

---

## Table of Contents

1. [Authentication](#authentication)
2. [Module 1 — Organization &amp; Hierarchy Management](#module-1--organization--hierarchy-management)
3. [Module 2 — User &amp; Role Management](#module-2--user--role-management)
4. [Module 3 — Internal Messaging System](#module-3--internal-messaging-system)
5. [Audits](#audits)
6. [WebSocket Events](#websocket-events)
7. [Response Formats](#response-formats)
8. [Error Responses](#error-responses)

---

## Authentication

### Authentication Header

You can read the authentication header from the headers of the request

`Authorization: Bearer jwt.token.here`

### Login

`POST /api/v1/auth/login`

Example request body:

```json
{
  "user": {
    "email": "admin@acme.org",
    "password": "s3cur3P@ss"
  }
}
```

No authentication required, returns a [User](#user-object)

Required fields: `email`, `password`

### Register

`POST /api/v1/auth/register`

Example request body:

```json
{
  "user": {
    "username": "john.doe",
    "email": "john@acme.org",
    "password": "s3cur3P@ss"
  }
}
```

No authentication required. At the first request one super admin will be created then all subsequent request needs to be failed. It returns a [User](#user-object). There is another API for creating organization's user.

Required fields: `username`, `email`, `password`

### Logout

`POST /api/v1/auth/logout`

Authentication required, invalidates current session

---

## Module 1 — Organization & Hierarchy Management

### List Organizations

`GET /api/v1/organizations`

Query Parameters:

- `?search=acme` — filter by name
- `?status=active` — filter by status (`active`, `archived`, `deactivated`)
- `?parentId=org_abc123` — list direct children of a parent org
- `?limit=20` — limit number of results (default 20)
- `?offset=0` — offset for pagination (default 0)

Authentication required (Super Admin sees all; Org Admin sees own + children), returns [Multiple Organizations](#multiple-organizations)

### Get Organization Tree

`GET /api/v1/organizations/tree`

Query Parameters:

- `?rootId=org_abc123` — start tree from a specific node (default: all root orgs the user has access to)
- `?depth=3` — max depth to expand (default: unlimited)

Authentication required, returns the full nested [Organization Tree](#organization-tree)

### Get Organization

`GET /api/v1/organizations/:orgId`

Authentication required, returns a [Single Organization](#single-organization)

### Create Organization

`POST /api/v1/organizations`

Example request body:

```json
{
  "organization": {
    "name": "ACME Corporation",
    "code": "ACME",
    "type": "root",
    "logo": "https://cdn.example.com/acme-logo.png",
    "metadata": {
      "address": "123 Corporate Blvd",
      "country": "BD",
      "timezone": "Asia/Dhaka"
    }
  }
}
```

Authentication required (Super Admin), returns [Single Organization](#single-organization)

Required fields: `name`, `code`

Optional fields: `type`, `logo`, `metadata`, `parentId`

### Create Sub-Organization

`POST /api/v1/organizations/:orgId/children`

Example request body:

```json
{
  "organization": {
    "name": "Engineering Division",
    "code": "ACME-ENG",
    "type": "division",
    "metadata": {
      "floor": "5th",
      "building": "Tower-A"
    }
  }
}
```

Authentication required (Org Admin or above), returns [Single Organization](#single-organization)

Required fields: `name`, `code`

Optional fields: `type`, `logo`, `metadata`

### Update Organization

`PUT /api/v1/organizations/:orgId`

Example request body:

```json
{
  "organization": {
    "name": "ACME Corp (Renamed)",
    "metadata": {
      "address": "456 Enterprise Ave"
    }
  }
}
```

Authentication required (Org Admin or above), returns updated [Single Organization](#single-organization)

Optional fields: `name`, `code`, `logo`, `type`, `metadata`

### Move Organization

`POST /api/v1/organizations/:orgId/move`

Example request body:

```json
{
  "newParentId": "org_xyz789"
}
```

Authentication required (Super Admin or both source & target Org Admin), returns updated [Single Organization](#single-organization)

Required fields: `newParentId`

### Merge Organizations

`POST /api/v1/organizations/merge`

Example request body:

```json
{
  "sourceOrgId": "org_source123",
  "targetOrgId": "org_target456"
}
```

Authentication required (Super Admin), returns updated [Single Organization](#single-organization) of the target

Required fields: `sourceOrgId`, `targetOrgId`

### Clone Organization

`POST /api/v1/organizations/:orgId/clone`

Example request body:

```json
{
  "newName": "ACME West Branch",
  "newCode": "ACME-WEST",
  "includeRoles": true,
  "includeNavConfig": true,
  "includeUsers": false
}
```

Authentication required (Super Admin or Org Admin), returns the newly created [Single Organization](#single-organization)

Required fields: `newName`, `newCode`

Optional fields: `includeRoles`, `includeNavConfig`, `includeUsers`

### Archive Organization

`POST /api/v1/organizations/:orgId/archive`

Authentication required (Super Admin or Org Admin), returns updated [Single Organization](#single-organization) with `status: "archived"`

### Restore Organization

`POST /api/v1/organizations/:orgId/restore`

Authentication required (Super Admin or Org Admin), returns updated [Single Organization](#single-organization) with `status: "active"`

### Delete Organization

`DELETE /api/v1/organizations/:orgId`

Authentication required (Super Admin). Soft delete only if no active children or users remain. Returns `204 No Content`.

### Inter-Organization Relationships

#### List Relationships

`GET /api/v1/organizations/:orgId/relationships`

Authentication required, returns [Multiple Relationships](#multiple-relationships)

#### Create Relationship

`POST /api/v1/organizations/:orgId/relationships`

Example request body:

```json
{
  "relationship": {
    "targetOrgId": "org_partner456",
    "type": "shared_services",
    "description": "Shared IT infrastructure",
    "sharedModules": ["messaging", "tasks"]
  }
}
```

Authentication required (Org Admin of both orgs), returns [Single Relationship](#single-relationship)

Required fields: `targetOrgId`, `type`

Optional fields: `description`, `sharedModules`

#### Delete Relationship

`DELETE /api/v1/organizations/:orgId/relationships/:relationshipId`

Authentication required (Org Admin of either org), returns `204 No Content`

---

## Module 2 — User & Role Management

### Users

#### Get Current User

`GET /api/v1/user`

Authentication required, returns the [User](#user-object) for the currently authenticated user

#### Update Current User

`PUT /api/v1/user`

Example request body:

```json
{
  "user": {
    "bio": "Senior engineer at ACME",
    "avatar": "https://cdn.example.com/avatars/john.png",
    "contactInfo": {
      "phone": "+8801711000000"
    }
  }
}
```

Authentication required, returns updated [User](#user-object)

Accepted fields: `password`, `avatar`, `bio`, `designation`, `contactInfo`

#### List Users in Organization

`GET /api/v1/organizations/:orgId/users`

Query Parameters:

- `?search=john` — search by name, username, email, or employee ID
- `?status=active` — filter by status (`active`, `suspended`, `on-leave`, `deactivated`, `retired`)
- `?department=engineering` — filter by department
- `?designation=manager` — filter by designation
- `?location=dhaka` — filter by location
- `?roleId=role_abc` — filter by assigned role
- `?limit=20` — limit (default 20)
- `?offset=0` — offset (default 0)

Authentication required, returns [Multiple Users](#multiple-users)

#### Get User Profile

`GET /api/v1/users/:userId`

Authentication required, returns a [User Profile](#user-profile)

#### Create User (Admin On-boarding)

`POST /api/v1/organizations/:orgId/users`

Example request body:

```json
{
  "user": {
    "username": "jane.doe",
    "email": "jane@acme.org",
    "password": "tempP@ss123",
    "name": "Jane Doe",
    "employeeId": "EMP-042",
    "designation": "Software Engineer",
    "department": "Engineering",
    "roleIds": ["role_employee"],
    "contactInfo": {
      "phone": "+8801712000000",
      "address": "Dhaka, Bangladesh"
    }
  }
}
```

Authentication required (Org Admin or above), returns [User](#user-object)

Required fields: `username`, `email`, `password`, `name`

Optional fields: `employeeId`, `designation`, `department`, `roleIds`, `contactInfo`, `avatar`, `bio`

#### Update User (Admin)

`PUT /api/v1/users/:userId`

Example request body:

```json
{
  "user": {
    "status": "suspended",
    "designation": "Lead Engineer",
    "roleIds": ["role_manager"]
  }
}
```

Authentication required (Org Admin or above), returns updated [User](#user-object)

Accepted fields: `name`, `designation`, `department`, `status`, `roleIds`, `contactInfo`, `avatar`, `bio`

#### Deactivate User

`POST /api/v1/users/:userId/deactivate`

Authentication required (Org Admin or above), returns updated [User](#user-object) with `status: "deactivated"`

#### Reactivate User

`POST /api/v1/users/:userId/reactivate`

Authentication required (Org Admin or above), returns updated [User](#user-object) with `status: "active"`

#### Delete User

`DELETE /api/v1/users/:userId`

Authentication required (Super Admin), returns `204 No Content`

### User Directory

`GET /api/v1/organizations/:orgId/directory`

Query Parameters:

- `?search=john` — full-text search on name, designation, department, skill
- `?department=engineering`
- `?designation=manager`
- `?location=dhaka`
- `?skill=python`
- `?limit=50`
- `?offset=0`

Authentication required, returns [Directory Listing](#directory-listing)

### Organization Chart

`GET /api/v1/organizations/:orgId/orgchart`

Authentication required, returns [Org Chart](#org-chart) (hierarchical user structure linked to org hierarchy)

### Sessions

#### List Active Sessions

`GET /api/v1/user/sessions`

Authentication required, returns [Multiple Sessions](#multiple-sessions)

#### Revoke Session

`DELETE /api/v1/user/sessions/:sessionId`

Authentication required, returns `204 No Content`

#### Revoke All Other Sessions

`POST /api/v1/user/sessions/revoke-others`

Authentication required, returns `204 No Content`

### Roles

#### List Roles

`GET /api/v1/organizations/:orgId/roles`

Query Parameters:

- `?search=admin` — search by role name
- `?type=custom` — filter by `system` or `custom`

Authentication required, returns [Multiple Roles](#multiple-roles)

#### Get Role

`GET /api/v1/organizations/:orgId/roles/:roleId`

Authentication required, returns [Single Role](#single-role) (includes full permission set)

#### Create Role

`POST /api/v1/organizations/:orgId/roles`

Example request body:

```json
{
  "role": {
    "name": "Department Head",
    "description": "Can manage department users and tasks",
    "inheritsFrom": "role_manager",
    "permissions": [
      { "module": "messaging", "action": "create_channel", "allow": true },
      { "module": "messaging", "action": "delete_channel", "allow": false },
      { "module": "tasks", "action": "*", "allow": true },
      { "module": "users", "action": "create", "allow": true },
      { "module": "users", "action": "delete", "allow": false }
    ]
  }
}
```

Authentication required (Org Admin), returns [Single Role](#single-role)

Required fields: `name`, `permissions`

Optional fields: `description`, `inheritsFrom`

#### Update Role

`PUT /api/v1/organizations/:orgId/roles/:roleId`

Example request body:

```json
{
  "role": {
    "description": "Updated description",
    "permissions": [
      { "module": "messaging", "action": "delete_channel", "allow": true }
    ]
  }
}
```

Authentication required (Org Admin), returns updated [Single Role](#single-role)

Optional fields: `name`, `description`, `permissions`, `inheritsFrom`

#### Delete Role

`DELETE /api/v1/organizations/:orgId/roles/:roleId`

Authentication required (Org Admin). Cannot delete system roles. Returns `204 No Content`.

#### Assign Role to User

`POST /api/v1/users/:userId/roles`

Example request body:

```json
{
  "roleId": "role_dept_head",
  "orgId": "org_abc123"
}
```

Authentication required (Org Admin), returns updated [User](#user-object)

Required fields: `roleId`, `orgId`

#### Remove Role from User

`DELETE /api/v1/users/:userId/roles/:roleId`

Authentication required (Org Admin), returns updated [User](#user-object)

### Permissions

#### List All Permissions

`GET /api/v1/permissions`

Authentication required, returns [Permission List](#permission-list) — the full catalog of available permissions grouped by module

#### Get Effective Permissions for User

`GET /api/v1/users/:userId/permissions`

Query Parameters:

- `?orgId=org_abc123` — scope to a specific org (since a user may have different roles in different orgs)

Authentication required (self or Admin), returns computed [Effective Permissions](#effective-permissions) (roles + group overrides combined)

### Groups & Teams

#### List Teams

`GET /api/v1/organizations/:orgId/teams`

Query Parameters:

- `?search=backend`
- `?type=static` — `static` or `dynamic`
- `?limit=20`
- `?offset=0`

Authentication required, returns [Multiple Teams](#multiple-teams)

#### Get Team

`GET /api/v1/organizations/:orgId/teams/:teamId`

Authentication required, returns [Single Team](#single-team) (includes member list)

#### Create Team

`POST /api/v1/organizations/:orgId/teams`

Example request body:

```json
{
  "team": {
    "name": "Backend Squad",
    "description": "Backend development team",
    "type": "static",
    "memberIds": ["user_1", "user_2", "user_3"],
    "permissionOverrides": [
      { "module": "tasks", "action": "create_project", "allow": true }
    ]
  }
}
```

Authentication required (Org Admin or Manager), returns [Single Team](#single-team)

Required fields: `name`

Optional fields: `description`, `type`, `memberIds`, `permissionOverrides`, `dynamicFilter`

#### Create Dynamic Team

`POST /api/v1/organizations/:orgId/teams`

Example request body:

```json
{
  "team": {
    "name": "All Dhaka Managers",
    "type": "dynamic",
    "dynamicFilter": {
      "designation": "manager",
      "location": "dhaka"
    }
  }
}
```

Authentication required (Org Admin), returns [Single Team](#single-team)

Members are computed automatically based on `dynamicFilter`

#### Update Team

`PUT /api/v1/organizations/:orgId/teams/:teamId`

Authentication required (Org Admin or Team Lead), returns updated [Single Team](#single-team)

Optional fields: `name`, `description`, `permissionOverrides`, `dynamicFilter`

#### Delete Team

`DELETE /api/v1/organizations/:orgId/teams/:teamId`

Authentication required (Org Admin), returns `204 No Content`

#### Add Members to Team

`POST /api/v1/organizations/:orgId/teams/:teamId/members`

Example request body:

```json
{
  "userIds": ["user_4", "user_5"]
}
```

Authentication required (Org Admin or Team Lead), returns updated [Single Team](#single-team)

Required fields: `userIds`

#### Remove Member from Team

`DELETE /api/v1/organizations/:orgId/teams/:teamId/members/:userId`

Authentication required (Org Admin or Team Lead), returns `204 No Content`

### Delegation & Proxy

#### List Delegations

`GET /api/v1/users/:userId/delegations`

Query Parameters:

- `?status=active` — filter by `active`, `expired`, `revoked`

Authentication required (self or Admin), returns [Multiple Delegations](#multiple-delegations)

#### Create Delegation

`POST /api/v1/users/:userId/delegations`

Example request body:

```json
{
  "delegation": {
    "delegateUserId": "user_proxy42",
    "startDate": "2026-04-20T00:00:00Z",
    "endDate": "2026-04-30T23:59:59Z",
    "reason": "Annual leave",
    "scope": {
      "modules": ["tasks", "nothi"],
      "permissions": ["approve", "forward"]
    }
  }
}
```

Authentication required (self), returns [Single Delegation](#single-delegation)

Required fields: `delegateUserId`, `startDate`, `endDate`

Optional fields: `reason`, `scope`

#### Revoke Delegation

`DELETE /api/v1/users/:userId/delegations/:delegationId`

Authentication required (self or Admin), returns `204 No Content`

---

## Module 3 — Internal Messaging System

### Channels

#### List Channels

`GET /api/v1/organizations/:orgId/channels`

Query Parameters:

- `?search=general` — search by channel name
- `?type=public` — filter by `public`, `private`, `announcement`, `cross-org`
- `?categoryId=cat_123` — filter by category
- `?joined=true` — only channels the user has joined
- `?limit=50`
- `?offset=0`

Authentication required, returns [Multiple Channels](#multiple-channels)

#### Get Channel

`GET /api/v1/channels/:channelId`

Authentication required (must be a member for private channels), returns [Single Channel](#single-channel)

#### Create Channel

`POST /api/v1/organizations/:orgId/channels`

Example request body:

```json
{
  "channel": {
    "name": "backend-dev",
    "type": "public",
    "description": "Backend development discussions",
    "categoryId": "cat_engineering",
    "topic": "Sprint 42 — API Refactoring"
  }
}
```

Authentication required, returns [Single Channel](#single-channel)

Required fields: `name`, `type`

Optional fields: `description`, `categoryId`, `topic`, `memberIds` (for private), `e2ee` (boolean, for private only)

#### Update Channel

`PUT /api/v1/channels/:channelId`

Example request body:

```json
{
  "channel": {
    "description": "All backend-related talk",
    "topic": "Sprint 43 — Performance Tuning"
  }
}
```

Authentication required (channel admin or Org Admin), returns updated [Single Channel](#single-channel)

Optional fields: `name`, `description`, `topic`, `categoryId`, `type`

#### Delete Channel

`DELETE /api/v1/channels/:channelId`

Authentication required (channel admin or Org Admin), returns `204 No Content`

#### Join Channel

`POST /api/v1/channels/:channelId/join`

Authentication required (public channels only; for private use invite), returns [Single Channel](#single-channel)

#### Leave Channel

`POST /api/v1/channels/:channelId/leave`

Authentication required, returns `204 No Content`

#### Invite to Channel

`POST /api/v1/channels/:channelId/invite`

Example request body:

```json
{
  "userIds": ["user_5", "user_6"]
}
```

Authentication required (channel admin or member with invite permission), returns updated [Single Channel](#single-channel)

Required fields: `userIds`

#### Remove from Channel

`DELETE /api/v1/channels/:channelId/members/:userId`

Authentication required (channel admin), returns `204 No Content`

#### List Channel Members

`GET /api/v1/channels/:channelId/members`

Query Parameters:

- `?search=jane`
- `?role=admin` — filter by channel role (`admin`, `moderator`, `member`)
- `?limit=50`
- `?offset=0`

Authentication required, returns [Multiple Users](#multiple-users)

#### Set Channel Member Role

`PUT /api/v1/channels/:channelId/members/:userId`

Example request body:

```json
{
  "role": "moderator"
}
```

Authentication required (channel admin), returns updated member info

### Channel Categories

#### List Categories

`GET /api/v1/organizations/:orgId/channel-categories`

Authentication required, returns [Multiple Categories](#multiple-categories)

#### Create Category

`POST /api/v1/organizations/:orgId/channel-categories`

Example request body:

```json
{
  "category": {
    "name": "Engineering",
    "position": 1
  }
}
```

Authentication required (Org Admin), returns [Single Category](#single-category)

Required fields: `name`

Optional fields: `position`

#### Update Category

`PUT /api/v1/organizations/:orgId/channel-categories/:categoryId`

Authentication required (Org Admin), returns updated [Single Category](#single-category)

#### Delete Category

`DELETE /api/v1/organizations/:orgId/channel-categories/:categoryId`

Authentication required (Org Admin), returns `204 No Content`

#### Reorder Categories

`PUT /api/v1/organizations/:orgId/channel-categories/reorder`

Example request body:

```json
{
  "order": ["cat_engineering", "cat_general", "cat_hr"]
}
```

Authentication required (Org Admin), returns updated [Multiple Categories](#multiple-categories)

### Direct Messages & Group DMs

#### List Conversations

`GET /api/v1/conversations`

Query Parameters:

- `?type=dm` — filter by `dm` or `group`
- `?search=jane` — search by participant name
- `?limit=30`
- `?offset=0`

Authentication required, returns [Multiple Conversations](#multiple-conversations)

#### Get Conversation

`GET /api/v1/conversations/:conversationId`

Authentication required (must be a participant), returns [Single Conversation](#single-conversation)

#### Create Direct Message Conversation

`POST /api/v1/conversations`

Example request body:

```json
{
  "conversation": {
    "type": "dm",
    "participantIds": ["user_other42"]
  }
}
```

Authentication required, returns [Single Conversation](#single-conversation) (or returns existing if DM already exists between the two users)

Required fields: `type`, `participantIds`

#### Create Group DM

`POST /api/v1/conversations`

Example request body:

```json
{
  "conversation": {
    "type": "group",
    "name": "Project Alpha Chat",
    "participantIds": ["user_2", "user_3", "user_4"]
  }
}
```

Authentication required, returns [Single Conversation](#single-conversation)

Required fields: `type`, `participantIds`

Optional fields: `name`

#### Add Participants to Group DM

`POST /api/v1/conversations/:conversationId/participants`

Example request body:

```json
{
  "userIds": ["user_5"]
}
```

Authentication required (group DM only, creator or admin), returns updated [Single Conversation](#single-conversation)

#### Remove Participant from Group DM

`DELETE /api/v1/conversations/:conversationId/participants/:userId`

Authentication required (group DM only, creator or admin), returns `204 No Content`

### Messages

> Messages in channels and conversations are primarily delivered via **WebSocket** in real time. The REST endpoints below are for history retrieval, sending when WebSocket is unavailable, and management.

#### List Messages (Channel)

`GET /api/v1/channels/:channelId/messages`

Query Parameters:

- `?before=msg_abc` — fetch messages before this message ID (cursor pagination)
- `?after=msg_xyz` — fetch messages after this message ID
- `?limit=50` — number of messages (default 50, max 100)

Authentication required, returns [Multiple Messages](#multiple-messages)

#### List Messages (Conversation)

`GET /api/v1/conversations/:conversationId/messages`

Query Parameters:

- `?before=msg_abc`
- `?after=msg_xyz`
- `?limit=50`

Authentication required, returns [Multiple Messages](#multiple-messages)

#### Send Message (Channel)

`POST /api/v1/channels/:channelId/messages`

Example request body:

```json
{
  "message": {
    "body": "Hey team, the new API build is ready for review! :rocket:",
    "format": "markdown",
    "attachments": [
      {
        "fileId": "file_abc123",
        "filename": "api-spec.pdf",
        "mimeType": "application/pdf",
        "size": 204800
      }
    ],
    "mentions": ["user_5", "user_6"]
  }
}
```

Authentication required, returns [Single Message](#single-message). Also broadcasts via WebSocket.

Required fields: `body`

Optional fields: `format` (`plaintext` | `markdown`), `attachments`, `mentions`, `replyTo` (message ID for threading)

#### Send Message (Conversation)

`POST /api/v1/conversations/:conversationId/messages`

Same body format as channel message. For E2EE conversations, the `body` field contains the ciphertext and additional `encryption` metadata is included:

```json
{
  "message": {
    "body": "<base64-ciphertext>",
    "format": "encrypted",
    "encryption": {
      "protocol": "double_ratchet",
      "senderKeyId": "key_abc",
      "sessionId": "sess_xyz",
      "messageIndex": 42
    }
  }
}
```

Authentication required, returns [Single Message](#single-message)

#### Get Message

`GET /api/v1/messages/:messageId`

Authentication required, returns [Single Message](#single-message)

#### Edit Message

`PUT /api/v1/messages/:messageId`

Example request body:

```json
{
  "message": {
    "body": "Updated message content with correction."
  }
}
```

Authentication required (author only), returns updated [Single Message](#single-message). Edit history is preserved.

#### Delete Message

`DELETE /api/v1/messages/:messageId`

Authentication required (author or moderator/admin), returns `204 No Content`

#### Get Message Edit History

`GET /api/v1/messages/:messageId/edits`

Authentication required, returns [Message Edit History](#message-edit-history)

### Threads

#### Get Thread (Replies to a Message)

`GET /api/v1/messages/:messageId/thread`

Query Parameters:

- `?limit=50`
- `?offset=0`

Authentication required, returns [Multiple Messages](#multiple-messages) (the thread replies)

#### Reply in Thread

`POST /api/v1/messages/:messageId/thread`

Example request body:

```json
{
  "message": {
    "body": "Good point, I agree with this approach."
  }
}
```

Authentication required, returns [Single Message](#single-message) with `threadParentId` set

Required fields: `body`

### Reactions

#### Add Reaction

`POST /api/v1/messages/:messageId/reactions`

Example request body:

```json
{
  "emoji": "thumbsup"
}
```

Authentication required, returns updated reaction summary

Required fields: `emoji`

#### Remove Reaction

`DELETE /api/v1/messages/:messageId/reactions/:emoji`

Authentication required, returns `204 No Content`

### Pinned Messages

#### List Pinned Messages

`GET /api/v1/channels/:channelId/pins`

Authentication required, returns [Multiple Messages](#multiple-messages)

#### Pin Message

`POST /api/v1/messages/:messageId/pin`

Authentication required (channel admin or moderator), returns [Single Message](#single-message) with `pinned: true`

#### Unpin Message

`DELETE /api/v1/messages/:messageId/pin`

Authentication required (channel admin or moderator), returns `204 No Content`

### Bookmarks (Saved Messages)

#### List Bookmarks

`GET /api/v1/user/bookmarks`

Query Parameters:

- `?limit=30`
- `?offset=0`

Authentication required, returns [Multiple Messages](#multiple-messages)

#### Bookmark Message

`POST /api/v1/user/bookmarks`

Example request body:

```json
{
  "messageId": "msg_abc123"
}
```

Authentication required, returns `201 Created`

#### Remove Bookmark

`DELETE /api/v1/user/bookmarks/:messageId`

Authentication required, returns `204 No Content`

### Polls

#### Create Poll

`POST /api/v1/channels/:channelId/polls`

Example request body:

```json
{
  "poll": {
    "question": "Which framework should we adopt?",
    "options": ["NestJS", "FastAPI", "Spring Boot", "Express"],
    "multipleChoice": false,
    "anonymous": false,
    "expiresAt": "2026-04-25T18:00:00Z"
  }
}
```

Authentication required, returns [Single Poll](#single-poll) (also posted as a special message)

Required fields: `question`, `options`

Optional fields: `multipleChoice`, `anonymous`, `expiresAt`

#### Vote on Poll

`POST /api/v1/polls/:pollId/vote`

Example request body:

```json
{
  "optionIndex": 1
}
```

Authentication required, returns updated [Single Poll](#single-poll)

Required fields: `optionIndex`

#### Get Poll Results

`GET /api/v1/polls/:pollId`

Authentication required, returns [Single Poll](#single-poll)

### Search Messages

`GET /api/v1/messages/search`

Query Parameters:

- `?q=api+refactoring` — full-text search query
- `?channelId=ch_123` — scope to a specific channel
- `?conversationId=conv_456` — scope to a specific conversation
- `?senderId=user_5` — filter by sender
- `?from=2026-04-01T00:00:00Z` — sent after this date
- `?to=2026-04-19T23:59:59Z` — sent before this date
- `?hasAttachment=true` — only messages with attachments
- `?hasLink=true` — only messages with links
- `?isPinned=true` — only pinned messages
- `?limit=20`
- `?offset=0`

Authentication required, returns [Multiple Messages](#multiple-messages) with highlighted matches

> **Note:** Search is unavailable for E2EE conversations on the server. Clients must implement local search for encrypted messages.

### Message Moderation

#### Report Message

`POST /api/v1/messages/:messageId/report`

Example request body:

```json
{
  "reason": "spam",
  "details": "User is posting the same promotional content repeatedly."
}
```

Authentication required, returns `201 Created`

Required fields: `reason` (`spam` | `harassment` | `inappropriate` | `other`)

Optional fields: `details`

#### List Reported Messages (Admin)

`GET /api/v1/organizations/:orgId/moderation/reports`

Query Parameters:

- `?status=pending` — `pending`, `reviewed`, `dismissed`
- `?limit=20`
- `?offset=0`

Authentication required (Org Admin or Moderator), returns [Multiple Reports](#multiple-reports)

#### Resolve Report

`PUT /api/v1/organizations/:orgId/moderation/reports/:reportId`

Example request body:

```json
{
  "action": "delete_message",
  "notes": "Confirmed spam, message removed."
}
```

Authentication required (Org Admin or Moderator), returns updated report

Required fields: `action` (`dismiss` | `warn_user` | `delete_message` | `suspend_user`)

Optional fields: `notes`

#### Set Slow Mode

`PUT /api/v1/channels/:channelId/slow-mode`

Example request body:

```json
{
  "intervalSeconds": 30
}
```

Authentication required (channel admin), returns updated [Single Channel](#single-channel)

Required fields: `intervalSeconds` (0 to disable)

### File Uploads

#### Upload File

`POST /api/v1/files`

`Content-Type: multipart/form-data`

Form fields:

- `file` — the binary file
- `orgId` — organization context
- `context` — `channel` | `conversation` | `avatar`
- `contextId` — channel or conversation ID (optional for avatar)

Authentication required, returns [File Object](#file-object)

#### Get File Metadata

`GET /api/v1/files/:fileId`

Authentication required, returns [File Object](#file-object)

#### Download File

`GET /api/v1/files/:fileId/download`

Authentication required, returns binary file stream

#### Delete File

`DELETE /api/v1/files/:fileId`

Authentication required (uploader or admin), returns `204 No Content`

### E2EE Key Management

#### Upload Pre-Key Bundle

`POST /api/v1/user/keys`

Example request body:

```json
{
  "keys": {
    "identityKey": "<base64-public-key>",
    "signedPreKey": {
      "keyId": 1,
      "publicKey": "<base64>",
      "signature": "<base64>"
    },
    "oneTimePreKeys": [
      { "keyId": 100, "publicKey": "<base64>" },
      { "keyId": 101, "publicKey": "<base64>" }
    ]
  }
}
```

Authentication required, returns `201 Created`

Required fields: `identityKey`, `signedPreKey`, `oneTimePreKeys`

#### Get User Pre-Key Bundle

`GET /api/v1/users/:userId/keys`

Query Parameters:

- `?deviceId=dev_abc` — fetch keys for a specific device

Authentication required, returns the pre-key bundle (consumes one one-time pre-key)

#### List User Devices

`GET /api/v1/user/devices`

Authentication required, returns [Multiple Devices](#multiple-devices)

#### Remove Device

`DELETE /api/v1/user/devices/:deviceId`

Authentication required, returns `204 No Content`

#### Verify Key Fingerprint

`GET /api/v1/users/:userId/keys/fingerprint`

Authentication required, returns the safety number / fingerprint for manual verification

### Notifications

#### List Notifications

`GET /api/v1/notifications`

Query Parameters:

- `?unread=true` — only unread notifications
- `?type=mention` — filter by type (`mention`, `reply`, `reaction`, `channel_invite`, `system`)
- `?limit=30`
- `?offset=0`

Authentication required, returns [Multiple Notifications](#multiple-notifications)

#### Mark Notification as Read

`PUT /api/v1/notifications/:notificationId/read`

Authentication required, returns `204 No Content`

#### Mark All Notifications as Read

`POST /api/v1/notifications/read-all`

Authentication required, returns `204 No Content`

#### Get Notification Preferences

`GET /api/v1/user/notification-preferences`

Authentication required, returns [Notification Preferences](#notification-preferences)

#### Update Notification Preferences

`PUT /api/v1/user/notification-preferences`

Example request body:

```json
{
  "preferences": {
    "email": {
      "mentions": true,
      "directMessages": true,
      "channelActivity": false
    },
    "push": {
      "mentions": true,
      "directMessages": true,
      "channelActivity": true
    },
    "inApp": {
      "mentions": true,
      "directMessages": true,
      "channelActivity": true
    },
    "muteChannels": ["ch_noisy"],
    "doNotDisturb": {
      "enabled": false,
      "from": "22:00",
      "to": "08:00",
      "timezone": "Asia/Dhaka"
    }
  }
}
```

Authentication required, returns updated [Notification Preferences](#notification-preferences)

---

## Audits

### Get Audit

`GET /api/audits`

Authentication required. It returns the audits of the authenticated user. Any format allowed.

Include auditing in all the APIs to track all the actions from a user.

---

## WebSocket Events

### Connection

Connect to: `wss://<host>/ws?token=<jwt>`

Upon connection, the server sends:

```json
{
  "event": "connected",
  "data": {
    "userId": "user_123",
    "sessionId": "sess_abc",
    "serverTime": "2026-04-19T10:30:00Z"
  }
}
```

### Client → Server Events

#### Send Message

```json
{
  "event": "message:send",
  "data": {
    "targetType": "channel",
    "targetId": "ch_123",
    "body": "Hello everyone!",
    "format": "markdown",
    "clientMsgId": "client_uuid_1",
    "replyTo": null,
    "attachments": [],
    "mentions": []
  }
}
```

#### Start Typing

```json
{
  "event": "typing:start",
  "data": {
    "targetType": "channel",
    "targetId": "ch_123"
  }
}
```

#### Stop Typing

```json
{
  "event": "typing:stop",
  "data": {
    "targetType": "channel",
    "targetId": "ch_123"
  }
}
```

#### Mark as Read

```json
{
  "event": "read:mark",
  "data": {
    "targetType": "channel",
    "targetId": "ch_123",
    "lastReadMessageId": "msg_abc"
  }
}
```

#### Set Presence

```json
{
  "event": "presence:set",
  "data": {
    "status": "online",
    "customText": "In a meeting until 3pm"
  }
}
```

Allowed `status` values: `online`, `away`, `busy`, `offline`

### Server → Client Events

#### New Message

```json
{
  "event": "message:new",
  "data": {
    "id": "msg_789",
    "targetType": "channel",
    "targetId": "ch_123",
    "body": "Hello everyone!",
    "format": "markdown",
    "sender": {
      "id": "user_123",
      "username": "john.doe",
      "avatar": "https://cdn.example.com/avatars/john.png"
    },
    "createdAt": "2026-04-19T10:31:00Z",
    "replyTo": null,
    "attachments": [],
    "mentions": [],
    "reactions": [],
    "clientMsgId": "client_uuid_1"
  }
}
```

#### Message Edited

```json
{
  "event": "message:edited",
  "data": {
    "id": "msg_789",
    "targetType": "channel",
    "targetId": "ch_123",
    "body": "Hello everyone! (edited)",
    "editedAt": "2026-04-19T10:35:00Z",
    "editedBy": "user_123"
  }
}
```

#### Message Deleted

```json
{
  "event": "message:deleted",
  "data": {
    "id": "msg_789",
    "targetType": "channel",
    "targetId": "ch_123",
    "deletedBy": "user_123"
  }
}
```

#### Reaction Added

```json
{
  "event": "reaction:added",
  "data": {
    "messageId": "msg_789",
    "emoji": "thumbsup",
    "userId": "user_5"
  }
}
```

#### Reaction Removed

```json
{
  "event": "reaction:removed",
  "data": {
    "messageId": "msg_789",
    "emoji": "thumbsup",
    "userId": "user_5"
  }
}
```

#### User Typing

```json
{
  "event": "typing:update",
  "data": {
    "targetType": "channel",
    "targetId": "ch_123",
    "userId": "user_5",
    "username": "jane.doe",
    "isTyping": true
  }
}
```

#### Presence Update

```json
{
  "event": "presence:update",
  "data": {
    "userId": "user_5",
    "status": "away",
    "customText": "",
    "lastSeen": "2026-04-19T10:28:00Z"
  }
}
```

#### Notification

```json
{
  "event": "notification:new",
  "data": {
    "id": "notif_456",
    "type": "mention",
    "title": "john.doe mentioned you in #backend-dev",
    "body": "...hey @jane.doe can you review this?...",
    "link": "/channels/ch_123/messages/msg_789",
    "createdAt": "2026-04-19T10:31:00Z",
    "read": false
  }
}
```

#### Channel Updated

```json
{
  "event": "channel:updated",
  "data": {
    "channelId": "ch_123",
    "changes": {
      "topic": "Sprint 43 — Performance Tuning"
    },
    "updatedBy": "user_123"
  }
}
```

#### Member Joined/Left Channel

```json
{
  "event": "channel:member_joined",
  "data": {
    "channelId": "ch_123",
    "userId": "user_7",
    "username": "bob.smith"
  }
}
```

```json
{
  "event": "channel:member_left",
  "data": {
    "channelId": "ch_123",
    "userId": "user_7",
    "username": "bob.smith"
  }
}
```

#### Call Incoming

```json
{
  "event": "call:incoming",
  "data": {
    "callId": "call_123",
    "type": "video",
    "caller": {
      "id": "user_123",
      "username": "john.doe",
      "avatar": "https://cdn.example.com/avatars/john.png"
    },
    "channelId": null,
    "conversationId": "conv_456"
  }
}
```

#### Call Ended

```json
{
  "event": "call:ended",
  "data": {
    "callId": "call_123",
    "endedBy": "user_123",
    "duration": 312
  }
}
```

#### Disappearing Message Expired

```json
{
  "event": "message:expired",
  "data": {
    "id": "msg_secret_1",
    "conversationId": "conv_456"
  }
}
```

---

## Response Formats

`<a id="user-object"></a>`

### User Object

```json
{
  "user": {
    "id": "user_123",
    "username": "john.doe",
    "email": "john@acme.org",
    "name": "John Doe",
    "employeeId": "EMP-001",
    "designation": "Senior Engineer",
    "department": "Engineering",
    "bio": "Backend enthusiast",
    "avatar": "https://cdn.example.com/avatars/john.png",
    "status": "active",
    "contactInfo": {
      "phone": "+8801711000000",
      "address": "Dhaka, Bangladesh"
    },
    "orgId": "org_abc123",
    "roleIds": ["role_employee", "role_dept_head"],
    "token": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi...",
    "createdAt": "2026-01-15T08:00:00Z",
    "updatedAt": "2026-04-10T12:30:00Z"
  }
}
```

`<a id="user-profile"></a>`

### User Profile

```json
{
  "profile": {
    "id": "user_123",
    "username": "john.doe",
    "name": "John Doe",
    "designation": "Senior Engineer",
    "department": "Engineering",
    "bio": "Backend enthusiast",
    "avatar": "https://cdn.example.com/avatars/john.png",
    "status": "active",
    "presence": "online",
    "orgId": "org_abc123"
  }
}
```

`<a id="multiple-users"></a>`

### Multiple Users

```json
{
  "users": [
    { "id": "user_123", "username": "john.doe", "name": "John Doe", "designation": "Senior Engineer", "department": "Engineering", "avatar": "...", "status": "active" },
    { "id": "user_456", "username": "jane.doe", "name": "Jane Doe", "designation": "Software Engineer", "department": "Engineering", "avatar": "...", "status": "active" }
  ],
  "totalCount": 42,
  "limit": 20,
  "offset": 0
}
```

`<a id="directory-listing"></a>`

### Directory Listing

```json
{
  "directory": [
    {
      "id": "user_123",
      "name": "John Doe",
      "username": "john.doe",
      "designation": "Senior Engineer",
      "department": "Engineering",
      "location": "Dhaka",
      "avatar": "...",
      "presence": "online"
    }
  ],
  "totalCount": 150,
  "limit": 50,
  "offset": 0
}
```

`<a id="org-chart"></a>`

### Org Chart

```json
{
  "orgChart": {
    "orgId": "org_abc123",
    "orgName": "ACME Corporation",
    "head": {
      "userId": "user_ceo",
      "name": "Alice CEO",
      "designation": "Chief Executive Officer",
      "avatar": "...",
      "reports": [
        {
          "userId": "user_cto",
          "name": "Bob CTO",
          "designation": "Chief Technology Officer",
          "avatar": "...",
          "reports": []
        }
      ]
    }
  }
}
```

`<a id="single-organization"></a>`

### Single Organization

```json
{
  "organization": {
    "id": "org_abc123",
    "name": "ACME Corporation",
    "code": "ACME",
    "type": "root",
    "status": "active",
    "logo": "https://cdn.example.com/acme-logo.png",
    "parentId": null,
    "depth": 0,
    "childrenCount": 5,
    "userCount": 230,
    "metadata": {
      "address": "123 Corporate Blvd",
      "country": "BD",
      "timezone": "Asia/Dhaka"
    },
    "createdAt": "2025-06-01T00:00:00Z",
    "updatedAt": "2026-03-15T09:00:00Z"
  }
}
```

`<a id="multiple-organizations"></a>`

### Multiple Organizations

```json
{
  "organizations": [
    { "id": "org_abc123", "name": "ACME Corporation", "code": "ACME", "type": "root", "status": "active", "parentId": null, "childrenCount": 5, "userCount": 230 },
    { "id": "org_eng456", "name": "Engineering Division", "code": "ACME-ENG", "type": "division", "status": "active", "parentId": "org_abc123", "childrenCount": 3, "userCount": 80 }
  ],
  "totalCount": 12,
  "limit": 20,
  "offset": 0
}
```

`<a id="organization-tree"></a>`

### Organization Tree

```json
{
  "tree": [
    {
      "id": "org_abc123",
      "name": "ACME Corporation",
      "code": "ACME",
      "type": "root",
      "status": "active",
      "children": [
        {
          "id": "org_eng456",
          "name": "Engineering Division",
          "code": "ACME-ENG",
          "type": "division",
          "status": "active",
          "children": [
            {
              "id": "org_be789",
              "name": "Backend Team",
              "code": "ACME-ENG-BE",
              "type": "team",
              "status": "active",
              "children": []
            }
          ]
        }
      ]
    }
  ]
}
```

`<a id="single-relationship"></a>`

### Single Relationship

```json
{
  "relationship": {
    "id": "rel_123",
    "sourceOrgId": "org_abc123",
    "targetOrgId": "org_partner456",
    "type": "shared_services",
    "description": "Shared IT infrastructure",
    "sharedModules": ["messaging", "tasks"],
    "createdAt": "2026-02-01T00:00:00Z"
  }
}
```

`<a id="multiple-relationships"></a>`

### Multiple Relationships

```json
{
  "relationships": [
    { "id": "rel_123", "sourceOrgId": "org_abc123", "targetOrgId": "org_partner456", "type": "shared_services", "description": "Shared IT infrastructure", "sharedModules": ["messaging", "tasks"] }
  ],
  "totalCount": 1
}
```

`<a id="single-role"></a>`

### Single Role

```json
{
  "role": {
    "id": "role_dept_head",
    "name": "Department Head",
    "description": "Can manage department users and tasks",
    "type": "custom",
    "inheritsFrom": "role_manager",
    "orgId": "org_abc123",
    "permissions": [
      { "module": "messaging", "action": "create_channel", "allow": true },
      { "module": "messaging", "action": "delete_channel", "allow": false },
      { "module": "tasks", "action": "*", "allow": true },
      { "module": "users", "action": "create", "allow": true },
      { "module": "users", "action": "delete", "allow": false }
    ],
    "createdAt": "2026-01-20T00:00:00Z",
    "updatedAt": "2026-03-10T00:00:00Z"
  }
}
```

`<a id="multiple-roles"></a>`

### Multiple Roles

```json
{
  "roles": [
    { "id": "role_super_admin", "name": "Super Admin", "type": "system", "orgId": null },
    { "id": "role_org_admin", "name": "Org Admin", "type": "system", "orgId": "org_abc123" },
    { "id": "role_dept_head", "name": "Department Head", "type": "custom", "orgId": "org_abc123" }
  ],
  "totalCount": 3
}
```

`<a id="permission-list"></a>`

### Permission List

```json
{
  "permissions": {
    "organizations": ["create", "read", "update", "delete", "archive", "move", "merge", "clone"],
    "users": ["create", "read", "update", "delete", "deactivate", "assign_role"],
    "messaging": ["create_channel", "delete_channel", "send_message", "delete_message", "pin_message", "moderate"],
    "tasks": ["create_project", "delete_project", "create_task", "assign_task", "delete_task", "manage_sprint"]
  }
}
```

`<a id="effective-permissions"></a>`

### Effective Permissions

```json
{
  "effectivePermissions": {
    "userId": "user_123",
    "orgId": "org_abc123",
    "computed": [
      { "module": "messaging", "action": "create_channel", "allow": true, "source": "role:role_dept_head" },
      { "module": "messaging", "action": "delete_channel", "allow": true, "source": "team:team_backend_leads" },
      { "module": "tasks", "action": "*", "allow": true, "source": "role:role_dept_head" }
    ]
  }
}
```

`<a id="single-team"></a>`

### Single Team

```json
{
  "team": {
    "id": "team_backend",
    "name": "Backend Squad",
    "description": "Backend development team",
    "type": "static",
    "orgId": "org_abc123",
    "memberCount": 5,
    "members": [
      { "userId": "user_1", "username": "john.doe", "name": "John Doe", "avatar": "..." },
      { "userId": "user_2", "username": "jane.doe", "name": "Jane Doe", "avatar": "..." }
    ],
    "permissionOverrides": [
      { "module": "tasks", "action": "create_project", "allow": true }
    ],
    "createdAt": "2026-02-01T00:00:00Z",
    "updatedAt": "2026-04-01T00:00:00Z"
  }
}
```

`<a id="multiple-teams"></a>`

### Multiple Teams

```json
{
  "teams": [
    { "id": "team_backend", "name": "Backend Squad", "type": "static", "memberCount": 5 },
    { "id": "team_dhaka_mgrs", "name": "All Dhaka Managers", "type": "dynamic", "memberCount": 12 }
  ],
  "totalCount": 2,
  "limit": 20,
  "offset": 0
}
```

`<a id="single-delegation"></a>`

### Single Delegation

```json
{
  "delegation": {
    "id": "del_abc",
    "delegatorUserId": "user_123",
    "delegateUserId": "user_proxy42",
    "startDate": "2026-04-20T00:00:00Z",
    "endDate": "2026-04-30T23:59:59Z",
    "reason": "Annual leave",
    "status": "active",
    "scope": {
      "modules": ["tasks", "nothi"],
      "permissions": ["approve", "forward"]
    },
    "createdAt": "2026-04-18T10:00:00Z"
  }
}
```

`<a id="multiple-delegations"></a>`

### Multiple Delegations

```json
{
  "delegations": [
    { "id": "del_abc", "delegateUserId": "user_proxy42", "startDate": "2026-04-20T00:00:00Z", "endDate": "2026-04-30T23:59:59Z", "status": "active" }
  ],
  "totalCount": 1
}
```

`<a id="multiple-sessions"></a>`

### Multiple Sessions

```json
{
  "sessions": [
    {
      "id": "sess_abc",
      "deviceType": "web",
      "browser": "Chrome 124",
      "os": "macOS",
      "ip": "103.12.34.56",
      "lastActive": "2026-04-19T10:30:00Z",
      "current": true
    },
    {
      "id": "sess_def",
      "deviceType": "mobile",
      "browser": "dOffice App 2.1",
      "os": "Android",
      "ip": "103.12.34.57",
      "lastActive": "2026-04-18T22:00:00Z",
      "current": false
    }
  ]
}
```

`<a id="single-channel"></a>`

### Single Channel

```json
{
  "channel": {
    "id": "ch_123",
    "name": "backend-dev",
    "type": "public",
    "description": "Backend development discussions",
    "topic": "Sprint 42 — API Refactoring",
    "categoryId": "cat_engineering",
    "orgId": "org_abc123",
    "memberCount": 25,
    "e2ee": false,
    "slowModeInterval": 0,
    "createdBy": "user_123",
    "createdAt": "2026-02-10T08:00:00Z",
    "updatedAt": "2026-04-19T09:00:00Z"
  }
}
```

`<a id="multiple-channels"></a>`

### Multiple Channels

```json
{
  "channels": [
    { "id": "ch_123", "name": "backend-dev", "type": "public", "memberCount": 25, "categoryId": "cat_engineering", "topic": "Sprint 42" },
    { "id": "ch_456", "name": "general", "type": "public", "memberCount": 230, "categoryId": "cat_general", "topic": "Welcome!" }
  ],
  "totalCount": 15,
  "limit": 50,
  "offset": 0
}
```

`<a id="single-category"></a>`

### Single Category

```json
{
  "category": {
    "id": "cat_engineering",
    "name": "Engineering",
    "orgId": "org_abc123",
    "position": 1,
    "channelCount": 8
  }
}
```

`<a id="multiple-categories"></a>`

### Multiple Categories

```json
{
  "categories": [
    { "id": "cat_engineering", "name": "Engineering", "position": 1, "channelCount": 8 },
    { "id": "cat_general", "name": "General", "position": 2, "channelCount": 3 }
  ]
}
```

`<a id="single-conversation"></a>`

### Single Conversation

```json
{
  "conversation": {
    "id": "conv_456",
    "type": "dm",
    "name": null,
    "participants": [
      { "userId": "user_123", "username": "john.doe", "name": "John Doe", "avatar": "..." },
      { "userId": "user_456", "username": "jane.doe", "name": "Jane Doe", "avatar": "..." }
    ],
    "e2ee": true,
    "disappearingTimer": 0,
    "lastMessage": {
      "id": "msg_latest",
      "body": "Sounds good, let's sync tomorrow.",
      "senderId": "user_456",
      "createdAt": "2026-04-19T10:25:00Z"
    },
    "createdAt": "2026-03-01T00:00:00Z",
    "updatedAt": "2026-04-19T10:25:00Z"
  }
}
```

`<a id="multiple-conversations"></a>`

### Multiple Conversations

```json
{
  "conversations": [
    { "id": "conv_456", "type": "dm", "participants": [{"userId": "user_456", "username": "jane.doe"}], "lastMessage": {"body": "Sounds good", "createdAt": "2026-04-19T10:25:00Z"} },
    { "id": "conv_789", "type": "group", "name": "Project Alpha Chat", "participants": [{"userId": "user_2"}, {"userId": "user_3"}], "lastMessage": {"body": "Meeting at 3pm", "createdAt": "2026-04-19T09:00:00Z"} }
  ],
  "totalCount": 12,
  "limit": 30,
  "offset": 0
}
```

`<a id="single-message"></a>`

### Single Message

```json
{
  "message": {
    "id": "msg_789",
    "body": "Hey team, the new API build is ready for review! :rocket:",
    "format": "markdown",
    "sender": {
      "id": "user_123",
      "username": "john.doe",
      "name": "John Doe",
      "avatar": "https://cdn.example.com/avatars/john.png"
    },
    "targetType": "channel",
    "targetId": "ch_123",
    "threadParentId": null,
    "threadReplyCount": 3,
    "replyTo": null,
    "attachments": [
      {
        "fileId": "file_abc123",
        "filename": "api-spec.pdf",
        "mimeType": "application/pdf",
        "size": 204800,
        "url": "/api/v1/files/file_abc123/download"
      }
    ],
    "mentions": ["user_5", "user_6"],
    "reactions": [
      { "emoji": "thumbsup", "count": 3, "users": ["user_5", "user_6", "user_7"] },
      { "emoji": "rocket", "count": 1, "users": ["user_8"] }
    ],
    "pinned": false,
    "edited": false,
    "editedAt": null,
    "createdAt": "2026-04-19T10:31:00Z",
    "updatedAt": "2026-04-19T10:31:00Z"
  }
}
```

`<a id="multiple-messages"></a>`

### Multiple Messages

```json
{
  "messages": [
    {
      "id": "msg_789",
      "body": "Hey team, the new API build is ready!",
      "format": "markdown",
      "sender": { "id": "user_123", "username": "john.doe", "avatar": "..." },
      "targetType": "channel",
      "targetId": "ch_123",
      "threadReplyCount": 3,
      "reactions": [{ "emoji": "thumbsup", "count": 3 }],
      "pinned": false,
      "createdAt": "2026-04-19T10:31:00Z"
    },
    {
      "id": "msg_790",
      "body": "Great work! I'll review it now.",
      "format": "plaintext",
      "sender": { "id": "user_456", "username": "jane.doe", "avatar": "..." },
      "targetType": "channel",
      "targetId": "ch_123",
      "threadReplyCount": 0,
      "reactions": [],
      "pinned": false,
      "createdAt": "2026-04-19T10:32:00Z"
    }
  ],
  "hasMore": true
}
```

`<a id="message-edit-history"></a>`

### Message Edit History

```json
{
  "edits": [
    { "body": "Hey team, the new API build is ready!", "editedAt": "2026-04-19T10:31:00Z" },
    { "body": "Hey team, the new API build is ready for review! :rocket:", "editedAt": "2026-04-19T10:35:00Z" }
  ]
}
```

`<a id="single-poll"></a>`

### Single Poll

```json
{
  "poll": {
    "id": "poll_abc",
    "channelId": "ch_123",
    "messageId": "msg_poll1",
    "question": "Which framework should we adopt?",
    "options": [
      { "index": 0, "text": "NestJS", "votes": 5 },
      { "index": 1, "text": "FastAPI", "votes": 8 },
      { "index": 2, "text": "Spring Boot", "votes": 3 },
      { "index": 3, "text": "Express", "votes": 2 }
    ],
    "totalVotes": 18,
    "multipleChoice": false,
    "anonymous": false,
    "expiresAt": "2026-04-25T18:00:00Z",
    "createdBy": "user_123",
    "createdAt": "2026-04-19T10:00:00Z"
  }
}
```

`<a id="file-object"></a>`

### File Object

```json
{
  "file": {
    "id": "file_abc123",
    "filename": "api-spec.pdf",
    "mimeType": "application/pdf",
    "size": 204800,
    "url": "/api/v1/files/file_abc123/download",
    "uploadedBy": "user_123",
    "orgId": "org_abc123",
    "createdAt": "2026-04-19T10:30:00Z"
  }
}
```

`<a id="multiple-devices"></a>`

### Multiple Devices

```json
{
  "devices": [
    {
      "id": "dev_abc",
      "name": "Chrome on MacBook",
      "identityKeyFingerprint": "05 A3 B2 ...",
      "lastSeen": "2026-04-19T10:30:00Z",
      "current": true
    },
    {
      "id": "dev_def",
      "name": "dOffice Android",
      "identityKeyFingerprint": "05 C7 D4 ...",
      "lastSeen": "2026-04-18T22:00:00Z",
      "current": false
    }
  ]
}
```

`<a id="call-session"></a>`

### Call Session

```json
{
  "call": {
    "id": "call_123",
    "type": "video",
    "status": "active",
    "initiator": "user_123",
    "channelId": null,
    "conversationId": "conv_456",
    "participants": [
      { "userId": "user_123", "joinedAt": "2026-04-19T10:40:00Z", "status": "connected" },
      { "userId": "user_456", "joinedAt": "2026-04-19T10:40:05Z", "status": "connected" }
    ],
    "startedAt": "2026-04-19T10:40:00Z",
    "endedAt": null,
    "duration": null,
    "recording": false
  }
}
```

`<a id="multiple-notifications"></a>`

### Multiple Notifications

```json
{
  "notifications": [
    {
      "id": "notif_456",
      "type": "mention",
      "title": "john.doe mentioned you in #backend-dev",
      "body": "...hey @jane.doe can you review this?...",
      "link": "/channels/ch_123/messages/msg_789",
      "read": false,
      "createdAt": "2026-04-19T10:31:00Z"
    },
    {
      "id": "notif_457",
      "type": "channel_invite",
      "title": "You were added to #frontend-dev",
      "body": null,
      "link": "/channels/ch_789",
      "read": true,
      "createdAt": "2026-04-19T09:00:00Z"
    }
  ],
  "totalCount": 24,
  "unreadCount": 7,
  "limit": 30,
  "offset": 0
}
```

`<a id="notification-preferences"></a>`

### Notification Preferences

```json
{
  "preferences": {
    "email": {
      "mentions": true,
      "directMessages": true,
      "channelActivity": false
    },
    "push": {
      "mentions": true,
      "directMessages": true,
      "channelActivity": true
    },
    "inApp": {
      "mentions": true,
      "directMessages": true,
      "channelActivity": true
    },
    "muteChannels": ["ch_noisy"],
    "doNotDisturb": {
      "enabled": false,
      "from": "22:00",
      "to": "08:00",
      "timezone": "Asia/Dhaka"
    }
  }
}
```

`<a id="multiple-reports"></a>`

### Multiple Reports

```json
{
  "reports": [
    {
      "id": "rpt_1",
      "messageId": "msg_spam1",
      "reportedBy": "user_456",
      "reason": "spam",
      "details": "Repeated promotional content",
      "status": "pending",
      "createdAt": "2026-04-19T09:00:00Z"
    }
  ],
  "totalCount": 3,
  "limit": 20,
  "offset": 0
}
```

---

## Error Responses

All errors follow a consistent format:

### Validation Error (422)

```json
{
  "errors": {
    "body": ["can't be blank"],
    "email": ["is invalid", "has already been taken"]
  }
}
```

### Unauthorized (401)

```json
{
  "error": {
    "status": 401,
    "message": "Missing or invalid authentication token."
  }
}
```

### Forbidden (403)

```json
{
  "error": {
    "status": 403,
    "message": "You do not have permission to perform this action."
  }
}
```

### Not Found (404)

```json
{
  "error": {
    "status": 404,
    "message": "Resource not found."
  }
}
```

### Rate Limited (429)

```json
{
  "error": {
    "status": 429,
    "message": "Too many requests. Please try again later.",
    "retryAfter": 30
  }
}
```

### Server Error (500)

```json
{
  "error": {
    "status": 500,
    "message": "An unexpected error occurred. Please try again."
  }
}
```
