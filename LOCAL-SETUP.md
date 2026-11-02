# Local setup

Use Node.js 24+. Run npm ci, npm test, then npm start.
Open http://127.0.0.1:8080 for the integrated calendar. This mode uses the live D1 database.

For isolated tests: npm run preview, then http://127.0.0.1:8081/?preview=1.
The isolated preview never connects to Cloudflare. Its test account is defined in scripts/preview.mjs.

Allowed production API browser origins: https://tawuahc-oss.github.io, http://127.0.0.1:8080, http://localhost:8080.
Worker source is worker.js; deployment config is wrangler.jsonc. Original files in Documents are preserved.
See docs/DEVELOPMENT.md and docs/OPERATIONS.md for full instructions.
