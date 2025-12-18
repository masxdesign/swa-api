const fetch = require("node-fetch");
const https = require("https");
const path = require("path");

// Load site configuration
const configPath = path.resolve(__dirname, "../site.config.json");
const config = require(configPath);

// API configuration
const isLocalDev = !process.env.WEBSITE_HOSTNAME;
const PROPERTY_PUB_API_BASE_URL = process.env.PROPERTY_PUB_API_BASE_URL || (isLocalDev ? "https://localhost:8083" : "https://property.pub");

// Allow self-signed certs in local development only
const agent = isLocalDev ? new https.Agent({ rejectUnauthorized: false }) : undefined;

async function fetchPosts(advertiserId) {
  const response = await fetch(`${PROPERTY_PUB_API_BASE_URL}/api/advertisers/${advertiserId}/blog-posts`, { agent });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const result = await response.json();
  return result.data || [];
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

function generateSitemap(baseUrl, posts) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  // Homepage
  xml += "  <url>\n";
  xml += `    <loc>${escapeXml(baseUrl)}/</loc>\n`;
  xml += "    <changefreq>weekly</changefreq>\n";
  xml += "    <priority>1.0</priority>\n";
  xml += "  </url>\n";

  // Blog listing page
  xml += "  <url>\n";
  xml += `    <loc>${escapeXml(baseUrl)}/blog</loc>\n`;
  xml += "    <changefreq>daily</changefreq>\n";
  xml += "    <priority>0.8</priority>\n";
  xml += "  </url>\n";

  // Individual blog posts
  for (const post of posts) {
    xml += "  <url>\n";
    xml += `    <loc>${escapeXml(baseUrl)}/blog/post/${post.id}</loc>\n`;

    const lastmod = formatDate(post.updated_at || post.created_at);
    if (lastmod) {
      xml += `    <lastmod>${lastmod}</lastmod>\n`;
    }

    xml += "    <changefreq>monthly</changefreq>\n";
    xml += "    <priority>0.6</priority>\n";
    xml += "  </url>\n";
  }

  xml += "</urlset>";
  return xml;
}

module.exports = async function (context, req) {
  try {
    const { advertiserId } = config;

    // Auto-detect base URL from request host header
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
    const protocol = host.includes("localhost") ? "http" : "https";
    const baseUrl = `${protocol}://${host}`;

    // Fetch all blog posts
    const posts = await fetchPosts(advertiserId);

    // Generate sitemap XML
    const sitemap = generateSitemap(baseUrl, posts);

    context.res = {
      status: 200,
      headers: {
        "Content-Type": "application/xml",
        "Cache-Control": "public, max-age=3600"
      },
      body: sitemap
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
