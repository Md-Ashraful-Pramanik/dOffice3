const { withTransaction } = require('../../db/pool');
const { AppError, validationError } = require('../../utils/errors');
const { generateId } = require('../../utils/id');
const { hashPassword } = require('../../utils/password');
const auditService = require('../audits/audit.service');
const authRepository = require('../auth/auth.repository');
const organizationRepository = require('../organizations/organization.repository');
const userRepository = require('./user.repository');

const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';
const NOT_FOUND_MESSAGE = 'Resource not found.';
const USER_STATUSES = new Set(['active', 'suspended', 'on-leave', 'deactivated', 'retired']);
const DIRECTORY_VISIBLE_STATUSES = ['active', 'suspended', 'on-leave'];
const SUPER_ADMIN_ROLES = new Set(['super_admin', 'role_super_admin']);
const ORG_ADMIN_ROLES = new Set(['org_admin', 'role_org_admin']);
const IMMUTABLE_CURRENT_USER_FIELDS = new Set([
  'id',
  'username',
  'email',
  'name',
  'employeeId',
  'orgId',
  'roleIds',
  'status',
]);
const SESSION_ONLINE_WINDOW_MS = 5 * 60 * 1000;

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function isSuperAdmin(user) {
  return (user.roleIds || []).some((role) => SUPER_ADMIN_ROLES.has(normalizeRole(role)));
}

function isOrgAdmin(user) {
  return isSuperAdmin(user)
    || (user.roleIds || []).some((role) => ORG_ADMIN_ROLES.has(normalizeRole(role)));
}

function forbidden() {
  return new AppError(403, FORBIDDEN_MESSAGE);
}

function notFound() {
  return new AppError(404, NOT_FOUND_MESSAGE);
}

function normalizeString(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeNullableString(value) {
  if (value === null) {
    return null;
  }

  return normalizeString(value);
}

function normalizeEmail(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : undefined;
}

function isValidEmailFormat(value) {
  if (!value) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function ensurePlainObject(value, field, errors) {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors[field] = ['must be an object'];
    return undefined;
  }

  return value;
}

function ensureStringArray(value, field, errors) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    errors[field] = ['must be an array'];
    return undefined;
  }

  const normalizedValues = value
    .map((entry) => normalizeString(entry))
    .filter((entry) => Boolean(entry));

  if (normalizedValues.length !== value.length) {
    errors[field] = ['must contain non-empty strings'];
    return undefined;
  }

  return Array.from(new Set(normalizedValues));
}

function parseIntegerQueryValue(value) {
  if (value === undefined) {
    return { hasValue: false, isValid: true, value: undefined };
  }

  if (Array.isArray(value) || (typeof value === 'string' && value.trim() === '')) {
    return { hasValue: true, isValid: false, value: undefined };
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return { hasValue: true, isValid: false, value: undefined };
  }

  return { hasValue: true, isValid: true, value: parsed };
}

function validatePagination(query, defaultLimit) {
  const errors = {};
  const parsedLimit = parseIntegerQueryValue(query.limit);
  const parsedOffset = parseIntegerQueryValue(query.offset);

  if (parsedLimit.hasValue && (!parsedLimit.isValid || parsedLimit.value < 1)) {
    errors.limit = ['must be an integer greater than or equal to 1'];
  }

  if (parsedOffset.hasValue && (!parsedOffset.isValid || parsedOffset.value < 0)) {
    errors.offset = ['must be an integer greater than or equal to 0'];
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  return {
    limit: parsedLimit.hasValue ? parsedLimit.value : defaultLimit,
    offset: parsedOffset.hasValue ? parsedOffset.value : 0,
  };
}

function validateStatus(status) {
  if (status === undefined) {
    return undefined;
  }

  const normalized = normalizeString(status);

  if (!normalized || !USER_STATUSES.has(normalized)) {
    throw validationError({ status: ['is invalid'] });
  }

  return normalized;
}

function validateCurrentUserUpdatePayload(payload) {
  const errors = {};
  const user = payload && payload.user;

  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    throw validationError({ user: ["can't be blank"] });
  }

  const changes = {};

  Object.keys(user).forEach((field) => {
    if (IMMUTABLE_CURRENT_USER_FIELDS.has(field)) {
      errors[field] = ['is immutable'];
    }
  });

  if (Object.prototype.hasOwnProperty.call(user, 'password')) {
    const password = normalizeString(user.password);

    if (!password) {
      errors.password = ["can't be blank"];
    } else {
      changes.password = password;
    }
  }

  if (Object.prototype.hasOwnProperty.call(user, 'avatar')) {
    if (user.avatar === null) {
      changes.avatar = null;
    } else {
      const avatar = normalizeString(user.avatar);

      if (!avatar) {
        errors.avatar = ["can't be blank"];
      } else {
        changes.avatar = avatar;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(user, 'bio')) {
    const bio = user.bio === null ? null : normalizeNullableString(user.bio);

    if (user.bio !== null && bio === undefined) {
      errors.bio = ["can't be blank"];
    } else {
      changes.bio = bio;
    }
  }

  if (Object.prototype.hasOwnProperty.call(user, 'designation')) {
    const designation = user.designation === null ? null : normalizeNullableString(user.designation);

    if (user.designation !== null && designation === undefined) {
      errors.designation = ["can't be blank"];
    } else {
      changes.designation = designation;
    }
  }

  if (Object.prototype.hasOwnProperty.call(user, 'contactInfo')) {
    const contactInfo = ensurePlainObject(user.contactInfo, 'contactInfo', errors);

    if (contactInfo) {
      changes.contactInfo = contactInfo;
    }
  }

  if (Object.keys(changes).length === 0 && Object.keys(errors).length === 0) {
    errors.user = ['must include at least one updatable field'];
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  return changes;
}

function validateCreateUserPayload(payload) {
  const errors = {};
  const user = payload && payload.user;

  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    throw validationError({ user: ["can't be blank"] });
  }

  const username = normalizeString(user.username);
  const email = normalizeEmail(user.email);
  const password = normalizeString(user.password);
  const name = normalizeString(user.name);
  const employeeId = normalizeNullableString(user.employeeId);
  const designation = normalizeNullableString(user.designation);
  const department = normalizeNullableString(user.department);
  const avatar = user.avatar === null ? null : normalizeNullableString(user.avatar);
  const bio = user.bio === null ? null : normalizeNullableString(user.bio);
  const location = user.location === null ? null : normalizeNullableString(user.location);
  const managerUserId = user.managerUserId === null ? null : normalizeNullableString(user.managerUserId);
  const roleIds = ensureStringArray(user.roleIds, 'roleIds', errors);
  const skills = ensureStringArray(user.skills, 'skills', errors);
  const contactInfo = ensurePlainObject(user.contactInfo, 'contactInfo', errors);

  if (!username) {
    errors.username = ["can't be blank"];
  }

  if (!email) {
    errors.email = ["can't be blank"];
  } else if (!isValidEmailFormat(email)) {
    errors.email = ['is invalid'];
  }

  if (!password) {
    errors.password = ["can't be blank"];
  }

  if (!name) {
    errors.name = ["can't be blank"];
  }

  if (Object.prototype.hasOwnProperty.call(user, 'avatar') && user.avatar !== null && !avatar) {
    errors.avatar = ["can't be blank"];
  }

  if (Object.prototype.hasOwnProperty.call(user, 'employeeId') && user.employeeId !== null && employeeId === undefined) {
    errors.employeeId = ["can't be blank"];
  }

  if (Object.prototype.hasOwnProperty.call(user, 'designation') && user.designation !== null && designation === undefined) {
    errors.designation = ["can't be blank"];
  }

  if (Object.prototype.hasOwnProperty.call(user, 'department') && user.department !== null && department === undefined) {
    errors.department = ["can't be blank"];
  }

  if (Object.prototype.hasOwnProperty.call(user, 'bio') && user.bio !== null && bio === undefined) {
    errors.bio = ["can't be blank"];
  }

  if (Object.prototype.hasOwnProperty.call(user, 'location') && user.location !== null && location === undefined) {
    errors.location = ["can't be blank"];
  }

  if (
    Object.prototype.hasOwnProperty.call(user, 'managerUserId')
    && user.managerUserId !== null
    && managerUserId === undefined
  ) {
    errors.managerUserId = ["can't be blank"];
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  return {
    username,
    email,
    password,
    name,
    employeeId: employeeId || null,
    designation: designation || null,
    department: department || null,
    roleIds: roleIds || [],
    contactInfo: contactInfo || {},
    avatar: avatar || null,
    bio: bio || null,
    location: location || null,
    skills: skills || [],
    managerUserId: managerUserId || null,
  };
}

function validateAdminUpdatePayload(payload) {
  const errors = {};
  const user = payload && payload.user;

  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    throw validationError({ user: ["can't be blank"] });
  }

  const changes = {};

  if (Object.prototype.hasOwnProperty.call(user, 'name')) {
    const name = user.name === null ? null : normalizeNullableString(user.name);

    if (user.name !== null && !name) {
      errors.name = ["can't be blank"];
    } else {
      changes.name = name;
    }
  }

  if (Object.prototype.hasOwnProperty.call(user, 'designation')) {
    const designation = user.designation === null ? null : normalizeNullableString(user.designation);

    if (user.designation !== null && designation === undefined) {
      errors.designation = ["can't be blank"];
    } else {
      changes.designation = designation;
    }
  }

  if (Object.prototype.hasOwnProperty.call(user, 'department')) {
    const department = user.department === null ? null : normalizeNullableString(user.department);

    if (user.department !== null && department === undefined) {
      errors.department = ["can't be blank"];
    } else {
      changes.department = department;
    }
  }

  if (Object.prototype.hasOwnProperty.call(user, 'status')) {
    const status = validateStatus(user.status);
    changes.status = status;
  }

  if (Object.prototype.hasOwnProperty.call(user, 'roleIds')) {
    const roleIds = ensureStringArray(user.roleIds, 'roleIds', errors);

    if (roleIds) {
      changes.roleIds = roleIds;
    }
  }

  if (Object.prototype.hasOwnProperty.call(user, 'contactInfo')) {
    const contactInfo = ensurePlainObject(user.contactInfo, 'contactInfo', errors);

    if (contactInfo) {
      changes.contactInfo = contactInfo;
    }
  }

  if (Object.prototype.hasOwnProperty.call(user, 'avatar')) {
    if (user.avatar === null) {
      changes.avatar = null;
    } else {
      const avatar = normalizeString(user.avatar);

      if (!avatar) {
        errors.avatar = ["can't be blank"];
      } else {
        changes.avatar = avatar;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(user, 'bio')) {
    const bio = user.bio === null ? null : normalizeNullableString(user.bio);

    if (user.bio !== null && bio === undefined) {
      errors.bio = ["can't be blank"];
    } else {
      changes.bio = bio;
    }
  }

  if (Object.keys(changes).length === 0 && Object.keys(errors).length === 0) {
    errors.user = ['must include at least one updatable field'];
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  return changes;
}

function validateUserListQuery(query) {
  const { limit, offset } = validatePagination(query, 20);

  return {
    search: normalizeString(query.search) || null,
    status: query.status === undefined ? undefined : validateStatus(query.status),
    department: normalizeString(query.department) || null,
    designation: normalizeString(query.designation) || null,
    location: normalizeString(query.location) || null,
    roleId: normalizeString(query.roleId) || null,
    limit,
    offset,
  };
}

function validateDirectoryQuery(query) {
  const { limit, offset } = validatePagination(query, 50);

  return {
    search: normalizeString(query.search) || null,
    department: normalizeString(query.department) || null,
    designation: normalizeString(query.designation) || null,
    location: normalizeString(query.location) || null,
    skill: normalizeString(query.skill) || null,
    limit,
    offset,
  };
}

function toUserResponse(user, session = {}) {
  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      employeeId: user.employeeId,
      designation: user.designation,
      department: user.department,
      bio: user.bio,
      avatar: user.avatar,
      status: user.status,
      contactInfo: user.contactInfo || {},
      orgId: user.orgId,
      roleIds: user.roleIds || [],
      token: session.token || null,
      refreshToken: session.refreshToken || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  };
}

function toUserSummary(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    designation: user.designation,
    department: user.department,
    avatar: user.avatar,
    status: user.status,
  };
}

function toMultipleUsersResponse(result, limit, offset) {
  return {
    users: result.users.map(toUserSummary),
    totalCount: result.totalCount,
    limit,
    offset,
  };
}

function toUserProfileResponse(user, presence) {
  return {
    profile: {
      id: user.id,
      username: user.username,
      name: user.name,
      designation: user.designation,
      department: user.department,
      bio: user.bio,
      avatar: user.avatar,
      status: user.status,
      presence,
      orgId: user.orgId,
    },
  };
}

function toDirectoryEntry(user, presence) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    designation: user.designation,
    department: user.department,
    location: user.location,
    avatar: user.avatar,
    presence,
  };
}

function toDirectoryResponse(result, limit, offset, presenceByUserId) {
  return {
    directory: result.users.map((user) => toDirectoryEntry(user, presenceByUserId.get(user.id) || 'offline')),
    totalCount: result.totalCount,
    limit,
    offset,
  };
}

function parseUserAgent(userAgent) {
  const value = String(userAgent || 'unknown');
  let deviceType = 'web';

  if (/android|iphone|ipad|mobile/i.test(value)) {
    deviceType = 'mobile';
  }

  let browser = 'Unknown';
  let match = value.match(/dOffice App\s*([\d.]+)/i);

  if (match) {
    browser = `dOffice App ${match[1]}`;
  } else {
    match = value.match(/Chrome\/(\d+)/i);
    if (match) {
      browser = `Chrome ${match[1]}`;
    } else {
      match = value.match(/Firefox\/(\d+)/i);
      if (match) {
        browser = `Firefox ${match[1]}`;
      } else {
        match = value.match(/Version\/(\d+).+Safari/i);
        if (match) {
          browser = `Safari ${match[1]}`;
        }
      }
    }
  }

  let os = 'Unknown';

  if (/mac os x|macintosh/i.test(value)) {
    os = 'macOS';
  } else if (/windows/i.test(value)) {
    os = 'Windows';
  } else if (/android/i.test(value)) {
    os = 'Android';
  } else if (/iphone|ipad|ios/i.test(value)) {
    os = 'iOS';
  } else if (/linux/i.test(value)) {
    os = 'Linux';
  }

  return {
    deviceType,
    browser,
    os,
  };
}

function toSessionsResponse(sessions, currentSessionId) {
  return {
    sessions: sessions.map((session) => {
      const parsedAgent = parseUserAgent(session.userAgent);

      return {
        id: session.id,
        deviceType: parsedAgent.deviceType,
        browser: parsedAgent.browser,
        os: parsedAgent.os,
        ip: session.ip,
        lastActive: session.lastActiveAt,
        current: session.id === currentSessionId,
      };
    }),
  };
}

async function getAccessibleOrganizationIds(user, db) {
  if (isSuperAdmin(user)) {
    return null;
  }

  if (!user.orgId) {
    return [];
  }

  if (isOrgAdmin(user)) {
    return organizationRepository.listDescendantIds(user.orgId, db);
  }

  return [user.orgId];
}

async function getOrganizationOrThrow(orgId, db) {
  const organization = await organizationRepository.findOrganizationById(orgId, db);

  if (!organization) {
    throw notFound();
  }

  return organization;
}

async function ensureAccessibleOrganization(user, orgId, db) {
  const organization = await getOrganizationOrThrow(orgId, db);
  const accessibleIds = await getAccessibleOrganizationIds(user, db);

  if (accessibleIds !== null && !accessibleIds.includes(orgId)) {
    throw forbidden();
  }

  return {
    organization,
    accessibleIds,
  };
}

function ensureOrgAdmin(user) {
  if (!isOrgAdmin(user)) {
    throw forbidden();
  }
}

function ensureSuperAdmin(user) {
  if (!isSuperAdmin(user)) {
    throw forbidden();
  }
}

async function ensureAccessibleUser(authUser, targetUser, db) {
  if (authUser.id === targetUser.id) {
    return;
  }

  const accessibleIds = await getAccessibleOrganizationIds(authUser, db);

  if (accessibleIds !== null && !accessibleIds.includes(targetUser.orgId)) {
    throw forbidden();
  }
}

async function getUserOrThrow(userId, db) {
  const user = await userRepository.findActiveUserById(userId, db);

  if (!user) {
    throw notFound();
  }

  return user;
}

async function ensureUniqueUserFields(input, db, excludeUserId) {
  if (input.email && await userRepository.emailExists(input.email, db, { excludeId: excludeUserId })) {
    throw validationError({ email: ['has already been taken'] });
  }

  if (input.username && await userRepository.usernameExists(input.username, db, { excludeId: excludeUserId })) {
    throw validationError({ username: ['has already been taken'] });
  }

  if (
    input.employeeId
    && await userRepository.employeeIdExists(input.employeeId, db, { excludeId: excludeUserId })
  ) {
    throw validationError({ employeeId: ['has already been taken'] });
  }
}

async function buildPresenceByUserId(users, db) {
  const activities = await authRepository.listLatestActivityForUserIds(
    users.map((user) => user.id),
    db,
  );
  const now = Date.now();
  const presenceByUserId = new Map();

  activities.forEach((activity) => {
    const lastActiveTime = activity.lastActiveAt ? new Date(activity.lastActiveAt).getTime() : 0;
    const presence = now - lastActiveTime <= SESSION_ONLINE_WINDOW_MS ? 'online' : 'offline';
    presenceByUserId.set(activity.userId, presence);
  });

  users.forEach((user) => {
    if (!presenceByUserId.has(user.id)) {
      presenceByUserId.set(user.id, 'offline');
    }
  });

  return presenceByUserId;
}

function chooseOrganizationHead(users) {
  if (!users.length) {
    return null;
  }

  const roleWeight = (user) => {
    if (isSuperAdmin(user)) {
      return 3;
    }

    if (isOrgAdmin(user)) {
      return 2;
    }

    return user.managerUserId ? 0 : 1;
  };

  return [...users].sort((left, right) => {
    const roleDelta = roleWeight(right) - roleWeight(left);

    if (roleDelta !== 0) {
      return roleDelta;
    }

    const dateDelta = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();

    if (dateDelta !== 0) {
      return dateDelta;
    }

    return String(left.id).localeCompare(String(right.id));
  })[0];
}

function buildOrgChartUserNode(user, directReportsByManagerId) {
  return {
    userId: user.id,
    name: user.name,
    designation: user.designation,
    avatar: user.avatar,
    reports: (directReportsByManagerId.get(user.id) || [])
      .sort((left, right) => String(left.name || left.username).localeCompare(String(right.name || right.username)))
      .map((report) => buildOrgChartUserNode(report, directReportsByManagerId)),
  };
}

function buildOrgChart(orgId, orgName, organizations, users) {
  const usersByOrgId = new Map();
  const organizationById = new Map();
  const childOrganizationsByParentId = new Map();

  organizations.forEach((organization) => {
    organizationById.set(organization.id, organization);

    if (!childOrganizationsByParentId.has(organization.parentId || '__root__')) {
      childOrganizationsByParentId.set(organization.parentId || '__root__', []);
    }

    childOrganizationsByParentId.get(organization.parentId || '__root__').push(organization);
  });

  users.forEach((user) => {
    if (!usersByOrgId.has(user.orgId)) {
      usersByOrgId.set(user.orgId, []);
    }

    usersByOrgId.get(user.orgId).push(user);
  });

  const directReportsByManagerId = new Map();

  users.forEach((user) => {
    if (user.managerUserId) {
      if (!directReportsByManagerId.has(user.managerUserId)) {
        directReportsByManagerId.set(user.managerUserId, []);
      }

      directReportsByManagerId.get(user.managerUserId).push(user);
    }
  });

  function buildOrganizationNode(targetOrgId) {
    const organization = organizationById.get(targetOrgId);

    if (!organization) {
      return null;
    }

    const organizationUsers = usersByOrgId.get(targetOrgId) || [];
    const headUser = chooseOrganizationHead(organizationUsers);
    const rootReports = [];

    if (headUser) {
      const directReports = directReportsByManagerId.get(headUser.id) || [];
      directReports.forEach((report) => rootReports.push(buildOrgChartUserNode(report, directReportsByManagerId)));
    } else {
      organizationUsers
        .filter((user) => !user.managerUserId)
        .forEach((user) => rootReports.push(buildOrgChartUserNode(user, directReportsByManagerId)));
    }

    const childOrganizations = childOrganizationsByParentId.get(targetOrgId) || [];

    childOrganizations.forEach((childOrganization) => {
      const childNode = buildOrganizationNode(childOrganization.id);

      if (childNode && childNode.head) {
        rootReports.push(childNode.head);
      }
    });

    return {
      orgId: organization.id,
      orgName: organization.name,
      head: headUser
        ? {
          userId: headUser.id,
          name: headUser.name,
          designation: headUser.designation,
          avatar: headUser.avatar,
          reports: rootReports,
        }
        : rootReports[0] || null,
    };
  }

  return {
    orgChart: buildOrganizationNode(orgId) || {
      orgId,
      orgName,
      head: null,
    },
  };
}

async function getCurrentUser(userId) {
  const user = await userRepository.findActiveUserById(userId);

  if (!user) {
    throw notFound();
  }

  return user;
}

async function updateCurrentUser(auth, payload, req) {
  const input = validateCurrentUserUpdatePayload(payload);

  return withTransaction(async (db) => {
    const changes = {};

    if (Object.prototype.hasOwnProperty.call(input, 'password')) {
      changes.passwordHash = await hashPassword(input.password);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'avatar')) {
      changes.avatar = input.avatar;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'bio')) {
      changes.bio = input.bio;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'designation')) {
      changes.designation = input.designation;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'contactInfo')) {
      changes.contactInfo = input.contactInfo;
    }

    const user = await userRepository.updateUser(auth.user.id, changes, db);

    await auditService.logAction(
      {
        req,
        userId: auth.user.id,
        action: 'user.updated',
        entityType: 'user',
        entityId: auth.user.id,
        statusCode: 200,
        metadata: {
          updatedFields: Object.keys(changes),
        },
      },
      db,
    );

    return user;
  });
}

async function listOrganizationUsers(orgId, query, authUser) {
  const filters = validateUserListQuery(query);

  return withTransaction(async (db) => {
    await ensureAccessibleOrganization(authUser, orgId, db);
    const organizationIds = await organizationRepository.listDescendantIds(orgId, db);
    const result = await userRepository.listUsers(
      {
        organizationIds,
        search: filters.search,
        status: filters.status,
        department: filters.department,
        designation: filters.designation,
        location: filters.location,
        roleId: filters.roleId,
        limit: filters.limit,
        offset: filters.offset,
      },
      db,
    );

    return toMultipleUsersResponse(result, filters.limit, filters.offset);
  });
}

async function getUserProfile(userId, authUser) {
  return withTransaction(async (db) => {
    const user = await getUserOrThrow(userId, db);
    await ensureAccessibleUser(authUser, user, db);
    const presenceByUserId = await buildPresenceByUserId([user], db);
    return toUserProfileResponse(user, presenceByUserId.get(user.id) || 'offline');
  });
}

async function createOrganizationUser(orgId, payload, authUser, req) {
  ensureOrgAdmin(authUser);
  const input = validateCreateUserPayload(payload);

  return withTransaction(async (db) => {
    await ensureAccessibleOrganization(authUser, orgId, db);
    await ensureUniqueUserFields(input, db);

    if (input.managerUserId) {
      const managerUser = await getUserOrThrow(input.managerUserId, db);

      if (managerUser.orgId !== orgId) {
        throw validationError({ managerUserId: ['is invalid'] });
      }
    }

    const user = await userRepository.createUser(
      {
        id: generateId('user'),
        username: input.username,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        name: input.name,
        employeeId: input.employeeId,
        designation: input.designation,
        department: input.department,
        bio: input.bio,
        avatar: input.avatar,
        status: 'active',
        contactInfo: input.contactInfo,
        orgId,
        roleIds: input.roleIds,
        location: input.location,
        skills: input.skills,
        managerUserId: input.managerUserId,
      },
      db,
    );

    await auditService.logAction(
      {
        req,
        userId: authUser.id,
        action: 'users.created',
        entityType: 'user',
        entityId: user.id,
        statusCode: 201,
        metadata: {
          orgId,
          roleIds: user.roleIds,
        },
      },
      db,
    );

    return toUserResponse(user);
  });
}

async function updateUserByAdmin(userId, payload, authUser, req) {
  ensureOrgAdmin(authUser);
  const input = validateAdminUpdatePayload(payload);

  return withTransaction(async (db) => {
    const targetUser = await getUserOrThrow(userId, db);
    await ensureAccessibleUser(authUser, targetUser, db);

    if (
      Object.prototype.hasOwnProperty.call(input, 'status')
      && input.status === targetUser.status
    ) {
      throw validationError({ status: ['must be different from current status'] });
    }

    const changes = { ...input };
    const updatedUser = await userRepository.updateUser(userId, changes, db);

    if (changes.status === 'deactivated') {
      await authRepository.revokeAllUserSessions(userId, db);
    }

    await auditService.logAction(
      {
        req,
        userId: authUser.id,
        action: 'users.updated',
        entityType: 'user',
        entityId: userId,
        statusCode: 200,
        metadata: {
          updatedFields: Object.keys(changes),
        },
      },
      db,
    );

    return toUserResponse(updatedUser);
  });
}

async function deactivateUser(userId, authUser, req) {
  ensureOrgAdmin(authUser);

  return withTransaction(async (db) => {
    const targetUser = await getUserOrThrow(userId, db);
    await ensureAccessibleUser(authUser, targetUser, db);
    const updatedUser = await userRepository.updateUser(userId, { status: 'deactivated' }, db);
    await authRepository.revokeAllUserSessions(userId, db);

    await auditService.logAction(
      {
        req,
        userId: authUser.id,
        action: 'users.deactivated',
        entityType: 'user',
        entityId: userId,
        statusCode: 200,
      },
      db,
    );

    return toUserResponse(updatedUser);
  });
}

async function reactivateUser(userId, authUser, req) {
  ensureOrgAdmin(authUser);

  return withTransaction(async (db) => {
    const targetUser = await getUserOrThrow(userId, db);
    await ensureAccessibleUser(authUser, targetUser, db);
    const updatedUser = await userRepository.updateUser(userId, { status: 'active' }, db);

    await auditService.logAction(
      {
        req,
        userId: authUser.id,
        action: 'users.reactivated',
        entityType: 'user',
        entityId: userId,
        statusCode: 200,
      },
      db,
    );

    return toUserResponse(updatedUser);
  });
}

async function deleteUser(userId, authUser, req) {
  ensureSuperAdmin(authUser);

  return withTransaction(async (db) => {
    await getUserOrThrow(userId, db);
    await authRepository.revokeAllUserSessions(userId, db);
    const deleted = await userRepository.softDeleteUser(userId, db);

    if (!deleted) {
      throw notFound();
    }

    await auditService.logAction(
      {
        req,
        userId: authUser.id,
        action: 'users.deleted',
        entityType: 'user',
        entityId: userId,
        statusCode: 204,
      },
      db,
    );
  });
}

async function getDirectory(orgId, query, authUser) {
  const filters = validateDirectoryQuery(query);

  return withTransaction(async (db) => {
    await ensureAccessibleOrganization(authUser, orgId, db);
    const organizationIds = await organizationRepository.listDescendantIds(orgId, db);
    const result = await userRepository.listUsers(
      {
        organizationIds,
        statuses: DIRECTORY_VISIBLE_STATUSES,
        search: filters.search,
        searchMode: 'directory',
        department: filters.department,
        designation: filters.designation,
        location: filters.location,
        skill: filters.skill,
        limit: filters.limit,
        offset: filters.offset,
      },
      db,
    );
    const presenceByUserId = await buildPresenceByUserId(result.users, db);

    return toDirectoryResponse(result, filters.limit, filters.offset, presenceByUserId);
  });
}

async function getOrgChart(orgId, authUser) {
  return withTransaction(async (db) => {
    const { organization } = await ensureAccessibleOrganization(authUser, orgId, db);
    const organizationIds = await organizationRepository.listDescendantIds(orgId, db);
    const organizations = await organizationRepository.listOrganizationsByIds(organizationIds, db);
    const userResult = await userRepository.listUsers(
      {
        organizationIds,
        statuses: DIRECTORY_VISIBLE_STATUSES,
      },
      db,
    );

    return buildOrgChart(organization.id, organization.name, organizations, userResult.users);
  });
}

async function listCurrentUserSessions(auth) {
  const sessions = await authRepository.listActiveSessionsByUserId(auth.user.id);
  return toSessionsResponse(sessions, auth.session.id);
}

async function revokeCurrentUserSession(sessionId, auth, req) {
  return withTransaction(async (db) => {
    const revokedSession = await authRepository.revokeUserSession(sessionId, auth.user.id, db);

    if (!revokedSession) {
      throw notFound();
    }

    await auditService.logAction(
      {
        req,
        userId: auth.user.id,
        action: 'sessions.revoked',
        entityType: 'session',
        entityId: sessionId,
        statusCode: 204,
      },
      db,
    );
  });
}

async function revokeOtherSessions(auth, req) {
  return withTransaction(async (db) => {
    await authRepository.revokeOtherSessions(auth.user.id, auth.session.id, db);

    await auditService.logAction(
      {
        req,
        userId: auth.user.id,
        action: 'sessions.revoked_others',
        entityType: 'session',
        entityId: auth.session.id,
        statusCode: 204,
      },
      db,
    );
  });
}

module.exports = {
  toUserResponse,
  getCurrentUser,
  updateCurrentUser,
  listOrganizationUsers,
  getUserProfile,
  createOrganizationUser,
  updateUserByAdmin,
  deactivateUser,
  reactivateUser,
  deleteUser,
  getDirectory,
  getOrgChart,
  listCurrentUserSessions,
  revokeCurrentUserSession,
  revokeOtherSessions,
};
