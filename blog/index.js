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

// Derive a category pill label from the post title
env.addFilter("postCategory", (title) => {
  const t = (title || "").toLowerCase();
  if (t.includes("market overview")) return "Market Overview";
  if (t.includes("guide")) return "Guide";
  if (t.includes("analysis")) return "Analysis";
  if (t.includes("trend")) return "Trends";
  return "Insight";
});

// Generate a fallback excerpt from the title
env.addFilter("postExcerpt", (post) => {
  if (post.excerpt) return post.excerpt;
  // Try to extract location info from the title
  // Typical title: "Commercial Retail Real Estate Guide - Bond Street, East Marylebone, W5, London"
  const title = post.title || "";
  const parts = title.split(/\s*[-–—]\s*/);
  if (parts.length > 1) {
    const location = parts.slice(1).join(", ").trim();
    return `A commercial snapshot of retail demand, tenant mix and trading dynamics in ${location}.`;
  }
  return `Explore commercial property insights and retail market analysis in this latest article from ShopProperty.`;
});

async function fetchPosts(advertiserId, { page = 1, limit = 10 } = {}) {
  const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });

  const response = await propertyPubFetch(`/api/advertisers/${advertiserId}/blog-posts?${params}`);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const result = await response.json();
  return {
    posts: result.data || [],
    pagination: result.pagination || { page: 1, total_pages: 1, has_next_page: false, has_prev_page: false }
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

    // Parse URL to get pathname (without query string)
    const urlObj = new URL(url, site.url);
    const pathname = urlObj.pathname;

    // Check if this is the blog list: /blog or /blog/ (with or without query params)
    const isListPage = /\/blog\/?$/.test(pathname);

    // Check for old URL format: /blog/post/:id (redirect to SEO-friendly URL)
    const oldPostMatch = pathname.match(/\/blog\/post\/(\d+)/);

    // Check for SEO-friendly URL: /blog/{slug}-{id} (id is the number after the last hyphen)
    const seoPostMatch = pathname.match(/\/blog\/(.+)-(\d+)$/);

    // Extract post ID from either format
    const postMatch = oldPostMatch || seoPostMatch;

    if (isListPage) {
      // Get pagination parameters from query string
      const page = parseInt(urlObj.searchParams.get("page") || "1", 10);
      const limit = parseInt(urlObj.searchParams.get("limit") || "10", 10);

      const { posts, pagination } = await fetchPosts(advertiserId, { page, limit });
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
