'use strict';

module.exports = {
  ...require('./tags'),
  ...require('./characters'),
  ...require('./images'),
  ...require('./image-repository'),
  ...require('./vision-temp-store'),
  ...require('./translation'),
  ...require('./assistant'),
  ...require('./prompts'),
  ...require('./vision'),
  ...require('./vision-service'),
  ...require('./storage'),
  ...require('./comfy'),
  ...require('./draw-candidates'),
  ...require('./request-manager'),
  ...require('./status-manager'),
  ...require('./agent-runtime'),
  ...require('./fixed-subagents'),
  ...require('./primary-tools'),
  ...require('./settings'),
  ...require('./ai-client'),
  ...require('./primary-agent')
};

