const { getConfig } = require("../utils");
const { resolveCssPathForRequest } = require("../css-path");

/**
 * Listing SPA handler
 * Serves the HTML shell for the shared Vite React listing app.
 * The React app reads the domain at runtime to determine which data to load.
 * All /listing/* routes are rewritten here so client-side routing works.
 */
module.exports = async function (context, req) {
  try {
    const { site } = getConfig();
    const cssPath = resolveCssPathForRequest(req);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Listings - ${site.name}</title>
  <meta name="description" content="${site.tagline}">
  <link rel="stylesheet" href="${cssPath}">
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

    context.res = {
      status: 200,
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": "no-cache, must-revalidate"
      },
      body: html
    };

  } catch (err) {
    context.log("listing error:", err);
    context.res = {
      status: 500,
      headers: { "Content-Type": "text/html" },
      body: `<h1>Error</h1><p>Something went wrong loading listings. ${err.message}</p>`
    };
  }
};
