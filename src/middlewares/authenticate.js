const { AppError } = require('../utils/errors');
const { verifyAccessToken } = require('../utils/jwt');
const authRepository = require('../modules/auth/auth.repository');
const userRepository = require('../modules/users/user.repository');

async function authenticate(req, res, next) {
  try {
    const authorization = req.get('authorization') || '';

    if (!authorization.startsWith('Bearer ')) {
      throw new AppError(401, 'Missing or invalid authentication token.');
    }

    const token = authorization.slice('Bearer '.length).trim();

    if (!token) {
      throw new AppError(401, 'Missing or invalid authentication token.');
    }

    const payload = verifyAccessToken(token);
    const session = await authRepository.findActiveSessionById(payload.sessionId);

    if (!session) {
      throw new AppError(401, 'Missing or invalid authentication token.');
    }

    const user = await userRepository.findActiveUserById(payload.sub);

    if (!user) {
      throw new AppError(401, 'Missing or invalid authentication token.');
    }

    await authRepository.updateSessionActivity(session.id);

    req.token = token;
    req.auth = {
      user,
      session,
    };

    next();
  } catch (error) {
    next(error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError'
      ? new AppError(401, 'Missing or invalid authentication token.')
      : error);
  }
}

module.exports = authenticate;
