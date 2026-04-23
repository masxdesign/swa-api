function resolveCssPathForRequest(req, defaultCssPath = "/assets/index.css") {
  const hostHeader =
    (req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "";

  const isLocalHost = /(^|,)\s*(localhost|127\.0\.0\.1)(:\d+)?\s*($|,)/i.test(hostHeader);

  // In local SWA/Vite dev there is no stable built hashed CSS path.
  if (isLocalHost) {
    return "/style.css";
  }

  return defaultCssPath;
}

module.exports = {
  resolveCssPathForRequest
};
