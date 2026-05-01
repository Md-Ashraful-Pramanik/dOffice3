class AppError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function validationError(errors) {
  return new AppError(422, 'Validation failed.', errors);
}

module.exports = {
  AppError,
  validationError,
};
