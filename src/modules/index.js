'use strict';

module.exports = {
  ...require('./tags'),
  ...require('./images'),
  ...require('./image-repository'),
  ...require('./vision-temp-store'),
  ...require('./translation'),
  ...require('./assistant'),
  ...require('./ai-runner'),
  ...require('./prompts'),
  ...require('./vision'),
  ...require('./vision-service'),
  ...require('./storage'),
  ...require('./config-migration'),
  ...require('./comfy'),
  ...require('./draw-candidates'),
  ...require('./calls'),
  ...require('./call-table'),
  ...require('./call-protocol')
};
