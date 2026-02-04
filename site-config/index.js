const { getConfig } = require("../utils");

const config = getConfig();

module.exports = async function (context) {
  context.res = {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600"
    },
    body: config
  };
};
