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

module.exports = {
  toUserResponse,
};
