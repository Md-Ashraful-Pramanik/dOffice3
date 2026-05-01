const express = require('express');
const { router, legacyRouter } = require('./routes');
const notFound = require('./middlewares/not-found');
const errorHandler = require('./middlewares/error-handler');

const app = express();

app.use(express.json());
app.set('trust proxy', true);

app.use(router);
app.use(legacyRouter);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
