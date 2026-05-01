const asyncHandler = require('../../utils/async-handler');
const authService = require('./auth.service');
const { toUserResponse } = require('../users/user.service');

const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, req);
  res.status(201).json(
    toUserResponse(result.user, {
      token: result.token,
      refreshToken: result.refreshToken,
    }),
  );
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, req);
  res.status(200).json(
    toUserResponse(result.user, {
      token: result.token,
      refreshToken: result.refreshToken,
    }),
  );
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.auth, req);
  res.status(200).json({
    message: 'Logged out successfully.',
  });
});

module.exports = {
  register,
  login,
  logout,
};
