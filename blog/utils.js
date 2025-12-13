const path = require("path");

// Load site configuration (copied to api folder during build)
const configPath = path.resolve(__dirname, "../site.config.json");
const config = require(configPath);

/**
 * Get site configuration
 * @returns {object} - Config with advertiserId and site branding
 */
function getConfig() {
  return config;
}

module.exports = {
  getConfig
};
