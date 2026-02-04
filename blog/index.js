const nunjucks = require("nunjucks");
const path = require("path");
const fs = require("fs");
const { marked } = require("marked");
const { getConfig, propertyPubFetch } = require("../utils");

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

// Slugify function for SEO-friendly URLs
function slugify(text) {
  return (text || "")
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")    // Remove special characters
    .replace(/\s+/g, "-")         // Replace spaces with hyphens
    .replace(/-+/g, "-")          // Replace multiple hyphens with single
    .replace(/^-+|-+$/g, "");     // Trim hyphens from start/end
}

env.addFilter("slugify", slugify);

async function fetchPosts(advertiserId, { limit = 10, cursor = null } = {}) {
  const params = new URLSearchParams({ limit: limit.toString() });
  if (cursor) params.set("cursor", cursor);

  const response = await propertyPubFetch(`/api/advertisers/${advertiserId}/blog-posts?${params}`);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const result = await response.json();
  return {
    posts: result.data || [],
    pagination: result.pagination || { has_next_page: false, next_cursor: null }
  };
}

async function fetchPost(advertiserId, postId) {
  const response = await propertyPubFetch(`/api/advertisers/${advertiserId}/blog-posts/${postId}`);
  if (!response.ok) return null;
  const result = await response.json();
  return result.data || null;
}

module.exports = async function (context, req) {
  try {
    const { advertiserId, site } = getConfig();

    // SWA passes original URL in x-ms-original-url header when rewriting
    const url = req.headers["x-ms-original-url"] || req.url || req.originalUrl || "";

    // Check if this is the blog list: /blog or /blog/
    const isListPage = /\/blog\/?$/.test(url);

    // Check for old URL format: /blog/post/:id (redirect to SEO-friendly URL)
    const oldPostMatch = url.match(/\/blog\/post\/(\d+)/);

    // Check for SEO-friendly URL: /blog/{slug}-{id} (id is the number after the last hyphen)
    const seoPostMatch = url.match(/\/blog\/(.+)-(\d+)$/);

    // Extract post ID from either format
    const postMatch = oldPostMatch || seoPostMatch;

    if (isListPage) {
      // Parse query parameters for pagination
      const urlObj = new URL(url, "https://example.com");
      const cursor = urlObj.searchParams.get("cursor");
      const limit = parseInt(urlObj.searchParams.get("limit") || "10", 10);

      const { posts, pagination } = await fetchPosts(advertiserId, { limit, cursor });
      const html = nunjucks.render("list.njk", { posts, pagination, site, cssPath });

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
      // For old format, postId is in group 1; for SEO format, it's in group 2
      const postId = parseInt(oldPostMatch ? oldPostMatch[1] : seoPostMatch[2], 10);
      const post = await fetchPost(advertiserId, postId);

      if (!post) {
        context.res = {
          status: 404,
          headers: { "Content-Type": "text/html" },
          body: nunjucks.render("not-found.njk", { site, cssPath })
        };
        return;
      }

      // If using old URL format, redirect to SEO-friendly URL
      if (oldPostMatch) {
        const slug = slugify(post.title);
        const newUrl = `/blog/${slug}-${post.id}`;
        context.res = {
          status: 301,
          headers: {
            "Location": newUrl,
            "Cache-Control": "public, max-age=86400"
          },
          body: ""
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
      body: `<h1>Error</h1><p>Something went wrong loading this post. ${err.message}</p>`
    };
  }
};
