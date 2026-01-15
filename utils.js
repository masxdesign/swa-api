const path = require("path");
const fetch = require("node-fetch");
const https = require("https");

// Load site configuration (copied to api folder during build)
const configPath = path.resolve(__dirname, "site.config.json");
const config = require(configPath);

// API configuration
const isLocalDev = !process.env.WEBSITE_HOSTNAME;
const PROPERTY_PUB_API_BASE_URL = process.env.PROPERTY_PUB_API_BASE_URL || (isLocalDev ? "https://localhost:8083" : "https://property.pub");
const agent = isLocalDev ? new https.Agent({ rejectUnauthorized: false }) : undefined;

function getConfig() {
  return config;
}

/** Fetch wrapper with cache-busting ts param for Azure Front Door */
async function propertyPubFetch(endpoint, options = {}) {
  const url = new URL(`${PROPERTY_PUB_API_BASE_URL}${endpoint}`);
  url.searchParams.set("ts", Date.now());
  return fetch(url.toString(), { agent, ...options });
}

module.exports = {
  getConfig,
  propertyPubFetch
};
