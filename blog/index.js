const nunjucks = require("nunjucks");
const path = require("path");
const fs = require("fs");
const { marked } = require("marked");
const fetch = require("node-fetch");
const https = require("https");
const { getConfig } = require("./utils");

// Load asset manifest for CSS path
let cssPath = "/assets/index.css"; // fallback
try {
  const manifestPath = path.join(__dirname, "../asset-manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    cssPath = manifest.css || cssPath;
  }
} catch (e) {
  // Use fallback
}

const env = nunjucks.configure(path.join(__dirname, "templates"), { autoescape: true });

env.addFilter("markdown", (str) => marked.parse(str || ""));

// API configuration
const isLocalDev = !process.env.WEBSITE_HOSTNAME; // Azure SWA sets this in production
const PROPERTY_PUB_API_BASE_URL = process.env.PROPERTY_PUB_API_BASE_URL || (isLocalDev ? "https://localhost:8083" : "https://property.pub");

// Allow self-signed certs in local development only
const agent = isLocalDev ? new https.Agent({ rejectUnauthorized: false }) : undefined;

async function fetchPosts(advertiserId) {
  const response = await fetch(`${PROPERTY_PUB_API_BASE_URL}/api/advertisers/${advertiserId}/blog-posts`, { agent });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const result = await response.json();
  return result.data || [];
}

async function fetchPost(advertiserId, postId) {
  const response = await fetch(`${PROPERTY_PUB_API_BASE_URL}/api/advertisers/${advertiserId}/blog-posts/${postId}`, { agent });
  if (!response.ok) return null;
  const result = await response.json();
  return result.data || null;
}

module.exports = async function (context, req) {
  try {
    const { advertiserId, site } = getConfig();

    // SWA passes original URL in x-ms-original-url header when rewriting
    const url = req.headers["x-ms-original-url"] || req.url || req.originalUrl || "";

    // Check if this is a single post request: /blog/post/:id
    const postMatch = url.match(/\/blog\/post\/(\d+)/);

    // Check if this is the blog list: /blog or /blog/
    const isListPage = /\/blog\/?$/.test(url);

    if (isListPage) {
      const posts = await fetchPosts(advertiserId);
      const html = nunjucks.render("list.njk", { posts, site, cssPath });

      context.res = {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "public, max-age=300"
        },
        body: html
      };
      return;
    }

    if (postMatch) {
      const postId = parseInt(postMatch[1], 10);
      const post = await fetchPost(advertiserId, postId);

      if (!post) {
        context.res = {
          status: 404,
          headers: { "Content-Type": "text/html" },
          body: nunjucks.render("not-found.njk", { site, cssPath })
        };
        return;
      }

      const html = nunjucks.render("post.njk", { post, site, cssPath });

      context.res = {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "public, max-age=300"
        },
        body: html
      };
      return;
    }

    // No match - 404
    context.res = {
      status: 404,
      headers: { "Content-Type": "text/html" },
      body: nunjucks.render("not-found.njk", { site, cssPath })
    };

  } catch (err) {
    context.log("blog-post error:", err);
    context.res = {
      status: 500,
      headers: { "Content-Type": "text/html" },
      body: "<h1>Error</h1><p>Something went wrong loading this post."+err.message+"</p>"
    };
  }
};
