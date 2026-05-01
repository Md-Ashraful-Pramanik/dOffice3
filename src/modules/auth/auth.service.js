const config = require('../../config/env');
const { withTransaction } = require('../../db/pool');
const { AppError, validationError } = require('../../utils/errors');
const { generateId, generateOpaqueToken } = require('../../utils/id');
const { hashPassword, comparePassword } = require('../../utils/password');
const { signAccessToken } = require('../../utils/jwt');
const userRepository = require('../users/user.repository');
const authRepository = require('./auth.repository');
const auditService = require('../audits/audit.service');

function validateCredentialsInput(payload, mode) {
  const errors = {};
  const user = payload && payload.user ? payload.user : {};

  if (!user.email || String(user.email).trim() === '') {
    errors.email = ["can't be blank"];
  }

  if (!user.password || String(user.password).trim() === '') {
    errors.password = ["can't be blank"];
  }

  if (mode === 'register' && (!user.username || String(user.username).trim() === '')) {
    errors.username = ["can't be blank"];
  }

  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  return {
    username: user.username ? String(user.username).trim() : undefined,
    email: String(user.email).trim().toLowerCase(),
    password: String(user.password),
  };
}

function buildSessionPayload(userId, req) {
  return {
    id: generateId('sess'),
    userId,
    refreshToken: generateOpaqueToken(config.auth.refreshTokenLength),
    userAgent: req.get('user-agent') || 'unknown',
    ip: req.ip,
  };
}

async function register(payload, req) {
  const input = validateCredentialsInput(payload, 'register');

  return withTransaction(async (db) => {
    const userCount = await userRepository.countActiveUsers(db);

    if (userCount > 0) {
      throw new AppError(403, 'Super admin registration has already been completed.');
    }

    if (await userRepository.emailExists(input.email, db)) {
      throw validationError({ email: ['has already been taken'] });
    }

    if (await userRepository.usernameExists(input.username, db)) {
      throw validationError({ username: ['has already been taken'] });
    }

    const user = await userRepository.createUser(
      {
        id: generateId('user'),
        username: input.username,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        name: input.username,
        status: 'active',
        contactInfo: {},
        roleIds: ['super_admin'],
      },
      db,
    );

    const sessionPayload = buildSessionPayload(user.id, req);
    const session = await authRepository.createSession(sessionPayload, db);
    const token = signAccessToken({ sub: user.id, sessionId: session.id });

    await auditService.logAction(
      {
        req,
        userId: user.id,
        action: 'auth.registered',
        entityType: 'user',
        entityId: user.id,
        statusCode: 201,
        metadata: { roleIds: user.roleIds },
      },
      db,
    );

    return {
      user,
      token,
      refreshToken: session.refreshToken,
    };
  });
}

async function login(payload, req) {
  const input = validateCredentialsInput(payload, 'login');
  const existingUser = await userRepository.findUserWithPasswordByEmail(input.email);

  if (!existingUser) {
    throw new AppError(401, 'Invalid email or password.');
  }

  const passwordMatches = await comparePassword(input.password, existingUser.passwordHash);

  if (!passwordMatches) {
    throw new AppError(401, 'Invalid email or password.');
  }

  if (existingUser.status !== 'active') {
    throw new AppError(403, 'User account is not active.');
  }

  return withTransaction(async (db) => {
    const user = await userRepository.updateLastLoginAt(existingUser.id, db);
    const sessionPayload = buildSessionPayload(user.id, req);
    const session = await authRepository.createSession(sessionPayload, db);
    const token = signAccessToken({ sub: user.id, sessionId: session.id });

    await auditService.logAction(
      {
        req,
        userId: user.id,
        action: 'auth.logged_in',
        entityType: 'session',
        entityId: session.id,
        statusCode: 200,
      },
      db,
    );

    return {
      user,
      token,
      refreshToken: session.refreshToken,
    };
  });
}

async function logout(auth, req) {
  return withTransaction(async (db) => {
    const revokedSession = await authRepository.revokeSession(auth.session.id, db);

    if (!revokedSession) {
      throw new AppError(401, 'Session is already invalid.');
    }

    await auditService.logAction(
      {
        req,
        userId: auth.user.id,
        action: 'auth.logged_out',
        entityType: 'session',
        entityId: auth.session.id,
        statusCode: 200,
      },
      db,
    );

    return revokedSession;
  });
}

module.exports = {
  register,
  login,
  logout,
};
