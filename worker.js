/**
 * nds-cal — Cloudflare Worker API v7
 * Public: health, categories, events
 * Admin: login, me, logout, category CRUD, event CRUD, recurrence CRUD, occurrence exceptions
 * D1 binding: DB
 * Secrets: ADMIN_USERNAME, ADMIN_PASSWORD_HASH

 */

import {withPublicBackup} from './public-backup.js';
const WEBSITE_ORIGIN = "https://tawuahc-oss.github.io";
const ALLOWED_ORIGINS = new Set([WEBSITE_ORIGIN, "http://127.0.0.1:8080", "http://localhost:8080"]);
const SESSION_HOURS = 8;
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const encoder = new TextEncoder();

const calendarWorker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;
    const origin = request.headers.get("Origin");

    const cors = ALLOWED_ORIGINS.has(origin) ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Max-Age": "3600",
      "Vary": "Origin"
    } : {};

    const headers = {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    };

    function json(data, status = 200) {
      return new Response(JSON.stringify(data, null, 2), { status, headers });
    }

    if (origin && origin !== url.origin && !ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origin not allowed" }, 403);
    }

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (!env.DB) {
      return json({ error: "Database unavailable" }, 503);
    }

    try {
      if ((path === "/" || path === "/api/health") && method === "GET") {
        const test = await env.DB.prepare("SELECT 1 AS value").first();
        return json({
          project: "nds-cal",
          status: "online",
          database: test?.value === 1 ? "connected" : "error",
          api_version: 7
        });
      }

      // Public: read categories.
      if (path === "/api/categories" && method === "GET") {
        const result = await env.DB.prepare(`
          SELECT id, name, color, sort_order
          FROM categories
          ORDER BY sort_order ASC, name ASC
        `).all();
        return json({ categories: result.results });
      }

      // Public: read events. Optional inclusive from/to expands recurring occurrences.
      if ((path === "/api/events" || path === "/api/calendar" || path === "/api/admin/calendar") && method === "GET") {
        const admin = path === "/api/admin/calendar";
        if (admin && !await getSession(request, env)) return json({ error: "Unauthorized" }, 401);
        if (url.searchParams.has("from") || url.searchParams.has("to")) {
          const range = readRange(url);
          if (range.error) return json({ error: range.error }, 400);
          const items = await calendarOccurrences(env, range.from, range.to);
          await hydrateOccurrenceCategories(items, env);
          return json({ events: admin ? items : items.map(({ notes, ...event }) => event), from: range.from, to: range.to });
        }
        const result = await env.DB.prepare(`
          SELECT e.id, e.title, e.description, e.location,
                 e.start_at, e.end_at, e.all_day, e.category_id,
                 c.name AS category_name, c.color AS category_color
          FROM events e
          LEFT JOIN categories c ON e.category_id = c.id
          ORDER BY e.start_at ASC
          LIMIT 1001
        `).all();
        if (result.results.length > 1000) throw new Error("TOO_MANY_OCCURRENCES");
        return json({ events: result.results });
      }

      // Administrator: login.
      if (path === "/api/admin/login" && method === "POST") {
        if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD_HASH) {
          return json({ error: "Admin credentials are not configured" }, 503);
        }

        const body = await readBody(request);
        const username = body?.username;
        const password = body?.password;

        if (typeof username !== "string" || typeof password !== "string" ||
            username.length > 100 || password.length > 1024) {
          return json({ error: "Invalid credentials" }, 401);
        }

        const now = Math.floor(Date.now() / 1000);
        const cutoff = now - LOGIN_WINDOW_SECONDS;
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const prefix = `${await sha256(ip)}:`;

        // Reserve attempts atomically, including concurrent requests.
        const reservation = await env.DB.prepare(
          "INSERT INTO login_attempts(id,attempted_at) SELECT ?,? WHERE (SELECT COUNT(*) FROM login_attempts WHERE substr(id, 1, length(?3)) = ?3 AND attempted_at >= ?) < ?"
        ).bind(prefix + crypto.randomUUID(), now, prefix, cutoff, LOGIN_LIMIT).run();
        if (!reservation.meta.changes) return json({error: "Too many login attempts. Try later."}, 429);
        const passwordCorrect = await verifyPassword(password, await activePasswordHash(env));
        const usernameCorrect = username === env.ADMIN_USERNAME;
        if (!usernameCorrect || !passwordCorrect) return json({error: "Invalid username or password"}, 401);

        const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
        const tokenHash = await sha256(token);
        const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();

        await env.DB.prepare(`
          INSERT INTO admin_sessions (id, token_hash, expires_at)
          VALUES (?, ?, ?)
        `).bind(crypto.randomUUID(), tokenHash, expiresAt).run();

        await env.DB.prepare(`DELETE FROM login_attempts WHERE substr(id, 1, length(?1)) = ?1`)
          .bind(prefix).run();

        return json({ success: true, token, expires_at: expiresAt });
      }

      // All routes below require a valid administrator session.
      if (path === "/api/admin/reset-password" && method === "POST") {
        const body = await readBody(request);
        if (!validNewPassword(body.new_password, env.ADMIN_USERNAME)) return json({error:"Use 6-128 characters and avoid common passwords; 12 or more is recommended"},400);
        if (!await reserveCredentialAttempt(request,env,"recovery")) return json({error:"Too many login attempts. Try later."},429);
        const credentials = await env.DB.prepare("SELECT recovery_hash FROM admin_credentials WHERE id=1").first();
        if (typeof body.recovery_code!=="string" || !/^[a-f0-9]{64}$/.test(body.recovery_code) ||
            !credentials?.recovery_hash || await sha256(body.recovery_code)!==credentials.recovery_hash) {
          return json({error:"Invalid recovery code"},401);
        }
        const hash=await passwordHash(body.new_password);
        const changed=await env.DB.batch([
          env.DB.prepare("UPDATE admin_credentials SET password_hash=?,recovery_hash=NULL,updated_at=? WHERE id=1 AND recovery_hash=? RETURNING id")
            .bind(hash,new Date().toISOString(),await sha256(body.recovery_code)),
          env.DB.prepare("DELETE FROM admin_sessions WHERE EXISTS(SELECT 1 FROM admin_credentials WHERE id=1 AND password_hash=?)").bind(hash),
          env.DB.prepare("INSERT INTO audit_logs(id,action,entity_type,details_json) SELECT ?,'reset_password','admin',? WHERE EXISTS(SELECT 1 FROM admin_credentials WHERE id=1 AND password_hash=?)")
            .bind(crypto.randomUUID(),JSON.stringify({sessions_revoked:true}),hash)
        ]);
        if(!changed[0].results?.length)return json({error:"Invalid recovery code"},401);
        return json({success:true,message:"Password reset. Sign in again and generate a new recovery code."});
      }
      if (path.startsWith("/api/admin/")) {
        const session = await getSession(request, env);
        if (!session) return json({ error: "Unauthorized" }, 401);

        if (path === "/api/admin/me" && method === "GET") {
          return json({ authenticated: true, username: env.ADMIN_USERNAME });
        }

        if (path === "/api/admin/logout" && method === "POST") {
          await env.DB.prepare("DELETE FROM admin_sessions WHERE id = ?")
            .bind(session.id).run();
          return json({ success: true, message: "Logged out" });
        }
        if (["/api/admin/change-password","/api/admin/recovery-code"].includes(path) && method === "POST") {
          const body=await readBody(request);
          if(!await reserveCredentialAttempt(request,env,"password-change"))return json({error:"Too many login attempts. Try later."},429);
          if(typeof body.current_password!=="string" || body.current_password.length>1024 ||
            !await verifyPassword(body.current_password,await activePasswordHash(env)))return json({error:"Current password is incorrect"},400);
          if(path==="/api/admin/change-password"){
            if(!validNewPassword(body.new_password,env.ADMIN_USERNAME))return json({error:"Use 6-128 characters and avoid common passwords; 12 or more is recommended"},400);
            if(await verifyPassword(body.new_password,await activePasswordHash(env)))return json({error:"Choose a different password"},400);
            const hash=await passwordHash(body.new_password);
            await env.DB.batch([
              env.DB.prepare("INSERT INTO admin_credentials(id,password_hash,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash,recovery_hash=NULL,updated_at=excluded.updated_at")
                .bind(hash,new Date().toISOString()),
              env.DB.prepare("DELETE FROM admin_sessions"),
              auditStatement(env,"change_password","admin",null,{sessions_revoked:true})
            ]);
            return json({success:true,message:"Password changed. Sign in again."});
          }
          const recoveryCode=toHex(crypto.getRandomValues(new Uint8Array(32)));
          await env.DB.batch([
            env.DB.prepare("INSERT INTO admin_credentials(id,recovery_hash,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET recovery_hash=excluded.recovery_hash,updated_at=excluded.updated_at")
              .bind(await sha256(recoveryCode),new Date().toISOString()),
            auditStatement(env,"rotate_recovery_code","admin",null,{})
          ]);
          return json({success:true,recovery_code:recoveryCode});
        }

        // Read-only preview uses exactly the same validation and expansion as saved events.
        if (path === "/api/admin/recurrence-preview" && method === "POST") {
          const body = await readBody(request);
          const checked = validateEvent(body.event);
          if (checked.error) return json({ error: checked.error }, 400);
          const checkedRule = validateRecurrence(body.rule, checked.event);
          if (checkedRule.error) return json({ error: checkedRule.error }, 400);
          const from = checked.event.start_at.slice(0, 10);
          // At most 366 calendar days, including the anchor; never expand indefinitely.
          const to = dayDate(Math.min(dateDay(from) + 365, dateDay("9999-12-31")));
          const record = { ...checked.event, ...checkedRule.rule, id: "preview", event_id: "preview" };
          const occurrences = expandSeries(record, from, to, new Map());
          return json({ from, to, total: occurrences.length,
            starts: occurrences.slice(0, 12).map(item => item.start_at) });
        }

        // The integrated editor saves the base event and its rule in one D1 transaction.
        const calendarEdit = path.match(/^\/api\/admin\/calendar-events\/([a-f0-9-]{36})$/i);
        if ((path === "/api/admin/calendar-events" && method === "POST") ||
            (calendarEdit && method === "PUT")) {
          const result = await saveCalendarEvent(env, await readBody(request), calendarEdit?.[1]);
          return json(result.data, result.status);
        }
        if (path === "/api/admin/export" && method === "GET") {
          // Tokens, session hashes and login attempts are never part of a browser export.
          const tables = ["categories", "events", "recurrence_rules", "event_exceptions", "audit_logs"];
          const rows = await env.DB.batch(tables.map(table => env.DB.prepare("SELECT * FROM " + table)));
          return json({ format: "nds-cal-export", version: 1, timezone: "Asia/Hong_Kong",
            exported_at: new Date().toISOString(),
            tables: Object.fromEntries(tables.map((table, i) => [table, rows[i].results])) });
        }
        if (path === "/api/admin/archive-preview" && method === "GET") {
          const before=url.searchParams.get("before");
          if(!validArchiveCutoff(before))return json({error:"Keep the current and previous calendar year online"},400);
          const candidates=await archiveCandidates(env,before);
          return json({before,candidates,notice:"Ongoing series, count-only series and any series with exceptions are protected."});
        }
        // Administrator: list categories.
        if (path === "/api/admin/categories" && method === "GET") {
          const result = await env.DB.prepare(`
            SELECT id, name, color, sort_order, created_at
            FROM categories
            ORDER BY sort_order ASC, name ASC
          `).all();
          return json({ categories: result.results });
        }

        if (path === "/api/admin/categories/order" && method === "PUT") {
          const ids = (await readBody(request))?.ids;
          if (!Array.isArray(ids) || ids.length > 1000 ||
              ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) {
            return json({ error: "Invalid category order" }, 400);
          }
          const result = await env.DB.prepare(`
            WITH requested AS (SELECT key, value FROM json_each(?))
            UPDATE categories SET sort_order = (SELECT key FROM requested WHERE value = categories.id)
            WHERE (SELECT COUNT(*) FROM categories) = (SELECT COUNT(*) FROM requested)
              AND NOT EXISTS (SELECT 1 FROM requested WHERE value NOT IN (SELECT id FROM categories))
          `).bind(JSON.stringify(ids)).run();
          if (result.meta.changes !== ids.length) return json({ error: "分類清單已變更，請重新整理後再試。" }, 409);
          return json({ success: true });
        }

        // Administrator: create category.
        if (path === "/api/admin/categories" && method === "POST") {
          const input = validateCategory(await readBody(request));
          if (input.error) return json({ error: input.error }, 400);

          const exists = await env.DB.prepare(
            "SELECT id FROM categories WHERE name = ? COLLATE NOCASE LIMIT 1"
          ).bind(input.category.name).first();
          if (exists) return json({ error: "Category name already exists" }, 409);

          const id = crypto.randomUUID();
          const c = input.category;
          await env.DB.batch([
            env.DB.prepare(`
              INSERT INTO categories (id, name, color, sort_order)
              VALUES (?, ?, ?, ?)
            `).bind(id, c.name, c.color, c.sort_order),
            auditStatement(env, "create", "category", id, { after: c })
          ]);
          return json({ success: true, category: { id, ...c } }, 201);
        }

        const categoryMatch = path.match(
          /^\/api\/admin\/categories\/([a-f0-9-]{36})$/i
        );

        if (categoryMatch) {
          const id = categoryMatch[1];
          const old = await env.DB.prepare(
            "SELECT id, name, color, sort_order FROM categories WHERE id = ?"
          ).bind(id).first();
          if (!old) return json({ error: "Category not found" }, 404);

          if (method === "PUT") {
            const input = validateCategory(await readBody(request));
            if (input.error) return json({ error: input.error }, 400);

            const c = input.category;
            const exists = await env.DB.prepare(`
              SELECT id FROM categories
              WHERE name = ? COLLATE NOCASE AND id <> ? LIMIT 1
            `).bind(c.name, id).first();
            if (exists) return json({ error: "Category name already exists" }, 409);

            await env.DB.batch([
              env.DB.prepare(`
                UPDATE categories
                SET name = ?, color = ?, sort_order = ?
                WHERE id = ?
              `).bind(c.name, c.color, c.sort_order, id),
              auditStatement(env, "update", "category", id, {
                before: old, after: c
              })
            ]);
            return json({ success: true, category: { id, ...c } });
          }

          if (method === "DELETE") {
            // Prevent accidental loss of event-category associations.
            const linked = await env.DB.prepare(`
              SELECT COUNT(*) AS total FROM events WHERE category_id = ?
            `).bind(id).first();
            if (Number(linked?.total || 0) > 0) {
              return json({
                error: "Category is used by events; reassign those events first"
              }, 409);
            }

            await env.DB.batch([
              env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(id),
              auditStatement(env, "delete", "category", id, { before: old })
            ]);
            return json({ success: true, deleted_id: id });
          }
        }

        // Administrator: list events (individual events, no recurrence expansion yet).
        if (path === "/api/admin/events" && method === "GET") {
          const limit=Number(url.searchParams.get("limit")||500),offset=Number(url.searchParams.get("offset")||0);
          if(!Number.isInteger(limit)||limit<1||limit>500||!Number.isInteger(offset)||offset<0||offset>1000000)return json({error:"Invalid pagination"},400);
          const result = await env.DB.prepare(`
            SELECT e.id, e.title, e.description, e.location, e.start_at,
                   e.end_at, e.all_day, e.category_id, e.notes,
                   e.created_at, e.updated_at,
                   c.name AS category_name, c.color AS category_color,
                   r.id AS recurrence_rule_id
            FROM events e
            LEFT JOIN categories c ON e.category_id = c.id
            LEFT JOIN recurrence_rules r ON r.event_id = e.id
            ORDER BY e.start_at DESC, e.id ASC LIMIT ? OFFSET ?
          `).bind(limit+1,offset).all();
          return json({ events: result.results.slice(0,limit), has_more: result.results.length>limit, next_offset: offset+limit });
        }

        // Administrator: add an ordinary (non-recurring) event.
        if (path === "/api/admin/events" && method === "POST") {
          const input = validateEvent(await readBody(request));
          if (input.error) return json({ error: input.error }, 400);
          const e = input.event;
          if (e.category_id) {
            const category = await env.DB.prepare(
              "SELECT id FROM categories WHERE id = ?"
            ).bind(e.category_id).first();
            if (!category) return json({ error: "Category not found" }, 400);
          }
          const id = crypto.randomUUID();
          await env.DB.batch([
            env.DB.prepare(`
              INSERT INTO events
                (id, title, description, location, start_at, end_at,
                 all_day, category_id, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              id, e.title, e.description, e.location, e.start_at, e.end_at,
              e.all_day, e.category_id, e.notes
            ),
            auditStatement(env, "create", "event", id, { after: e })
          ]);
          return json({ success: true, event: { id, ...e } }, 201);
        }

        const eventMatch = path.match(/^\/api\/admin\/events\/([a-f0-9-]{36})$/i);
        if (eventMatch) {
          const id = eventMatch[1];
          const previous = await env.DB.prepare(
            "SELECT * FROM events WHERE id = ?"
          ).bind(id).first();
          if (!previous) return json({ error: "Event not found" }, 404);

          // Prevent accidental modification of a whole recurring series.
          const recurrence = await env.DB.prepare(
            "SELECT id FROM recurrence_rules WHERE event_id = ?"
          ).bind(id).first();
          if (recurrence) return json({
            error: "Recurring events must be managed in the recurrence module"
          }, 409);

          if (method === "PUT") {
            const input = validateEvent(await readBody(request));
            if (input.error) return json({ error: input.error }, 400);
            const e = input.event;
            if (e.category_id) {
              const category = await env.DB.prepare(
                "SELECT id FROM categories WHERE id = ?"
              ).bind(e.category_id).first();
              if (!category) return json({ error: "Category not found" }, 400);
            }
            await env.DB.batch([
              env.DB.prepare(`
                UPDATE events SET
                  title = ?, description = ?, location = ?,
                  start_at = ?, end_at = ?, all_day = ?, category_id = ?,
                  notes = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `).bind(
                e.title, e.description, e.location, e.start_at, e.end_at,
                e.all_day, e.category_id, e.notes, id
              ),
              auditStatement(env, "update", "event", id, {
                before: previous, after: e
              })
            ]);
            return json({ success: true, event: { id, ...e } });
          }

          if (method === "DELETE") {
            await env.DB.batch([
              env.DB.prepare("DELETE FROM events WHERE id = ?").bind(id),
              auditStatement(env, "delete", "event", id, { before: previous })
            ]);
            return json({ success: true, deleted_id: id });
          }
        }

        // Administrator: recurring series list.
        if (path === "/api/admin/recurrences" && method === "GET") {
          const limit=Number(url.searchParams.get("limit")||500),offset=Number(url.searchParams.get("offset")||0);
          if(!Number.isInteger(limit)||limit<1||limit>500||!Number.isInteger(offset)||offset<0||offset>1000000)return json({error:"Invalid pagination"},400);
          const result = await env.DB.prepare(`
            SELECT r.*, e.title, e.description, e.location, e.start_at,
                   e.end_at, e.all_day, e.category_id, e.notes,
                   c.name AS category_name, c.color AS category_color
            FROM recurrence_rules r
            JOIN events e ON e.id = r.event_id
            LEFT JOIN categories c ON c.id = e.category_id
            ORDER BY e.start_at ASC, r.id ASC LIMIT ? OFFSET ?
          `).bind(limit+1,offset).all();
          return json({ recurrences: result.results.slice(0,limit), has_more: result.results.length>limit, next_offset: offset+limit });
        }

        // Attach a recurring rule to an existing ordinary event.
        if (path === "/api/admin/recurrences" && method === "POST") {
          const body = await readBody(request);
          if (typeof body.event_id !== "string" || !isUuid(body.event_id)) {
            return json({ error: "Valid event_id required" }, 400);
          }
          const base = await env.DB.prepare("SELECT * FROM events WHERE id = ?")
            .bind(body.event_id).first();
          if (!base) return json({ error: "Event not found" }, 404);
          const existing = await env.DB.prepare(
            "SELECT id FROM recurrence_rules WHERE event_id = ?"
          ).bind(base.id).first();
          if (existing) return json({ error: "Event already has recurrence" }, 409);
          const input = validateRecurrence(body.rule, base);
          if (input.error) return json({ error: input.error }, 400);
          const r = input.rule;
          const id = crypto.randomUUID();
          await env.DB.batch([
            env.DB.prepare(`
              INSERT INTO recurrence_rules
                (id, event_id, frequency, interval_value, by_weekday,
                 day_of_month, until_date, occurrence_count)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(id, base.id, r.frequency, r.interval_value,
              r.by_weekday, r.day_of_month, r.until_date, r.occurrence_count),
            auditStatement(env, "create", "recurrence", id, { event_id: base.id, rule: r })
          ]);
          return json({ success: true, recurrence: { id, event_id: base.id, ...r } }, 201);
        }

        const recurringMatch = path.match(/^\/api\/admin\/recurrences\/([0-9a-f-]{36})$/i);
        const occurrenceMatch = path.match(/^\/api\/admin\/recurrences\/([0-9a-f-]{36})\/occurrences$/i);
        const exceptionsMatch = path.match(/^\/api\/admin\/recurrences\/([0-9a-f-]{36})\/exceptions$/i);
        const exceptionItemMatch = path.match(/^\/api\/admin\/recurrences\/([0-9a-f-]{36})\/exceptions\/(.+)$/i);
        if (recurringMatch || occurrenceMatch || exceptionsMatch || exceptionItemMatch) {
          const ruleId = (recurringMatch || occurrenceMatch || exceptionsMatch || exceptionItemMatch)[1];
          const record = await env.DB.prepare(`
            SELECT r.*, e.title, e.description, e.location, e.start_at,
                   e.end_at, e.all_day, e.category_id, e.notes,
                   c.name AS category_name, c.color AS category_color
            FROM recurrence_rules r
            JOIN events e ON r.event_id = e.id
            LEFT JOIN categories c ON c.id = e.category_id
            WHERE r.id = ?
          `).bind(ruleId).first();
          if (!record) return json({ error: "Recurring series not found" }, 404);

          if (occurrenceMatch && method === "GET") {
            const range = readRange(url);
            if (range.error) return json({ error: range.error }, 400);
            const exc = await loadExceptions(env, [ruleId]);
            const items = expandSeries(record, range.from, range.to, exc, true);
            await hydrateOccurrenceCategories(items, env);
            return json({ occurrences: items, from: range.from, to: range.to });
          }

          if (exceptionsMatch && method === "GET") {
            const result = await env.DB.prepare(`
              SELECT id, original_start_at, action, override_json, created_at
              FROM event_exceptions WHERE recurrence_rule_id = ?
              ORDER BY original_start_at ASC LIMIT 501
            `).bind(ruleId).all();
            return json({ exceptions: result.results });
          }

          if (exceptionsMatch && method === "POST") {
            const body = await readBody(request);
            const original = body.original_start_at;
            if (!validOriginalOccurrence(record, original)) {
              return json({ error: "Original occurrence is outside this series" }, 400);
            }
            if (body.action !== "cancelled" && body.action !== "modified") {
              return json({ error: "action must be cancelled or modified" }, 400);
            }
            let overrides = null;
            if (body.action === "modified") {
              const checked = validateOccurrenceOverride(body.override, record, original);
              if (checked.error) return json({ error: checked.error }, 400);
              if (checked.override.category_id) {
                const c = await env.DB.prepare("SELECT id FROM categories WHERE id = ?")
                  .bind(checked.override.category_id).first();
                if (!c) return json({ error: "Category not found" }, 400);
              }
              overrides = JSON.stringify(checked.override);
            }
            const id = crypto.randomUUID();
            await env.DB.batch([
              env.DB.prepare(`
                INSERT INTO event_exceptions
                  (id, recurrence_rule_id, original_start_at, action, override_json)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(recurrence_rule_id, original_start_at)
                DO UPDATE SET action = excluded.action, override_json = excluded.override_json
              `).bind(id, ruleId, original, body.action, overrides),
              auditStatement(env, "upsert", "occurrence_exception", ruleId,
                { original_start_at: original, action: body.action, override: overrides ? JSON.parse(overrides) : null })
            ]);
            return json({ success: true, original_start_at: original, action: body.action });
          }

          if (exceptionItemMatch && method === "DELETE") {
            let original;
            try { original = decodeURIComponent(exceptionItemMatch[2]); }
            catch { return json({ error: "Invalid occurrence key" }, 400); }
            const old = await env.DB.prepare(`
              SELECT * FROM event_exceptions
              WHERE recurrence_rule_id = ? AND original_start_at = ?
            `).bind(ruleId, original).first();
            if (!old) return json({ error: "Exception not found" }, 404);
            await env.DB.batch([
              env.DB.prepare(`
                DELETE FROM event_exceptions
                WHERE recurrence_rule_id = ? AND original_start_at = ?
              `).bind(ruleId, original),
              auditStatement(env, "delete", "occurrence_exception", ruleId,
                { original_start_at: original, action: old.action })
            ]);
            return json({ success: true });
          }

          if (recurringMatch && method === "PUT") {
            const body = await readBody(request);
            const eInput = validateEvent(body.event);
            if (eInput.error) return json({ error: eInput.error }, 400);
            const rInput = validateRecurrence(body.rule, eInput.event);
            if (rInput.error) return json({ error: rInput.error }, 400);
            const e = eInput.event;
            const r = rInput.rule;
            if (e.category_id) {
              const c = await env.DB.prepare("SELECT id FROM categories WHERE id = ?")
                .bind(e.category_id).first();
              if (!c) return json({ error: "Category not found" }, 400);
            }
            // Existing exceptions refer to original dates. Do not silently orphan them.
            const exc = await env.DB.prepare(`
              SELECT COUNT(*) AS total FROM event_exceptions WHERE recurrence_rule_id = ?
            `).bind(ruleId).first();
            const ruleKeys = ["frequency", "interval_value", "by_weekday", "day_of_month", "until_date", "occurrence_count"];
            const scheduleChanged = e.start_at !== record.start_at ||
              e.all_day !== record.all_day ||
              ruleKeys.some(key => (r[key] ?? null) !== (record[key] ?? null));
            if (Number(exc?.total) && scheduleChanged) return json({
              error: "Remove or restore occurrence exceptions before changing recurrence schedule"
            }, 409);
            await env.DB.batch([
              env.DB.prepare(`
                UPDATE events SET title = ?, description = ?, location = ?,
                  start_at = ?, end_at = ?, all_day = ?, category_id = ?, notes = ?,
                  updated_at = CURRENT_TIMESTAMP WHERE id = ?
              `).bind(e.title, e.description, e.location, e.start_at, e.end_at,
                e.all_day, e.category_id, e.notes, record.event_id),
              env.DB.prepare(`
                UPDATE recurrence_rules SET frequency = ?, interval_value = ?,
                  by_weekday = ?, day_of_month = ?, until_date = ?, occurrence_count = ?,
                  updated_at = CURRENT_TIMESTAMP WHERE id = ?
              `).bind(r.frequency, r.interval_value, r.by_weekday, r.day_of_month,
                r.until_date, r.occurrence_count, ruleId),
              auditStatement(env, "update", "recurrence", ruleId,
                { before: record, after: { event: e, rule: r } })
            ]);
            return json({ success: true, id: ruleId });
          }

          if (recurringMatch && method === "DELETE") {
            // Deleting the parent event also removes the rule and its exceptions via FK.
            await env.DB.batch([
              env.DB.prepare("DELETE FROM events WHERE id = ?").bind(record.event_id),
              auditStatement(env, "delete", "recurrence", ruleId, { before: record })
            ]);
            return json({ success: true, deleted_series_id: ruleId });
          }
        }

        return json({ error: "Not found" }, 404);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      // Never log passwords, tokens, or the full ADMIN_PASSWORD_HASH.
      console.error("Worker error:", error.name, error.message);
      if (error.message === "INVALID_JSON") return json({ error: "Invalid JSON" }, 400);
      if (error.message === "BODY_TOO_LARGE") return json({ error: "Request too large" }, 413);
      if (error.message === "TOO_MANY_OCCURRENCES") return json({ error: "Too many occurrences in date range" }, 413);
      return json({ error: "Internal server error" }, 500);
    }
  }
};

function validArchiveCutoff(before){
  const year=Number(new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric"}).format(new Date()));
  return validDate(before)&&before<=String(year-1)+"-01-01";
}
async function archiveCandidates(env,before){
  const rows=await env.DB.prepare(
    "SELECT e.id,e.title,e.start_at,e.end_at,e.updated_at,r.id AS rule_id,r.until_date,r.occurrence_count,r.updated_at AS rule_updated_at,"+
    "(SELECT COUNT(*) FROM event_exceptions x WHERE x.recurrence_rule_id=r.id) AS exception_count "+
    "FROM events e LEFT JOIN recurrence_rules r ON r.event_id=e.id WHERE substr(e.start_at,1,10)<?"
  ).bind(before).all();
  return rows.results.filter(e=>{
    if(!e.rule_id)return (e.end_at||e.start_at).slice(0,10)<before;
    if(!e.until_date||Number(e.exception_count))return false;
    const duration=Math.max(0,dateDay((e.end_at||e.start_at).slice(0,10))-dateDay(e.start_at.slice(0,10)));
    return addDays(e.until_date,duration)<before;
  });
}
async function activePasswordHash(env) {
  const row=await env.DB.prepare("SELECT password_hash FROM admin_credentials WHERE id=1").first();
  return row?.password_hash || env.ADMIN_PASSWORD_HASH;
}
function validNewPassword(password, username) {
  return typeof password==="string" && password.length>=6 && password.length<=128 &&
    password.trim().length>=6 && !/^(.)\1+$/u.test(password) &&
    !["123456","654321","12345678","password","password1","qwertyui","admin123","87654321",String(username).toLowerCase()].includes(password.toLowerCase());
}
async function passwordHash(password) {
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);
  const hash=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations:100000},key,256);
  return "100000:"+toHex(salt)+":"+toHex(new Uint8Array(hash));
}
async function reserveCredentialAttempt(request,env,scope) {
  const now=Math.floor(Date.now()/1000),ip=request.headers.get("CF-Connecting-IP")||"unknown";
  const prefix=scope+":"+await sha256(ip)+":";
  const result=await env.DB.prepare("INSERT INTO login_attempts(id,attempted_at) SELECT ?,? WHERE (SELECT COUNT(*) FROM login_attempts WHERE substr(id, 1, length(?3)) = ?3 AND attempted_at >= ?) < ?")
    .bind(prefix+crypto.randomUUID(),now,prefix,now-LOGIN_WINDOW_SECONDS,LOGIN_LIMIT).run();
  return !!result.meta.changes;
}
async function saveCalendarEvent(env, body, eventId) {
  const fail = (error, status = 400) => ({status, data: {error}});
  const checked = validateEvent(body.event);
  if (checked.error) return fail(checked.error);
  const event = checked.event;
  const recurring = body.rule != null;
  const checkedRule = recurring ? validateRecurrence(body.rule, event) : null;
  if (checkedRule?.error) return fail(checkedRule.error);
  if (event.category_id && !await env.DB.prepare("SELECT id FROM categories WHERE id=?").bind(event.category_id).first()) {
    return fail("Category not found");
  }
  let previous = null, oldRule = null;
  if (eventId) {
    previous = await env.DB.prepare("SELECT * FROM events WHERE id=?").bind(eventId).first();
    if (!previous) return fail("Event not found", 404);
    oldRule = await env.DB.prepare("SELECT * FROM recurrence_rules WHERE event_id=?").bind(eventId).first();
    if (oldRule) {
      const keys = ["frequency","interval_value","by_weekday","day_of_month","until_date","occurrence_count"];
      const scheduleChanged = !recurring || event.start_at !== previous.start_at ||
        event.all_day !== previous.all_day || keys.some(k => (oldRule[k] ?? null) !== (checkedRule.rule[k] ?? null));
      const exceptions = await env.DB.prepare("SELECT COUNT(*) AS total FROM event_exceptions WHERE recurrence_rule_id=?").bind(oldRule.id).first();
      if (scheduleChanged && Number(exceptions.total)) {
        return fail("Remove or restore occurrence exceptions before changing recurrence schedule", 409);
      }
    }
  }
  const id = eventId || crypto.randomUUID(), statements = [];
  const values = [event.title,event.description,event.location,event.start_at,event.end_at,
    event.all_day,event.category_id,event.notes];
  if (eventId) {
    statements.push(env.DB.prepare("UPDATE events SET title=?,description=?,location=?,start_at=?,end_at=?,all_day=?,category_id=?,notes=?,updated_at=? WHERE id=?")
      .bind(...values, new Date().toISOString(), id));
  } else {
    statements.push(env.DB.prepare("INSERT INTO events(id,title,description,location,start_at,end_at,all_day,category_id,notes) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,...values));
  }
  let recurrenceId = oldRule?.id || null;
  if (recurring) {
    const r = checkedRule.rule;
    recurrenceId ||= crypto.randomUUID();
    if (oldRule) {
      statements.push(env.DB.prepare("UPDATE recurrence_rules SET frequency=?,interval_value=?,by_weekday=?,day_of_month=?,until_date=?,occurrence_count=?,updated_at=? WHERE id=?")
        .bind(r.frequency,r.interval_value,r.by_weekday,r.day_of_month,r.until_date,r.occurrence_count,new Date().toISOString(),recurrenceId));
    } else {
      statements.push(env.DB.prepare("INSERT INTO recurrence_rules(id,event_id,frequency,interval_value,by_weekday,day_of_month,until_date,occurrence_count) VALUES(?,?,?,?,?,?,?,?)")
        .bind(recurrenceId,id,r.frequency,r.interval_value,r.by_weekday,r.day_of_month,r.until_date,r.occurrence_count));
    }
  } else if (oldRule) {
    statements.push(env.DB.prepare("DELETE FROM recurrence_rules WHERE id=?").bind(oldRule.id));
    recurrenceId = null;
  }
  statements.push(auditStatement(env,eventId ? "update" : "create","calendar_event",id,
    {before: previous ? {event:previous,rule:oldRule} : null,after:{event,rule:checkedRule?.rule || null}}));
  await env.DB.batch(statements);
  return {status:eventId ? 200 : 201,data:{success:true,event:{id,...event},recurrence_rule_id:recurrenceId}};
}

async function readBody(request) {
  const reader=request.body?.getReader(),chunks=[];let length=0;
  if(reader)while(true){
    const {done,value}=await reader.read();if(done)break;
    length+=value.byteLength;
    if(length>16384){await reader.cancel();throw new Error("BODY_TOO_LARGE");}
    chunks.push(value);
  }
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const raw=new TextDecoder().decode(bytes);
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("INVALID_JSON");
    }
    return body;
  } catch (error) {
    if (error.message === "BODY_TOO_LARGE") throw error;
    throw new Error("INVALID_JSON");
  }
}

function validateCategory(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { error: "Invalid category" };
  }
  if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 80) {
    return { error: "Category name must be 1–80 characters" };
  }
  const name = data.name.trim();
  const color = data.color ?? "#808080";
  if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return { error: "Color must be a hex code, e.g. #3366CC" };
  }
  const sortOrder = data.sort_order ?? 0;
  if (!Number.isInteger(sortOrder) || sortOrder < -10000 || sortOrder > 10000) {
    return { error: "sort_order must be an integer from -10000 to 10000" };
  }
  return { category: { name, color: color.toUpperCase(), sort_order: sortOrder } };
}

// All-day dates: YYYY-MM-DD (end date is inclusive).
// Timed dates: YYYY-MM-DDTHH:mm:ss+08:00 (Hong Kong local time).
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function validTimedDate(value) {
  if (typeof value !== "string") return false;
  const parts = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})\+08:00$/);
  if (!parts || !validDate(parts[1])) return false;
  return Number(parts[2]) <= 23 && Number(parts[3]) <= 59 && Number(parts[4]) <= 59;
}

function optionalEventText(value, limit, field) {
  if (value === undefined || value === null || value === "") return { value: null };
  if (typeof value !== "string" || value.length > limit) {
    return { error: field + " must be text of at most " + limit + " characters" };
  }
  return { value: value.trim() || null };
}

function validateEvent(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { error: "Invalid event" };
  }
  if (typeof data.title !== "string" || !data.title.trim() || data.title.length > 160) {
    return { error: "Title must be 1–160 characters" };
  }
  if (![true, false, 0, 1].includes(data.all_day)) {
    return { error: "all_day must be true or false" };
  }
  const all_day = data.all_day === true || data.all_day === 1 ? 1 : 0;
  const start_at = data.start_at;
  const end_at = data.end_at === "" || data.end_at === undefined ? null : data.end_at;
  const dateValidator = all_day ? validDate : validTimedDate;
  if (!dateValidator(start_at)) {
    return { error: all_day ? "Start date must be YYYY-MM-DD" : "Start time must include +08:00" };
  }
  if (end_at !== null && !dateValidator(end_at)) {
    return { error: "Invalid end date/time" };
  }
  if (end_at && end_at < start_at) return { error: "End must not precede start" };
  if (data.category_id !== undefined && data.category_id !== null &&
      (typeof data.category_id !== "string" ||
       !/^[0-9a-f-]{36}$/i.test(data.category_id))) {
    return { error: "Invalid category ID" };
  }
  const description = optionalEventText(data.description, 2000, "Description");
  const location = optionalEventText(data.location, 300, "Location");
  const notes = optionalEventText(data.notes, 1000, "Notes");
  for (const item of [description, location, notes]) {
    if (item.error) return { error: item.error };
  }
  return { event: {
    title: data.title.trim(), description: description.value,
    location: location.value, start_at, end_at, all_day,
    category_id: data.category_id || null, notes: notes.value
  } };
}

function auditStatement(env, action, entityType, entityId, details) {
  return env.DB.prepare(`
    INSERT INTO audit_logs (id, action, entity_type, entity_id, details_json)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), action, entityType, entityId, JSON.stringify(details)
  );
}

async function verifyPassword(password, storedHash) {
  const parts = storedHash.split(":");
  if (parts.length !== 3) throw new Error("Invalid password hash format");
  const iterations = Number(parts[0]);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 100000) {
    throw new Error("Invalid iteration count");
  }
  const salt = fromHex(parts[1]);
  const expected = fromHex(parts[2]);
  if (salt.length !== 16 || expected.length !== 32) {
    throw new Error("Invalid password hash");
  }
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const derived = new Uint8Array(await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", salt, iterations
  }, key, expected.length * 8));
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ derived[i];
  return difference === 0;
}

async function getSession(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer ([a-f0-9]{64})$/i);
  if (!match) return null;
  return await env.DB.prepare(`
    SELECT id, expires_at FROM admin_sessions
    WHERE token_hash = ? AND expires_at > ? LIMIT 1
  `).bind(await sha256(match[1]), new Date().toISOString()).first();
}

function toHex(bytes) {
  return Array.from(bytes).map(x => x.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(hex)) {
    throw new Error("Invalid hex");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(new Uint8Array(digest));
}


// ---------------------------------------------------------
// Recurrence v5. Dates are Hong Kong local, with +08:00 for timed events.
// from/to are inclusive calendar days. The calendar requests ≤366 days.
// ---------------------------------------------------------
const DAY_MS = 86400000;
const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}
function dateDay(value) {
  return Date.parse(value + "T00:00:00Z") / DAY_MS;
}
function dayDate(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}
function weekday(day) {
  return (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
}
function addDays(value, number) {
  return dayDate(dateDay(value) + number);
}
function validDayRange(from, to) {
  return validDate(from) && validDate(to) && dateDay(to) >= dateDay(from)
    && dateDay(to) - dateDay(from) <= 365;
}
function readRange(url) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!validDayRange(from, to)) {
    return { error: "Provide valid from/to dates, maximum 366 inclusive days" };
  }
  return { from, to };
}
function parseWeekdays(value) {
  if (!value) return null;
  if (typeof value !== "string") return null;
  const items = value.toUpperCase().split(",").map(x => x.trim());
  if (!items.length || items.some(x => !WEEKDAY_CODES.includes(x))) return null;
  return [...new Set(items)].sort((a, b) => WEEKDAY_CODES.indexOf(a) - WEEKDAY_CODES.indexOf(b));
}
function parseOrdinalWeekday(value) {
  if (typeof value !== "string") return null;
  const m = value.toUpperCase().match(/^([1-5]|-1)(MO|TU|WE|TH|FR|SA|SU)$/);
  return m ? { nth: Number(m[1]), day: WEEKDAY_CODES.indexOf(m[2]) } : null;
}
function validateRecurrence(data, event) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { error: "Missing recurrence rule" };
  }
  if (!["daily", "weekly", "monthly", "yearly"].includes(data.frequency)) {
    return { error: "Frequency must be daily, weekly, monthly or yearly" };
  }
  const interval = data.interval_value ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 100) {
    return { error: "interval_value must be an integer from 1 to 100" };
  }
  let by_weekday = null;
  let day_of_month = null;
  if (data.frequency === "weekly") {
    const weekdays = data.by_weekday ? parseWeekdays(data.by_weekday) : null;
    if (data.by_weekday && !weekdays) return { error: "Weekly by_weekday must be MO,TU,WE..." };
    by_weekday = weekdays ? weekdays.join(",") : null;
  }
  if (data.frequency === "monthly") {
    if (data.by_weekday) {
      const ordinal = parseOrdinalWeekday(data.by_weekday);
      if (!ordinal) return { error: "Monthly by_weekday must be e.g. 1SU, 2MO or -1FR" };
      if (data.day_of_month !== null && data.day_of_month !== undefined) {
        return { error: "Use either day_of_month or monthly ordinal weekday" };
      }
      by_weekday = data.by_weekday.toUpperCase();
    } else if (data.day_of_month !== null && data.day_of_month !== undefined) {
      if (!Number.isInteger(data.day_of_month) || data.day_of_month < 1 || data.day_of_month > 31) {
        return { error: "day_of_month must be from 1 to 31" };
      }
      day_of_month = data.day_of_month;
    }
  }
  const until_date = data.until_date === "" || data.until_date == null ? null : data.until_date;
  if (until_date !== null && (!validDate(until_date) || until_date < event.start_at.slice(0, 10))) {
    return { error: "until_date must not precede event start" };
  }
  const occurrence_count = data.occurrence_count === "" || data.occurrence_count == null
    ? null : data.occurrence_count;
  if (occurrence_count !== null && (!Number.isInteger(occurrence_count) ||
      occurrence_count < 1 || occurrence_count > 10000)) {
    return { error: "occurrence_count must be an integer from 1 to 10000" };
  }
  const rule = {
    frequency: data.frequency, interval_value: interval,
    by_weekday, day_of_month, until_date, occurrence_count
  };
  const anchor = event.start_at.slice(0, 10);
  if (occurrenceOrdinal(rule, anchor, anchor) !== 1) {
    return { error: "The first event date must match the selected recurrence rule" };
  }
  return { rule };
}
function monthlyDate(year, month, rule, anchor) {
  if (rule.by_weekday) {
    const parsed = parseOrdinalWeekday(rule.by_weekday);
    if (!parsed) return null;
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (parsed.nth === -1) {
      for (let d = count; d >= 1; d--) {
        if (weekday(dateDay(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`)) === parsed.day) {
          return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        }
      }
    } else {
      let hits = 0;
      for (let d = 1; d <= count; d++) {
        if (weekday(dateDay(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`)) === parsed.day && ++hits === parsed.nth) {
          return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        }
      }
    }
    return null;
  }
  const target = rule.day_of_month || Number(anchor.slice(8, 10));
  const date = `${year}-${String(month).padStart(2, "0")}-${String(target).padStart(2, "0")}`;
  return validDate(date) ? date : null;
}
// Returns occurrence ordinal (1-based), or null when date does not match.
function occurrenceOrdinal(rule, eventStartDate, candidate) {
  if (!validDate(candidate) || candidate < eventStartDate) return null;
  if (rule.until_date && candidate > rule.until_date) return null;
  const interval = Number(rule.interval_value);
  if (!Number.isInteger(interval) || interval < 1) return null;
  const a = dateDay(eventStartDate);
  const b = dateDay(candidate);
  let ord = null;
  if (rule.frequency === "daily") {
    if ((b - a) % interval !== 0) return null;
    ord = (b - a) / interval + 1;
  } else if (rule.frequency === "weekly") {
    const days = rule.by_weekday ? parseWeekdays(rule.by_weekday).map(x => WEEKDAY_CODES.indexOf(x)) : [weekday(a)];
    const cd = weekday(b);
    if (!days.includes(cd)) return null;
    const week0 = a - weekday(a);
    const weeks = (b - weekday(b) - week0) / 7;
    if (weeks < 0 || weeks % interval !== 0) return null;
    const first = days.filter(d => d >= weekday(a));
    if (weeks === 0) ord = first.filter(d => d <= cd).length;
    else ord = first.length + (weeks / interval - 1) * days.length + days.filter(d => d <= cd).length;
    if (ord <= 0) return null;
  } else if (rule.frequency === "monthly") {
    const ay = Number(eventStartDate.slice(0, 4));
    const am = Number(eventStartDate.slice(5, 7));
    const cy = Number(candidate.slice(0, 4));
    const cm = Number(candidate.slice(5, 7));
    const months = (cy - ay) * 12 + cm - am;
    if (months < 0 || months % interval !== 0) return null;
    if (monthlyDate(cy, cm, rule, eventStartDate) !== candidate) return null;
    ord = 0;
    for (let m = 0; m <= months; m += interval) {
      const y = ay + Math.floor((am - 1 + m) / 12);
      const month = ((am - 1 + m) % 12) + 1;
      const date = monthlyDate(y, month, rule, eventStartDate);
      if (date && date >= eventStartDate) ord++;
    }
  } else if (rule.frequency === "yearly") {
    const startYear = Number(eventStartDate.slice(0, 4));
    const currentYear = Number(candidate.slice(0, 4));
    const years = currentYear - startYear;
    if (years < 0 || years % interval !== 0) return null;
    if (candidate.slice(5) !== eventStartDate.slice(5)) return null;
    ord = 0;
    for (let y = startYear; y <= currentYear; y += interval) {
      const date = `${y}-${eventStartDate.slice(5)}`;
      if (validDate(date) && date >= eventStartDate) ord++;
    }
  }
  if (ord === null) return null;
  if (rule.occurrence_count && ord > Number(rule.occurrence_count)) return null;
  return ord;
}
function eventForDate(record, date) {
  const start = String(record.start_at);
  const end = record.end_at;
  const allDay = !!record.all_day;
  const newStart = allDay ? date : date + start.slice(10);
  let newEnd = null;
  if (end) {
    if (allDay) {
      newEnd = addDays(date, dateDay(end.slice(0, 10)) - dateDay(start.slice(0, 10)));
    } else {
      const duration = Date.parse(end) - Date.parse(start);
      const shifted = new Date(Date.parse(newStart) + duration + 8 * 3600000);
      newEnd = shifted.toISOString().slice(0, 19) + "+08:00";
    }
  }
  return { ...record, start_at: newStart, end_at: newEnd };
}
function validOriginalOccurrence(record, original) {
  if (typeof original !== "string") return false;
  const allDay = !!record.all_day;
  if (!(allDay ? validDate(original) : validTimedDate(original))) return false;
  const date = original.slice(0, 10);
  return occurrenceOrdinal(record, record.start_at.slice(0, 10), date) !== null &&
    eventForDate(record, date).start_at === original;
}
function occurrence(record, original, overrides = null, action = "normal") {
  const base = eventForDate(record, original.slice(0, 10));
  const obj = { ...base,
    id: `${record.id}:${original}`,
    event_id: record.event_id,
    recurrence_rule_id: record.id,
    original_start_at: original,
    is_recurring: true,
    exception_action: action === "normal" ? null : action
  };
  if (overrides) Object.assign(obj, overrides);
  return obj;
}
function eventIntersects(event, from, to) {
  const start = event.start_at.slice(0, 10);
  const end = (event.end_at || event.start_at).slice(0, 10);
  return start <= to && end >= from;
}
function validateOccurrenceOverride(partial, record, original) {
  if (!partial || typeof partial !== "object" || Array.isArray(partial)) {
    return { error: "Override must be an object" };
  }
  const fields = ["title", "description", "location", "start_at", "end_at", "all_day", "category_id", "notes"];
  const keys = Object.keys(partial);
  if (!keys.length || keys.some(key => !fields.includes(key))) {
    return { error: "Override must contain supported event fields" };
  }
  const base = eventForDate(record, original.slice(0, 10));
  const merged = { ...base, ...partial };
  const validated = validateEvent(merged);
  if (validated.error) return { error: validated.error };
  const normalized = {};
  for (const key of keys) normalized[key] = validated.event[key];
  return { override: normalized };
}
async function loadExceptions(env, ids) {
  if (!ids.length) return new Map();
  const params = ids.map(() => "?").join(",");
  const res = await env.DB.prepare(`
    SELECT recurrence_rule_id, original_start_at, action, override_json
    FROM event_exceptions WHERE recurrence_rule_id IN (${params})
    LIMIT 5001
  `).bind(...ids).all();
  if (res.results.length > 5000) throw new Error("TOO_MANY_OCCURRENCES");
  const out = new Map();
  for (const e of res.results) {
    const key = `${e.recurrence_rule_id}|${e.original_start_at}`;
    let override = null;
    if (e.override_json) {
      try { override = JSON.parse(e.override_json); }
      catch { console.error("Invalid exception JSON for rule", e.recurrence_rule_id); }
    }
    out.set(key, { action: e.action, override });
  }
  return out;
}
function expandSeries(record, from, to, exceptions, includeCancelled = false) {
  const results = [];
  const seen = new Set();
  const startDate = record.start_at.slice(0, 10);
  // Include occurrences starting before 'from' but ending within the range.
  const durationDays = record.end_at
    ? Math.max(0, dateDay(record.end_at.slice(0, 10)) - dateDay(startDate)) : 0;
  const firstDay = Math.max(dateDay(startDate), dateDay(from) - Math.min(durationDays, 366));
  for (let d = firstDay; d <= dateDay(to); d++) {
    const date = dayDate(d);
    if (occurrenceOrdinal(record, startDate, date) === null) continue;
    const original = eventForDate(record, date).start_at;
    seen.add(original);
    const exc = exceptions.get(`${record.id}|${original}`);
    if (exc?.action === "cancelled") {
      if (includeCancelled) results.push(occurrence(record, original, null, "cancelled"));
      continue;
    }
    const item = occurrence(record, original, exc?.override, exc?.action || "normal");
    if (eventIntersects(item, from, to)) results.push(item);
  }
  // Include moved single occurrences whose original date is outside the window.
  for (const [key, exc] of exceptions) {
    const prefix = `${record.id}|`;
    if (!key.startsWith(prefix) || exc.action !== "modified") continue;
    const original = key.slice(prefix.length);
    if (seen.has(original) || !validOriginalOccurrence(record, original)) continue;
    const item = occurrence(record, original, exc.override, "modified");
    if (eventIntersects(item, from, to)) results.push(item);
  }
  return results;
}
async function calendarOccurrences(env, from, to) {
  const plain = await env.DB.prepare(`
    SELECT e.id, e.title, e.description, e.location, e.start_at, e.end_at,
           e.all_day, e.category_id, e.notes,
           c.name AS category_name, c.color AS category_color
    FROM events e
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE NOT EXISTS (SELECT 1 FROM recurrence_rules r WHERE r.event_id = e.id)
      AND substr(e.start_at, 1, 10) <= ?
      AND substr(COALESCE(e.end_at, e.start_at), 1, 10) >= ?
    ORDER BY e.start_at ASC LIMIT 1001
  `).bind(to, from).all();
  const ruleRows = await env.DB.prepare(`
    SELECT r.*, e.title, e.description, e.location, e.start_at, e.end_at,
           e.all_day, e.category_id, e.notes,
           c.name AS category_name, c.color AS category_color
    FROM recurrence_rules r
    JOIN events e ON e.id = r.event_id
    LEFT JOIN categories c ON c.id = e.category_id
    ORDER BY e.start_at ASC LIMIT 501
  `).all();
  const ids = ruleRows.results.map(r => r.id);
  if (plain.results.length > 1000 || ruleRows.results.length > 500) throw new Error("TOO_MANY_OCCURRENCES");
  const exceptions = new Map();
  for (let offset = 0; offset < ids.length; offset += 100) {
    for (const [key, value] of await loadExceptions(env, ids.slice(offset, offset + 100))) exceptions.set(key, value);
  }
  const result = [...plain.results.map(e => ({ ...e, is_recurring: false }))];
  for (const r of ruleRows.results) {
    result.push(...expandSeries(r, from, to, exceptions));
    if (result.length > 2000) throw new Error("TOO_MANY_OCCURRENCES");
  }
  result.sort((a, b) => a.start_at.localeCompare(b.start_at) ||
    a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return result;
}

// A modified single occurrence can have a different category from its series.
async function hydrateOccurrenceCategories(items, env) {
  if (!items.some(e => e.exception_action === "modified")) return;
  const res = await env.DB.prepare("SELECT id, name, color FROM categories").all();
  const lookup = new Map(res.results.map(c => [c.id, c]));
  for (const item of items) {
    if (item.exception_action !== "modified") continue;
    const cat = lookup.get(item.category_id);
    item.category_name = cat ? cat.name : null;
    item.category_color = cat ? cat.color : null;
  }
}

const backupYear=()=>Number(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric'}).format(new Date()));
const calendarBackupKeys=url=>{
  const from=url.searchParams.get('from')||String(backupYear()),to=url.searchParams.get('to')||from;
  const first=Number(from.slice(0,4)),last=Number(to.slice(0,4));
  if(!Number.isInteger(first)||first<1000||last<first||last-first>2)throw Error('Invalid backup range');
  return Array.from({length:last-first+1},(_,i)=>String(first+i));
};
export default withPublicBackup(calendarWorker,{
  prefix:'calendar:', publicPath:(path,url)=>path==='/api/categories'||path==='/api/calendar'&&url.searchParams.has('from')&&url.searchParams.has('to'),
  keys:calendarBackupKeys,warmKeys:()=>[-1,0,1].map(n=>String(backupYear()+n)),
  async snapshot(env,year){
    const from=year+'-01-01',to=year+'-12-31';
    const items=await calendarOccurrences(env,from,to);await hydrateOccurrenceCategories(items,env);
    const categories=(await env.DB.prepare('SELECT id,name,color,sort_order FROM categories ORDER BY sort_order,name').all()).results;
    return {categories,events:items.map(({notes,...item})=>item),from,to};
  },
  restore(backups,url){
    if(url.pathname==='/api/categories')return {categories:backups[0].categories};
    const from=url.searchParams.get('from')||backups[0].from,to=url.searchParams.get('to')||backups.at(-1).to;
    const unique=new Map(backups.flatMap(data=>data.events).filter(e=>e.start_at.slice(0,10)<=to&&(e.end_at||e.start_at).slice(0,10)>=from).map(e=>[e.id,e]));
    return {events:[...unique.values()].map(({notes,...event})=>event),from,to};
  }
});
