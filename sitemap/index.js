const { getConfig, propertyPubFetch } = require("../utils");

const config = getConfig();

const MAX_URLS_PER_SITEMAP = 50000;
const FETCH_PAGE_SIZE = 50;

// Paginate through all blog posts
async function fetchAllPosts(advertiserId) {
  const allPosts = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({ page: page.toString(), limit: FETCH_PAGE_SIZE.toString() });
    const response = await propertyPubFetch(`/api/advertisers/${advertiserId}/blog-posts?${params}`);
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const result = await response.json();
    const posts = result.data || [];
    allPosts.push(...posts);

    hasMore = result.pagination?.has_next_page === true;
    page++;
  }

  return allPosts;
}

function formatDate(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  return date.toISOString().split("T")[0]; // YYYY-MM-DD format
}

function escapeXml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function slugify(text) {
  return (text || "")
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Build all URL entries (static pages + blog posts)
function buildUrlEntries(baseUrl, posts) {
  const entries = [];

  // Homepage
  entries.push({ loc: `${baseUrl}/`, changefreq: "weekly", priority: "1.0" });

  // Blog listing page
  entries.push({ loc: `${baseUrl}/blog`, changefreq: "daily", priority: "0.8" });

  // Individual blog posts
  for (const post of posts) {
    entries.push({
      loc: `${baseUrl}/blog/${slugify(post.title)}-${post.id}`,
      lastmod: formatDate(post.updated_at || post.created_at),
      changefreq: "monthly",
      priority: "0.6"
    });
  }

  return entries;
}

function generateSitemap(entries) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (const entry of entries) {
    xml += "  <url>\n";
    xml += `    <loc>${escapeXml(entry.loc)}</loc>\n`;
    if (entry.lastmod) xml += `    <lastmod>${entry.lastmod}</lastmod>\n`;
    xml += `    <changefreq>${entry.changefreq}</changefreq>\n`;
    xml += `    <priority>${entry.priority}</priority>\n`;
    xml += "  </url>\n";
  }

  xml += "</urlset>";
  return xml;
}

function generateSitemapIndex(baseUrl, totalPages) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (let i = 1; i <= totalPages; i++) {
    xml += "  <sitemap>\n";
    xml += `    <loc>${escapeXml(baseUrl)}/sitemap.xml?page=${i}</loc>\n`;
    xml += "  </sitemap>\n";
  }

  xml += "</sitemapindex>";
  return xml;
}

module.exports = async function (context, req) {
  try {
    const { advertiserId, site } = config;
    const baseUrl = site.url;

    // Fetch all blog posts (paginated internally)
    const posts = await fetchAllPosts(advertiserId);
    const allEntries = buildUrlEntries(baseUrl, posts);

    const url = req.headers["x-ms-original-url"] || req.url || "";
    const urlObj = new URL(url, baseUrl);
    const pageParam = urlObj.searchParams.get("page");

    let body;

    if (allEntries.length <= MAX_URLS_PER_SITEMAP && !pageParam) {
      // Everything fits in one sitemap
      body = generateSitemap(allEntries);
    } else if (!pageParam) {
      // Too many URLs — serve a sitemap index
      const totalPages = Math.ceil(allEntries.length / MAX_URLS_PER_SITEMAP);
      body = generateSitemapIndex(baseUrl, totalPages);
    } else {
      // Serve a specific chunk
      const page = parseInt(pageParam, 10) || 1;
      const start = (page - 1) * MAX_URLS_PER_SITEMAP;
      const chunk = allEntries.slice(start, start + MAX_URLS_PER_SITEMAP);
      body = generateSitemap(chunk);
    }

    context.res = {
      status: 200,
      headers: {
        "Content-Type": "application/xml",
        "Cache-Control": "public, max-age=3600"
      },
      body
    };

  } catch (err) {
    context.log("sitemap error:", err);
    context.res = {
      status: 500,
      headers: { "Content-Type": "text/plain" },
      body: `Error generating sitemap: ${err.message}`
    };
  }
};
