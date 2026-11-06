import {notifyProjectMatches} from './project-interests.js';
import { mvp } from "./mvp.js";
import { features, NO_ROUTE } from "./features.js";
import http from "node:http";
import { pool, transaction } from "./db.js";
import { verifyPassword, newToken, tokenHash } from "./security.js";
const port = Number(process.env.PORT || 3000);
const fail = (status, message) => Object.assign(new Error(message), { status });
// Ошибки PostgreSQL -> HTTP-статус. IH*** — свои коды из процедур и триггеров (db/016):
// их текст написан для пользователя и показывается как есть.
// 23505 уникальность, 23503 внешний ключ, 23514 CHECK, 23502 NOT NULL.
const DB_ERRORS = {
  IH403: 403,
  IH404: 404,
  IH409: 409,
  IH422: 422,
  23505: 409,
  23503: 400,
  23514: 400,
  23502: 400,
};
async function body(req) {
  let s = "";
  for await (const chunk of req) {
    s += chunk;
    if (s.length > 65536) throw fail(413, "Слишком большой запрос");
  }
  try {
    return JSON.parse(s || "{}");
  } catch {
    throw fail(400, "Некорректный JSON");
  }
}
const number = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1)
    throw fail(400, "Некорректный идентификатор");
  return n;
};
const required = (v) => {
  if (typeof v !== "string" || !v.trim() || v.length > 4000)
    throw fail(400, "Проверьте заполнение полей");
  return v.trim();
};
async function user(req) {
  const token = (req.headers.cookie || "")
    .split("; ")
    .find((x) => x.startsWith("sid="))
    ?.slice(4);
  if (!token) return null;
  const r = await pool.query(
    "SELECT u.id,u.name,u.email,u.role FROM login_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [tokenHash(token)],
  );
  return r.rows[0];
}
async function main(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "POST" && p === "/api/login") {
    const b = await body(req);
    const r = await pool.query("SELECT * FROM users WHERE email=$1", [
      String(b.email || "").toLowerCase(),
    ]);
    if (
      !r.rowCount ||
      !(await verifyPassword(String(b.password || ""), r.rows[0].password_hash))
    )
      throw fail(401, "Неверная почта или пароль");
    const t = newToken();
    await pool.query(
      "INSERT INTO login_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '12 hours')",
      [tokenHash(t), r.rows[0].id],
    );
    // заодно удаляем просроченные входы (функция БД из db/016)
    await pool.query("SELECT cleanup_expired_sessions()");
    res.setHeader(
      "Set-Cookie",
      `sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
    return { name: r.rows[0].name, role: r.rows[0].role };
  }
  const u = await user(req);
  if (!u) throw fail(401, "Необходим вход");
  if (req.method === "POST" && p === "/api/logout") {
    const token = (req.headers.cookie || "")
      .split("; ")
      .find((x) => x.startsWith("sid="))
      ?.slice(4);
    if (token)
      await pool.query("DELETE FROM login_sessions WHERE token_hash=$1", [
        tokenHash(token),
      ]);
    res.setHeader(
      "Set-Cookie",
      "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    );
    return { ok: true };
  }
  if (req.method === "GET" && p === "/api/me") return u;
  const extension = await mvp(req, res, u);
  if (extension !== undefined) return extension;
  const feature = await features(req, res, u);
  if (feature !== NO_ROUTE) return feature;
  const access = `(o.teacher_id=$1 OR $2='coordinator' OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=$1 AND offering_has_group(o.id,m.group_id) AND m.starts_on<=CURRENT_DATE AND (m.ends_on IS NULL OR m.ends_on>=CURRENT_DATE)))`;
  if (req.method === "GET" && p === "/api/sessions")
    return (
      await pool.query(
        `SELECT s.*,c.title course,g.name group_name,offering_group_names(o.id) group_names,o.semester FROM sessions s JOIN offerings o ON o.id=s.offering_id JOIN courses c ON c.id=o.course_id JOIN groups g ON g.id=o.group_id WHERE ${access} ORDER BY s.starts_at`,
        [u.id, u.role],
      )
    ).rows;
  if (req.method === "GET" && p === "/api/homework")
    return (
      await pool.query(
        `SELECT h.*,s.title session_title,c.title course, EXISTS(SELECT 1 FROM homework_done d WHERE d.homework_id=h.id AND d.user_id=$1) done FROM homework h JOIN sessions s ON s.id=h.session_id JOIN offerings o ON o.id=s.offering_id JOIN courses c ON c.id=o.course_id WHERE ${access} ORDER BY h.due_at`,
        [u.id, u.role],
      )
    ).rows;
  if (req.method === "POST" && /^\/api\/homework\/\d+\/done$/.test(p)) {
    const id = number(p.split("/")[3]);
    const found = await pool.query(
      `SELECT h.id FROM homework h JOIN sessions s ON s.id=h.session_id JOIN offerings o ON o.id=s.offering_id WHERE h.id=$3 AND ${access}`,
      [u.id, u.role, id],
    );
    if (!found.rowCount) throw fail(404, "Задание не найдено");
    await pool.query(
      "INSERT INTO homework_done VALUES($1,$2) ON CONFLICT DO NOTHING",
      [id, u.id],
    );
    return { ok: true };
  }
  if (req.method === "GET" && p === "/api/materials")
    return (
      await pool.query(
        `SELECT m.*,c.title course FROM materials m JOIN offerings o ON o.id=m.offering_id JOIN courses c ON c.id=o.course_id WHERE ${access} AND m.published ORDER BY m.title`,
        [u.id, u.role],
      )
    ).rows;
  if (req.method === "GET" && p === "/api/contacts")
    return (await pool.query("SELECT * FROM contacts ORDER BY name")).rows;
  if (req.method === "GET" && p === "/api/debts")
    return (
      await pool.query(
        `SELECT d.id,d.reason,d.source,d.closed,c.title course FROM debts d JOIN offerings o ON o.id=d.offering_id JOIN courses c ON c.id=o.course_id WHERE d.student_id=$1 OR o.teacher_id=$1 OR $2='coordinator' ORDER BY d.created_at DESC`,
        [u.id, u.role],
      )
    ).rows;
  if (req.method === "GET" && p === "/api/attendance")
    return (
      await pool.query(
        `SELECT a.status,a.updated_at,s.title,s.starts_at,c.title course FROM attendance a JOIN sessions s ON s.id=a.session_id JOIN offerings o ON o.id=s.offering_id JOIN courses c ON c.id=o.course_id WHERE a.student_id=$1 ORDER BY s.starts_at DESC`,
        [u.id],
      )
    ).rows;
  if (req.method === "GET" && p === "/api/projects")
    return (
      await pool.query(
        `SELECT p.*,u.name owner,COALESCE(json_agg(json_build_object('id',r.id,'title',r.title,'skills',r.skills,'capacity',r.capacity)) FILTER (WHERE r.id IS NOT NULL),'[]') roles FROM projects p JOIN users u ON u.id=p.owner_id LEFT JOIN project_roles r ON r.project_id=p.id GROUP BY p.id,u.name ORDER BY p.created_at DESC`,
      )
    ).rows;
  if (req.method === "POST" && /^\/api\/roles\/\d+\/apply$/.test(p)) {
    if (!["student", "headman"].includes(u.role))
      throw fail(403, "Доступно студентам");
    const b = await body(req);
    const role = number(p.split("/")[3]);
    await pool.query(
      "INSERT INTO applications(role_id,user_id,message) VALUES($1,$2,$3)",
      [
        role,
        u.id,
        typeof b.message === "string" ? b.message.slice(0, 2000) : "",
      ],
    );
    return { ok: true };
  }
  if (req.method === "POST" && p === "/api/projects") {
    const b=await body(req);
    return transaction(async c=>{
      const project=(await c.query('INSERT INTO projects(owner_id,title,description) VALUES($1,$2,$3) RETURNING *',[u.id,required(b.title),required(b.description)])).rows[0];
      await notifyProjectMatches(c,project.id);return project;
    });
  }
  if (req.method === "POST" && /^\/api\/projects\/\d+\/roles$/.test(p)) {
    const projectId=number(p.split('/')[3]),b=await body(req);
    return transaction(async c=>{
      const role=(await c.query('INSERT INTO project_roles(project_id,title,skills,capacity) SELECT id,$1,$2,$3 FROM projects WHERE id=$4 AND owner_id=$5 RETURNING *',[required(b.title),String(b.skills||'').slice(0,500),number(b.capacity),projectId,u.id])).rows[0];
      if(!role)throw fail(404,'Проект не найден');
      await notifyProjectMatches(c,projectId);return role;
    });
  }
  if (req.method === "GET" && p === "/api/applications")
    return (
      await pool.query(
        `SELECT a.*,u.name applicant,r.title role,p.title project FROM applications a JOIN users u ON u.id=a.user_id JOIN project_roles r ON r.id=a.role_id JOIN projects p ON p.id=r.project_id WHERE p.owner_id=$1 OR a.user_id=$1 ORDER BY a.id DESC`,
        [u.id],
      )
    ).rows;
  if (req.method === "POST" && /^\/api\/applications\/\d+\/accept$/.test(p)) {
    const id = number(p.split("/")[3]);
    // владелец, статус отклика, блокировка и лимит мест — в функции accept_application
    // и триггере project_members_capacity (db/016)
    await pool.query("SELECT accept_application($1,$2)", [id, u.id]);
    return { ok: true };
  }
  throw fail(404, "Маршрут не найден");
}
http
  .createServer(async (req, res) => {
    try {
      if (!req.url.startsWith("/api/")) throw fail(404, "Маршрут не найден");
      if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
        const origin = req.headers.origin;
        if (
          origin &&
          ![
            process.env.APP_ORIGIN || "http://localhost:5173",
            `http://localhost:${port}`,
          ].includes(origin)
        )
          throw fail(403, "Источник запроса запрещён");
      }
      const data = await main(req, res);
      if (!res.writableEnded) res.end(JSON.stringify(data));
    } catch (e) {
      console.error(e.message);
      const status = e.status || DB_ERRORS[e.code] || 500;
      res.statusCode = status;
      res.end(
        JSON.stringify({
          error:
            status === 500
              ? "Внутренняя ошибка сервера"
              : e.status || String(e.code).startsWith("IH")
                ? e.message
                : "Данные нарушают ограничения",
        }),
      );
    }
  })
  .listen(port, () => console.log(`API listening on ${port}`));
