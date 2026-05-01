const { AppError } = require('../utils/errors');

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({
      error: {
        status: 400,
        message: 'Invalid JSON payload.',
      },
    });
  }

  if (error instanceof AppError) {
    if (error.statusCode === 422) {
      return res.status(422).json({
        errors: error.details,
      });
    }

    return res.status(error.statusCode).json({
      error: {
        status: error.statusCode,
        message: error.message,
      },
    });
  }

  console.error(error);

  return res.status(500).json({
    error: {
      status: 500,
      message: 'An unexpected error occurred. Please try again.',
    },
  });
}

module.exports = errorHandler;
