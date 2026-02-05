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



// Parse rendered HTML to extract headings, inject IDs, and build a TOC structure
function processContentWithTOC(markdownContent) {
  const html = marked.parse(markdownContent || "");
  const toc = [];
  const usedIds = new Set();

  // Inject id attributes into h2/h3 tags and collect TOC entries
  const processed = html.replace(/<(h[23])([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, inner) => {
    const level = parseInt(tag[1], 10);
    const text = inner.replace(/<[^>]+>/g, "").trim(); // strip nested HTML
    let id = slugify(text);

    // Ensure unique IDs
    if (usedIds.has(id)) {
      let i = 2;
      while (usedIds.has(`${id}-${i}`)) i++;
      id = `${id}-${i}`;
    }
    usedIds.add(id);

    toc.push({ id, text, level });
    return `<${tag}${attrs} id="${id}">${inner}</${tag}>`;
  });

  // Build nested structure: h2 = top-level, h3 = children
  const nested = [];
  for (const item of toc) {
    if (item.level === 2) {
      nested.push({ ...item, children: [] });
    } else if (item.level === 3 && nested.length) {
      nested[nested.length - 1].children.push(item);
    } else {
      nested.push({ ...item, children: [] });
    }
  }

  return { html: processed, toc: nested, headingCount: toc.length };
}

// Build an inline CTA block and inject it mid-article after the Nth </p>
function injectPropertyCTA(html, postcodes, advertiserId, { afterParagraph = 3 } = {}) {
  if (!postcodes || !postcodes.length) return html;

  const links = postcodes
    .map(
      (pc) =>
        `<a href="https://property.pub/${encodeURIComponent(advertiserId)}/search?postcode=${encodeURIComponent(pc)}" target="_blank" rel="noopener" class="flex items-center justify-between gap-2 text-sm font-semibold text-white bg-primary rounded-lg px-4 py-2.5 hover:bg-primary/85 transition-colors"><span>Properties in ${pc}</span><span>&rarr;</span></a>`
    )
    .join("\n            ");

  const cta = `
      <aside class="not-prose my-8 rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
        <p class="text-base font-semibold text-slate-800 mb-1">Interested in properties nearby?</p>
        <p class="text-sm text-slate-500 mb-4">Browse available listings in the areas covered by this article.</p>
        <div class="flex flex-col sm:flex-row flex-wrap gap-2">
            ${links}
        </div>
      </aside>`;

  // Find the Nth closing </p> and insert after it
  let count = 0;
  const injected = html.replace(/<\/p>/gi, (match) => {
    count++;
    if (count === afterParagraph) return match + cta;
    return match;
  });

  // If content was too short to hit the threshold, append at the end
  if (count < afterParagraph) return html + cta;
  return injected;
}

async function fetchPosts(advertiserId, { page = 1, limit = 15, search = "" } = {}) {
  const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
  if (search) params.set("search", search);

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
      // Get pagination and search parameters from query string
      const page = parseInt(urlObj.searchParams.get("page") || "1", 10);
      const limit = parseInt(urlObj.searchParams.get("limit") || "15", 10);
      const search = (urlObj.searchParams.get("search") || "").trim();

      const { posts, pagination } = await fetchPosts(advertiserId, { page, limit, search });
      const html = nunjucks.render("list.njk", { posts, pagination, site, cssPath, search });

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

      const { html: rawContentHtml, toc, headingCount } = processContentWithTOC(post.content);
      const contentHtml = injectPropertyCTA(rawContentHtml, post.extractedPostcodes, advertiserId);
      const html = nunjucks.render("post.njk", { post, contentHtml, toc, headingCount, site, cssPath, advertiserId });

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
