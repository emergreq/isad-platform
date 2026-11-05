import ExcelJS from "exceljs";
import {instant,notify} from './mvp-utils.js';
import {moveSession} from './reschedule.js';
import { pool, transaction } from "./db.js";
import { hashPassword } from "./security.js";
import { fetchSchedule, SOURCE_URL } from "./schedule.js";
export const NO_ROUTE = Symbol("no-route");
const error = (status, message) =>
  Object.assign(new Error(message), { status });
const id = (x) => {
  const v = Number(x);
  if (!Number.isSafeInteger(v) || v < 1)
    throw error(400, "Некорректный идентификатор");
  return v;
};
const text = (x, max = 4000) => {
  if (typeof x !== "string" || !x.trim() || x.length > max)
    throw error(400, "Заполните обязательные поля");
  return x.trim();
};
const date = (x) => {
  if (
    typeof x !== "string" ||
    !/^\d{4}-\d{2}-\d{2}/.test(x) ||
    !Number.isFinite(Date.parse(x)) ||
    new Date(x.slice(0, 10) + "T00:00:00Z").toISOString().slice(0, 10) !==
      x.slice(0, 10)
  )
    throw error(400, "Некорректная дата");
  return x;
};
const day = (x) => {
  date(x);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x))
    throw error(400, "Нужна дата без времени");
  return x;
};
const url = (x) => {
  try {
    const u = new URL(x);
    if (!["https:", "http:"].includes(u.protocol)) throw 0;
    return u.href;
  } catch {
    throw error(400, "Нужна ссылка http или https");
  }
};
const admin = (u) => {
  if (u.role !== "coordinator")
    throw error(403, "Действие доступно координатору");
};
const staff = (u) => {
  if (!["teacher", "coordinator"].includes(u.role))
    throw error(403, "Действие доступно преподавателю");
};
const rows = async (sql, args = [], c = pool) =>
  (await c.query(sql, args)).rows;
async function offering(u, value, c = pool) {
  staff(u);
  const o = (
    await rows(
      "SELECT * FROM offerings WHERE id=$1 AND (teacher_id=$2 OR $3='coordinator')",
      [id(value), u.id, u.role],
      c,
    )
  )[0];
  if (!o) throw error(404, "Преподавание не найдено");
  return o;
}
async function session(u, value, mode = "read", c = pool) {
  const s = (
    await rows(
      "SELECT s.*,o.group_id,o.teacher_id FROM sessions s JOIN offerings o ON o.id=s.offering_id WHERE s.id=$1",
      [id(value)],
      c,
    )
  )[0];
  if (!s) throw error(404, "Занятие не найдено");
  if (
    u.role === "coordinator" ||
    (u.role === "teacher" && s.teacher_id === u.id)
  )
    return s;
  if (mode === "write" && u.role !== "headman")
    throw error(403, "Нет прав на журнал");
  const table = mode === "write" ? "headman_assignments" : "memberships";
  const a = await rows(
    `SELECT 1 FROM ${table} WHERE user_id=$1 AND offering_has_group($2,group_id) AND starts_on<=($3::timestamptz AT TIME ZONE 'Europe/Moscow')::date AND (ends_on IS NULL OR ends_on>=($3::timestamptz AT TIME ZONE 'Europe/Moscow')::date)`,
    [u.id, s.offering_id, s.starts_at],
    c,
  );
  if (!a.length) throw error(403, "Нет доступа к занятию");
  return s;
}
async function roster(s, c = pool, actor = null) {
  return rows(
    "SELECT DISTINCT u.id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE offering_has_group($1,m.group_id) AND ($3::integer IS NULL OR EXISTS(SELECT 1 FROM headman_assignments ha WHERE ha.user_id=$3 AND ha.group_id=m.group_id AND ha.starts_on<=($2::timestamptz AT TIME ZONE 'Europe/Moscow')::date AND (ha.ends_on IS NULL OR ha.ends_on>=($2::timestamptz AT TIME ZONE 'Europe/Moscow')::date))) AND u.role IN ('student','headman') AND m.starts_on<=($2::timestamptz AT TIME ZONE 'Europe/Moscow')::date AND (m.ends_on IS NULL OR m.ends_on>=($2::timestamptz AT TIME ZONE 'Europe/Moscow')::date) ORDER BY u.name,u.id",
    [s.offering_id, s.starts_at, actor?.role==='headman'?actor.id:null],
    c,
  );
}
async function json(req) {
  let b = "";
  for await (const chunk of req) {
    b += chunk;
    if (Buffer.byteLength(b) > 65536)
      throw error(413, "Слишком большой запрос");
  }
  try {
    const v = JSON.parse(b || "{}");
    if (!v || Array.isArray(v) || typeof v !== "object") throw 0;
    return v;
  } catch {
    throw error(400, "Некорректный запрос");
  }
}
export async function features(req, res, u) {
  const location = new URL(req.url, "http://localhost"),
    p = location.pathname,
    method = req.method;
  const match = (re) => p.match(re);
  let m;
  if (method === "GET" && p === "/api/offerings")
    return rows(
      `SELECT o.*,c.title,g.name group_name,offering_group_names(o.id) group_names FROM offerings o JOIN courses c ON c.id=o.course_id JOIN groups g ON g.id=o.group_id WHERE $2='coordinator' OR o.teacher_id=$1 OR EXISTS(SELECT 1 FROM memberships m WHERE offering_has_group(o.id,m.group_id) AND m.user_id=$1 AND m.starts_on<=CURRENT_DATE AND (m.ends_on IS NULL OR m.ends_on>=CURRENT_DATE)) ORDER BY c.title`,
      [u.id, u.role],
    );
  if (method === "GET" && p === "/api/directory") {
    admin(u);
    return {
      groups: await rows("SELECT * FROM groups ORDER BY name"),
      courses: await rows("SELECT * FROM courses ORDER BY title"),
      users: await rows("SELECT id,name,email,role FROM users ORDER BY name"),
      memberships: await rows("SELECT * FROM memberships"),
      headmen: await rows("SELECT * FROM headman_assignments"),
    };
  }
  if (method === "POST" && p === "/api/groups") {
    admin(u);
    const b = await json(req);
    return (
      await rows("INSERT INTO groups(name) VALUES($1) RETURNING *", [
        text(b.name, 100),
      ])
    )[0];
  }
  if (method === "POST" && p === "/api/users") {
    admin(u);
    const b = await json(req);
    if (!["student", "headman", "teacher", "coordinator"].includes(b.role))
      throw error(400, "Некорректная роль");
    if (!/^\S+@\S+\.\S+$/.test(b.email || ""))
      throw error(400, "Некорректная почта");
    if (
      typeof b.password !== "string" ||
      b.password.length < 12 ||
      b.password.length > 128
    )
      throw error(400, "Пароль должен содержать 12–128 символов");
    return (
      await rows(
        "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role",
        [
          text(b.name, 150),
          b.email.toLowerCase(),
          await hashPassword(b.password),
          b.role,
        ],
      )
    )[0];
  }
  if (method === "POST" && p === "/api/memberships") {
    admin(u);
    const b = await json(req);
    if (
      !(
        await rows(
          "SELECT 1 FROM users WHERE id=$1 AND role IN ('student','headman')",
          [id(b.user_id)],
        )
      ).length
    )
      throw error(400, "Нужен студент или староста");
    return transaction(async (c) => {
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        id(b.user_id),
      ]);
      const end = b.ends_on ? day(b.ends_on) : null,
        start = day(b.starts_on);
      if (end && end < start) throw error(400, "Конец периода раньше начала");
      if (
        (
          await rows(
            "SELECT 1 FROM memberships WHERE user_id=$1 AND daterange(starts_on,COALESCE(ends_on,'infinity'::date),'[]') && daterange($2::date,COALESCE($3::date,'infinity'::date),'[]')",
            [b.user_id, start, end],
            c,
          )
        ).length
      )
        throw error(409, "Периоды членства пересекаются");
      return (
        await rows(
          "INSERT INTO memberships(user_id,group_id,starts_on,ends_on) VALUES($1,$2,$3,$4) RETURNING *",
          [b.user_id, id(b.group_id), start, end],
          c,
        )
      )[0];
    });
  }
  if (method === "POST" && p === "/api/headmen") {
    admin(u);
    const b = await json(req);
    const start = day(b.starts_on),
      end = b.ends_on ? day(b.ends_on) : null;
    if (end && end < start) throw error(400, "Конец периода раньше начала");
    if (
      !(
        await rows("SELECT 1 FROM users WHERE id=$1 AND role='headman'", [
          id(b.user_id),
        ])
      ).length
    )
      throw error(400, "Нужен пользователь с ролью старосты");
    if (
      !(
        await rows(
          "SELECT 1 FROM memberships WHERE user_id=$1 AND group_id=$2 AND starts_on<=$3::date AND (ends_on IS NULL OR ($4::date IS NOT NULL AND ends_on>=$4::date))",
          [b.user_id, id(b.group_id), start, end],
        )
      ).length
    )
      throw error(400, "Назначение должно входить в период членства в группе");
    return (
      await rows(
        "INSERT INTO headman_assignments(user_id,group_id,starts_on,ends_on) VALUES($1,$2,$3,$4) RETURNING *",
        [b.user_id, b.group_id, start, end],
      )
    )[0];
  }
  if (method === "POST" && p === "/api/memberships/end") {
    admin(u);
    const b = await json(req),
      end = day(b.ends_on),
      start = day(b.starts_on);
    if (end < start) throw error(400, "Конец периода раньше начала");
    return transaction(async (c) => {
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        id(b.user_id),
      ]);
      const r = await c.query(
        "UPDATE memberships SET ends_on=$1 WHERE user_id=$2 AND group_id=$3 AND starts_on=$4 RETURNING *",
        [end, b.user_id, id(b.group_id), start],
      );
      if (!r.rowCount) throw error(404, "Членство не найдено");
      await c.query(
        "UPDATE headman_assignments SET ends_on=$1 WHERE user_id=$2 AND group_id=$3 AND starts_on<=$1 AND (ends_on IS NULL OR ends_on>$1)",
        [end, b.user_id, b.group_id],
      );
      return r.rows[0];
    });
  }
  if (method === "POST" && p === "/api/courses") {
    staff(u);
    const b = await json(req);
    return (
      await rows("INSERT INTO courses(title) VALUES($1) RETURNING *", [
        text(b.title, 200),
      ])
    )[0];
  }
  if (method === "POST" && p === "/api/offerings") {
    admin(u);
    const b = await json(req);
    if (
      !(
        await rows("SELECT 1 FROM users WHERE id=$1 AND role='teacher'", [
          id(b.teacher_id),
        ])
      ).length
    )
      throw error(400, "Нужен преподаватель");
    return (
      await rows(
        "INSERT INTO offerings(course_id,teacher_id,group_id,semester) VALUES($1,$2,$3,$4) RETURNING *",
        [id(b.course_id), b.teacher_id, id(b.group_id), text(b.semester, 100)],
      )
    )[0];
  }
  if (method === "POST" && p === "/api/sessions") {
    const b = await json(req);
    await offering(u, b.offering_id);
    return (
      await rows(
        "INSERT INTO sessions(offering_id,title,starts_at,room) VALUES($1,$2,$3,$4) RETURNING *",
        [
          b.offering_id,
          text(b.title, 200),
          date(b.starts_at),
          String(b.room || "").slice(0, 200),
        ],
      )
    )[0];
  }
  if (method === "PATCH" && (m = match(/^\/api\/sessions\/(\d+)$/))) {
    const b = await json(req);
    return transaction(async (c) => {
      await c.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
        id(m[1]),
      ]);
      const s = await session(u, m[1], "read", c);
      await offering(u, s.offering_id, c);
      if (b.cancelled !== undefined && typeof b.cancelled !== "boolean")
        throw error(400, "Неверный статус");
      if(b.starts_at&&new Date(b.starts_at).getTime()!==s.starts_at.getTime())await moveSession(c,s,u.id,date(b.starts_at),String(b.reason||'Изменено преподавателем').slice(0,1000));
      return (
        await rows(
          "UPDATE sessions SET title=$1,starts_at=$2,room=$3,cancelled=$4 WHERE id=$5 RETURNING *",
          [
            text(b.title ?? s.title, 200),
            date(b.starts_at ?? s.starts_at.toISOString()),
            String(b.room ?? s.room ?? "").slice(0, 200),
            b.cancelled ?? s.cancelled,
            s.id,
          ],
          c,
        )
      )[0];
    });
  }
  if (method === "POST" && p === "/api/homework") {
    const b = await json(req),
      s = await session(u, b.session_id);
    await offering(u, s.offering_id);
    return transaction(async (c) => {
      const h = (
        await rows(
          "INSERT INTO homework(session_id,title,description,due_at) VALUES($1,$2,$3,$4) RETURNING *",
          [s.id, text(b.title, 200), text(b.description), date(b.due_at)],
          c,
        )
      )[0];
      await c.query(
        "INSERT INTO homework_versions(homework_id,snapshot,changed_by) VALUES($1,$2,$3)",
        [h.id, h, u.id],
      );
      await notify(c,s.offering_id,'homework:'+h.id,'Новое задание: '+h.title,h.description,'homework',h.id);
      return h;
    });
  }
  if (method === "PATCH" && (m = match(/^\/api\/homework\/(\d+)$/))) {
    const b = await json(req);
    return transaction(async (c) => {
      const h = (
        await rows(
          "SELECT * FROM homework WHERE id=$1 FOR UPDATE",
          [id(m[1])],
          c,
        )
      )[0];
      if (!h) throw error(404, "ДЗ не найдено");
      const s = await session(u, h.session_id, "read", c);
      await offering(u, s.offering_id, c);
      const updated = (
        await rows(
          "UPDATE homework SET title=$1,description=$2,due_at=$3 WHERE id=$4 RETURNING *",
          [
            text(b.title ?? h.title, 200),
            text(b.description ?? h.description),
            date(b.due_at ?? h.due_at.toISOString()),
            h.id,
          ],
          c,
        )
      )[0];
      await c.query(
        "INSERT INTO homework_versions(homework_id,snapshot,changed_by) VALUES($1,$2,$3)",
        [h.id, updated, u.id],
      );
      await notify(c,s.offering_id,`homework-update:${h.id}:${Date.now()}`,'Изменено задание: '+updated.title,'Проверьте условие и срок','homework',h.id);
      return updated;
    });
  }
  if (method === "DELETE" && (m = match(/^\/api\/homework\/(\d+)\/done$/))) {
    const h = (
      await rows("SELECT session_id FROM homework WHERE id=$1", [id(m[1])])
    )[0];
    if (!h) throw error(404, "ДЗ не найдено");
    await session(u, h.session_id);
    await pool.query(
      "DELETE FROM homework_done WHERE homework_id=$1 AND user_id=$2",
      [m[1], u.id],
    );
    return { ok: true };
  }
  if (method === "GET" && (m = match(/^\/api\/sessions\/(\d+)\/roster$/))) {
    const s = await session(u, m[1], "write");
    const list = await roster(s,pool,u);
    const marks = await rows("SELECT * FROM attendance WHERE session_id=$1", [
      s.id,
    ]);
    return {
      students: list.map((x) => ({
        ...x,
        ...marks.find((a) => a.student_id === x.id),
      })),
      cancelled: s.cancelled,
      history: await rows(
          "SELECT h.*,u.name actor FROM attendance_history h JOIN users u ON u.id=h.changed_by WHERE h.session_id=$1 AND ($2::integer[] IS NULL OR h.student_id=ANY($2::integer[])) ORDER BY h.id DESC",
          [s.id,u.role==='headman'?list.map(student=>student.id):null],
      ),
    };
  }
  if (method === "PUT" && (m = match(/^\/api\/sessions\/(\d+)\/attendance$/))) {
    const b = await json(req);
    return transaction(async (c) => {
      await c.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
        id(m[1]),
      ]);
      const s = await session(u, m[1], "write", c);
      if (s.cancelled) throw error(409, "Занятие отменено");
      const list = await roster(s, c,u),
        student = id(b.student_id);
      if (!list.some((x) => x.id === student))
        throw error(400, "Студент не входил в состав группы на дату занятия");
      if (
        !["present", "absent", "late", "excused", "unmarked"].includes(b.status)
      )
        throw error(400, "Неизвестная отметка");
      const old = (
        await rows(
          "SELECT * FROM attendance WHERE session_id=$1 AND student_id=$2",
          [s.id, student],
          c,
        )
      )[0];
      if (old && old.status !== b.status && !String(b.reason || "").trim())
        throw error(400, "Укажите причину исправления");
      if (b.status === "unmarked") {
        if (old) {
          await c.query(
            "INSERT INTO attendance_history(session_id,student_id,status,changed_by,reason) VALUES($1,$2,$3,$4,$5)",
            [s.id, student, "unmarked", u.id, text(b.reason, 1000)],
          );
          await c.query(
            "DELETE FROM attendance WHERE session_id=$1 AND student_id=$2",
            [s.id, student],
          );
        }
        return { ok: true };
      }
      await c.query(
        "INSERT INTO attendance(session_id,student_id,status,updated_by,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_id,student_id) DO UPDATE SET status=EXCLUDED.status,updated_by=EXCLUDED.updated_by,reason=EXCLUDED.reason,updated_at=now()",
        [s.id, student, b.status, u.id, String(b.reason || "").slice(0, 1000)],
      );
      return { ok: true };
    });
  }
  if (method === "GET" && (m = match(/^\/api\/offerings\/(\d+)\/students$/))) {
    const o = await offering(u, m[1]);
    return rows(
      "SELECT DISTINCT ON (u.id) u.id,u.name,g.id group_id,g.name group_name FROM memberships m JOIN users u ON u.id=m.user_id JOIN groups g ON g.id=m.group_id WHERE offering_has_group($1,m.group_id) AND m.starts_on<=CURRENT_DATE AND (m.ends_on IS NULL OR m.ends_on>=CURRENT_DATE) AND u.role IN ('student','headman') ORDER BY u.id,m.starts_on DESC",
      [o.id],
    );
  }
  if (method === "POST" && p === "/api/debts") {
    const b = await json(req),
      o = await offering(u, b.offering_id);
    const students=[...new Set((Array.isArray(b.student_ids)?b.student_ids:[b.student_id]).map(id))];
    if(!students.length||students.length>100)throw error(400,"Выберите от 1 до 100 студентов");
    const reason=text(b.reason),source=text(b.source,500);
    return transaction(async c=>{
      const eligible=await rows("SELECT DISTINCT user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE user_id=ANY($1::int[]) AND offering_has_group($2,group_id) AND u.role IN ('student','headman')",[students,o.id],c);
      if(eligible.length!==students.length)throw error(400,"Студент не обучался в группе");
      const created=[];
      for(const student of students){
        const d=(await rows("INSERT INTO debts(student_id,offering_id,reason,source,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",[student,o.id,reason,source,u.id],c))[0];
        await c.query("INSERT INTO debt_events(debt_id,actor_id,event,note) VALUES($1,$2,'created',$3)",[d.id,u.id,source]);
        await c.query("INSERT INTO notifications(recipient_id,event_key,title,message,target_page,target_id) VALUES($1,$2,'Новая задолженность',$3,'debts',$4) ON CONFLICT DO NOTHING",[student,'debt:'+d.id,reason,d.id]);
        created.push(d);
      }
      return Array.isArray(b.student_ids)?created:created[0];
    });
  }
  if (method === "GET" && p === "/api/debts")
    return rows(
      "SELECT d.*,c.title course,u.name student,(SELECT g.name FROM memberships mm JOIN groups g ON g.id=mm.group_id WHERE mm.user_id=d.student_id ORDER BY mm.starts_on DESC LIMIT 1) group_name FROM debts d JOIN offerings o ON o.id=d.offering_id JOIN courses c ON c.id=o.course_id JOIN users u ON u.id=d.student_id WHERE d.student_id=$1 OR (o.teacher_id=$1 AND $2='teacher') OR $2='coordinator' ORDER BY d.id DESC",
      [u.id, u.role],
    );
  if (method === "POST" && p === "/api/retakes") {
    const b = await json(req),
      o = await offering(u, b.offering_id);
    const kind=b.kind||'retake',start=instant(b.starts_at);
    if(!['retake','debt_day'].includes(kind))throw error(400,'Выберите тип встречи');
    if(new Date(start)<=new Date())throw error(400,'Выберите будущую дату');
    const debtIds=[...new Set((Array.isArray(b.debt_ids)?b.debt_ids:[]).map(id))].sort((a,b)=>a-b);
    if(!debtIds.length||debtIds.length>1000)throw error(400,'Выберите студентов с открытыми задолженностями');
    return transaction(async c=>{
      const debts=await rows('SELECT * FROM debts WHERE id=ANY($1::int[]) AND offering_id=$2 AND NOT closed ORDER BY id FOR UPDATE',[debtIds,o.id],c);
      if(debts.length!==debtIds.length)throw error(400,'Выберите открытые долги по своему предмету');
      if(kind==='retake'&&(await rows("SELECT 1 FROM retake_registrations x JOIN retakes r ON r.id=x.retake_id WHERE x.debt_id=ANY($1::int[]) AND x.result IS NULL AND r.status='scheduled' AND r.kind='retake'",[debtIds],c)).length)throw error(409,'У выбранного студента уже назначена пересдача по этому долгу');
      const capacity=kind==='retake'?debtIds.length:id(b.capacity);
      const r=(await rows("INSERT INTO retakes(offering_id,starts_at,room,capacity,kind) VALUES($1,$2,$3,$4,$5) RETURNING *",[o.id,start,text(b.room,200),capacity,kind],c))[0];
      await c.query('INSERT INTO retake_eligibility(retake_id,debt_id) SELECT $1,unnest($2::int[])',[r.id,debtIds]);
      if(kind==='retake'){
        await c.query('INSERT INTO retake_registrations(retake_id,debt_id) SELECT $1,unnest($2::int[])',[r.id,debtIds]);
        await c.query("INSERT INTO debt_events(debt_id,actor_id,event,note) SELECT unnest($1::int[]),$2,'registered',$3",[debtIds,u.id,'Назначена пересдача '+r.id]);
      }
      await c.query("INSERT INTO notifications(recipient_id,event_key,title,message,target_page,target_id) SELECT DISTINCT d.student_id,$2,$3,$4,'debts',$1::integer FROM debts d WHERE d.id=ANY($5::int[]) ON CONFLICT DO NOTHING",[r.id,'retake-day:'+r.id,kind==='debt_day'?'Открыта запись на сдачу долгов':'Вам назначена пересдача',new Date(start).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' · '+r.room,debtIds]);
      return r;
    });
  }
  if(method==='POST'&&(m=match(/^\/api\/retakes\/(\d+)\/(cancel|move)$/))){
    const b=await json(req),reason=text(b.reason,1000),move=m[2]==='move';
    return transaction(async c=>{
      const r=(await rows('SELECT * FROM retakes WHERE id=$1 FOR UPDATE',[id(m[1])],c))[0];
      if(!r)throw error(404,'Встреча не найдена');await offering(u,r.offering_id,c);
      if(r.status==='cancelled')throw error(409,'Встреча уже отменена');
      if(r.starts_at<=new Date()||(await rows('SELECT 1 FROM retake_registrations WHERE retake_id=$1 AND result IS NOT NULL',[r.id],c)).length)throw error(409,'Начавшуюся встречу изменять нельзя');
      const start=move?instant(b.starts_at):null,room=move?text(b.room,200):r.room;
      if(move&&new Date(start)<=new Date())throw error(400,'Выберите будущую дату');
      await c.query(move?"UPDATE retakes SET previous_starts_at=starts_at,starts_at=$2,room=$3,change_reason=$4,revision=revision+1 WHERE id=$1":"UPDATE retakes SET status='cancelled',change_reason=$2,revision=revision+1 WHERE id=$1",move?[r.id,start,room,reason]:[r.id,reason]);
      const title=r.kind==='debt_day'?(move?'День сдачи долгов перенесён':'День сдачи долгов отменён'):(move?'Пересдача перенесена':'Пересдача отменена');
      const message=move?new Date(start).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' · '+room+' · '+reason:reason;
      await c.query("INSERT INTO notifications(recipient_id,event_key,title,message,target_page,target_id) SELECT DISTINCT d.student_id,$2,$3,$4,'debts',$1::integer FROM retake_registrations x JOIN debts d ON d.id=x.debt_id WHERE x.retake_id=$1 ON CONFLICT DO NOTHING",[r.id,`retake-change:${r.id}:${r.revision+1}`,title,message]);
      await c.query("INSERT INTO audit_events(actor_id,object_type,object_id,action,detail) VALUES($1,'retake',$2,$3,$4)",[u.id,r.id,move?'move':'cancel',JSON.stringify({reason,previous_starts_at:r.starts_at,starts_at:start,room})]);
      return {ok:true};
    });
  }
  if (method === "GET" && p === "/api/retakes")
    return rows(
      `SELECT r.*,c.title course,(SELECT count(*)::int FROM retake_registrations x WHERE x.retake_id=r.id) booked,COALESCE((SELECT json_agg(e.debt_id) FROM retake_eligibility e JOIN debts d ON d.id=e.debt_id WHERE e.retake_id=r.id AND (d.student_id=$1 OR o.teacher_id=$1 OR $2='coordinator')),'[]') eligible_debt_ids FROM retakes r JOIN offerings o ON o.id=r.offering_id JOIN courses c ON c.id=o.course_id WHERE o.teacher_id=$1 AND $2='teacher' OR $2='coordinator' OR (r.kind='debt_day' AND EXISTS(SELECT 1 FROM retake_eligibility e JOIN debts d ON d.id=e.debt_id WHERE e.retake_id=r.id AND d.student_id=$1)) OR (r.kind='retake' AND EXISTS(SELECT 1 FROM retake_registrations x JOIN debts d ON d.id=x.debt_id WHERE x.retake_id=r.id AND d.student_id=$1)) ORDER BY r.starts_at`,
      [u.id, u.role],
    );
  if (method === "POST" && (m = match(/^\/api\/retakes\/(\d+)\/register$/))) {
    if(!["student","headman"].includes(u.role))throw error(403,"Студент записывается самостоятельно");
    const b = await json(req);
    return transaction(async (c) => {
      const r = (
        await rows(
          "SELECT * FROM retakes WHERE id=$1 FOR UPDATE",
          [id(m[1])],
          c,
        )
      )[0];
      if (!r) throw error(404, "Пересдача не найдена");
      if(r.kind!=='debt_day')throw error(403,"На пересдачу назначает преподаватель");
      const d = (
        await rows(
          "SELECT * FROM debts WHERE id=$1 FOR UPDATE",
          [id(b.debt_id)],
          c,
        )
      )[0];
      if(d&&d.student_id!==u.id)throw error(400,"Нужна ваша открытая задолженность по этому предмету");
      if (!d || d.offering_id !== r.offering_id || d.closed)
        throw error(400, "Нужна открытая задолженность по этому предмету");
      if(!(await rows('SELECT 1 FROM retake_eligibility WHERE retake_id=$1 AND debt_id=$2',[r.id,d.id],c)).length)throw error(403,'Вы не включены в список должников на этот день');
      if(r.status==='cancelled')throw error(409,"Встреча отменена");
      if (r.starts_at <= new Date()) throw error(409, "Встреча уже началась");
      if (
        (
          await rows(
            "SELECT 1 FROM retake_registrations x JOIN retakes r ON r.id=x.retake_id WHERE x.debt_id=$1 AND x.result IS NULL AND r.status='scheduled' AND r.kind='debt_day'",
            [d.id],
            c,
          )
        ).length
      )
        throw error(409, "Вы уже записаны на сдачу этого долга");
      const count = (
        await rows(
          "SELECT count(*)::int n FROM retake_registrations WHERE retake_id=$1",
          [r.id],
          c,
        )
      )[0].n;
      if (count >= r.capacity) throw error(409, "Свободных мест нет");
      await c.query(
        "INSERT INTO retake_registrations(retake_id,debt_id) VALUES($1,$2)",
        [r.id, d.id],
      );
      await c.query(
        "INSERT INTO debt_events(debt_id,actor_id,event,note) VALUES($1,$2,'registered',$3)",
        [d.id, u.id, `Пересдача ${r.id}`],
      );
      await c.query("INSERT INTO notifications(recipient_id,event_key,title,message,target_page,target_id) VALUES($1,$2,$5,$3,'debts',$4) ON CONFLICT DO NOTHING",[d.student_id,`retake:${r.id}:${d.id}`,new Date(r.starts_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' · '+r.room,r.id,r.kind==='debt_day'?'Запись на сдачу долгов':'Запись на пересдачу']);
      return { ok: true };
    });
  }
  if (method === "GET" && p === "/api/registrations")
    return rows(
      "SELECT x.*,d.student_id,d.reason debt_reason,(SELECT g.name FROM memberships mm JOIN groups g ON g.id=mm.group_id WHERE mm.user_id=d.student_id ORDER BY mm.starts_on DESC LIMIT 1) group_name,u.name student,r.starts_at,r.offering_id,r.kind,r.status,r.room,r.change_reason,r.previous_starts_at,c.title course FROM retake_registrations x JOIN debts d ON d.id=x.debt_id JOIN users u ON u.id=d.student_id JOIN retakes r ON r.id=x.retake_id JOIN offerings o ON o.id=r.offering_id JOIN courses c ON c.id=o.course_id WHERE d.student_id=$1 OR (o.teacher_id=$1 AND $2='teacher') OR $2='coordinator' ORDER BY r.starts_at",
      [u.id, u.role],
    );
  if(method==='POST'&&(m=match(/^\/api\/retakes\/(\d+)\/results$/))){
    const b=await json(req),selected=[...new Set((Array.isArray(b.debt_ids)?b.debt_ids:[]).map(id))].sort((a,b)=>a-b),group=text(b.group_name,100);
    if(!selected.length||selected.length>1000)throw error(400,'Отметьте сдавших студентов');
    return transaction(async c=>{
      const r=(await rows('SELECT * FROM retakes WHERE id=$1 FOR UPDATE',[id(m[1])],c))[0];if(!r)throw error(404,'Встреча не найдена');await offering(u,r.offering_id,c);if(r.status==='cancelled')throw error(409,'Встреча отменена');
      const records=await rows("SELECT x.*,d.student_id,(SELECT g.name FROM memberships mm JOIN groups g ON g.id=mm.group_id WHERE mm.user_id=d.student_id ORDER BY mm.starts_on DESC LIMIT 1) group_name FROM retake_registrations x JOIN debts d ON d.id=x.debt_id WHERE x.retake_id=$1 AND x.debt_id=ANY($2::int[]) ORDER BY d.id FOR UPDATE OF x,d",[r.id,selected],c);
      if(records.length!==selected.length||records.some(x=>x.group_name!==group))throw error(400,'Выберите студентов этой группы, назначенных на эту дату');
      if(records.some(x=>x.result&&x.result!=='passed'))throw error(409,'Результат уже внесён');
      for(const x of records){if(x.result==='passed')continue;
        await c.query("UPDATE retake_registrations SET result='passed' WHERE retake_id=$1 AND debt_id=$2",[r.id,x.debt_id]);
        await c.query('UPDATE debts SET closed=true WHERE id=$1',[x.debt_id]);
        await c.query("INSERT INTO debt_events(debt_id,actor_id,event,note) VALUES($1,$2,'passed',$3)",[x.debt_id,u.id,'Закрыто преподавателем: '+(r.kind==='retake'?'пересдача':'сдача долгов')+' '+r.id]);
        await c.query("INSERT INTO notifications(recipient_id,event_key,title,message,target_page,target_id) VALUES($1,$2,'Задолженность закрыта',$3,'debts',$4) ON CONFLICT DO NOTHING",[x.student_id,`retake-result:${r.id}:${x.debt_id}`,'Преподаватель отметил успешную сдачу',r.id]);
      }
      await c.query("INSERT INTO audit_events(actor_id,object_type,object_id,action,detail) VALUES($1,'retake',$2,'results',$3)",[u.id,r.id,JSON.stringify({group,debt_ids:selected,result:'passed'})]);return {ok:true};
    });
  }
  if (method === "POST" && (m = match(/^\/api\/retakes\/(\d+)\/result$/))) {
    const b = await json(req);
    if (!["passed", "failed"].includes(b.result))
      throw error(400, "Неизвестный результат");
    return transaction(async (c) => {
      const r = (
        await rows("SELECT * FROM retakes WHERE id=$1 FOR UPDATE", [id(m[1])], c)
      )[0];
      if (!r) throw error(404, "Пересдача не найдена");
      await offering(u, r.offering_id, c);
      if(r.status==='cancelled')throw error(409,"Встреча отменена");
      const x = (
        await rows(
          "SELECT * FROM retake_registrations WHERE retake_id=$1 AND debt_id=$2 FOR UPDATE",
          [r.id, id(b.debt_id)],
          c,
        )
      )[0];
      if (!x || x.result)
        throw error(409, "Запись отсутствует или результат уже внесён");
      await c.query(
        "UPDATE retake_registrations SET result=$1 WHERE retake_id=$2 AND debt_id=$3",
        [b.result, r.id, b.debt_id],
      );
      if (b.result === "passed")
        await c.query("UPDATE debts SET closed=true WHERE id=$1", [b.debt_id]);
      await c.query(
        "INSERT INTO debt_events(debt_id,actor_id,event,note) VALUES($1,$2,$3,$4)",
        [b.debt_id, u.id, b.result, text(b.note, 1000)],
      );
      return { ok: true };
    });
  }
  if (method === "POST" && p === "/api/materials") {
    const b = await json(req);
    await offering(u, b.offering_id);
    return transaction(async (c) => {
      const x = (
        await rows(
          "INSERT INTO materials(offering_id,title,url) VALUES($1,$2,$3) RETURNING *",
          [b.offering_id, text(b.title, 200), url(b.url)],
          c,
        )
      )[0];
      await c.query(
        "INSERT INTO material_history(material_id,version,title,url,changed_by) VALUES($1,$2,$3,$4,$5)",
        [x.id, x.version, x.title, x.url, u.id],
      );
      return x;
    });
  }
  if (method === "PATCH" && (m = match(/^\/api\/materials\/(\d+)$/))) {
    const b = await json(req);
    return transaction(async (c) => {
      const old = (
        await rows(
          "SELECT * FROM materials WHERE id=$1 FOR UPDATE",
          [id(m[1])],
          c,
        )
      )[0];
      if (!old) throw error(404, "Материал не найден");
      await offering(u, old.offering_id, c);
      await c.query(
        "INSERT INTO material_history(material_id,version,title,url,changed_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [old.id, old.version, old.title, old.url, u.id],
      );
      const x = (
        await rows(
          "UPDATE materials SET title=$1,url=$2,version=version+1,updated_at=now() WHERE id=$3 RETURNING *",
          [text(b.title, 200), url(b.url), old.id],
          c,
        )
      )[0];
      await c.query(
        "INSERT INTO material_history(material_id,version,title,url,changed_by) VALUES($1,$2,$3,$4,$5)",
        [x.id, x.version, x.title, x.url, u.id],
      );
      return x;
    });
  }
  if((method==='POST'&&p==='/api/contacts')||(method==='PATCH'&&(m=match(/^\/api\/contacts\/(\d+)$/)))){
    admin(u);const b=await json(req),telegram=String(b.telegram||'').trim().replace(/^@/,''),email=String(b.email||'').trim();
    if(telegram&&!/^[a-zA-Z0-9_]{5,32}$/.test(telegram))throw error(400,'Проверьте Telegram: нужен ник без ссылки');
    if(email&&(email.length>200||!/^\S+@\S+\.\S+$/.test(email)))throw error(400,'Проверьте почту');
    if(!email&&!telegram)throw error(400,'Укажите почту или Telegram');
    const values=[text(b.name,150),text(b.position,200),email,telegram];
    if(method==='POST')return (await rows('INSERT INTO contacts(name,position,email,telegram) VALUES($1,$2,$3,$4) RETURNING *',values))[0];
    const updated=(await rows('UPDATE contacts SET name=$1,position=$2,email=$3,telegram=$4,verified_at=CURRENT_DATE WHERE id=$5 RETURNING *',[...values,id(m[1])]))[0];if(!updated)throw error(404,'Контакт не найден');return updated;
  }
  if (
    method === "POST" &&
    (m = match(/^\/api\/applications\/(\d+)\/reject$/))
  ) {
    return transaction(async (c) => {
      const a = (
        await rows(
          "SELECT a.id FROM applications a JOIN project_roles r ON r.id=a.role_id JOIN projects p ON p.id=r.project_id WHERE a.id=$1 AND p.owner_id=$2 AND a.status='pending' FOR UPDATE OF a",
          [id(m[1]), u.id],
          c,
        )
      )[0];
      if (!a) throw error(404, "Заявка не найдена");
      await c.query("UPDATE applications SET status='rejected' WHERE id=$1", [
        a.id,
      ]);
      await c.query(
        "INSERT INTO application_events(application_id,actor_id,status) VALUES($1,$2,'rejected')",
        [a.id, u.id],
      );
      return { ok: true };
    });
  }
  if (method === "GET" && p === "/api/schedule") {
    const s = (
      await rows(
        "SELECT id,entries,source_url,published_at FROM schedule_imports WHERE published_at IS NOT NULL ORDER BY published_at DESC,id DESC LIMIT 1",
      )
    )[0];
    return s || { entries: [], source_url: SOURCE_URL, published_at: null };
  }
  if (method === "POST" && p === "/api/schedule/preview") {
    admin(u);
    let s;
    try {
      s = await fetchSchedule();
    } catch (e) {
      throw error(502, e.message);
    }
    const record = (
      await rows(
        "INSERT INTO schedule_imports(checksum,entries,source_url,created_by) VALUES($1,$2,$3,$4) RETURNING id",
        [s.checksum, JSON.stringify(s.entries), SOURCE_URL, u.id],
      )
    )[0];
    return { ...record, ...s };
  }
  if (method === "POST" && (m = match(/^\/api\/schedule\/(\d+)\/publish$/))) {
    admin(u);
    return transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(882416)");
      const s = (
        await rows("SELECT * FROM schedule_imports WHERE id=$1", [id(m[1])], c)
      )[0];
      if (!s) throw error(404, "Предпросмотр не найден");
      const existing = (
        await rows(
          "SELECT id FROM schedule_imports WHERE checksum=$1 AND published_at IS NOT NULL",
          [s.checksum],
          c,
        )
      )[0];
      if (existing) return { id: existing.id, unchanged: true };
      await c.query(
        "UPDATE schedule_imports SET published_at=now() WHERE id=$1",
        [s.id],
      );
      return { id: s.id, ok: true };
    });
  }
  if (
    method === "GET" &&
    (m = match(/^\/api\/offerings\/(\d+)\/attendance\.xlsx$/))
  ) {
    const from = day(location.searchParams.get("from")),
      to = day(location.searchParams.get("to"));
    if (from > to) throw error(400, "Неверный период");
    return transaction(async (c) => {
      await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const o = (
        await rows("SELECT * FROM offerings WHERE id=$1", [id(m[1])], c)
      )[0];
      if (!o) throw error(404, "Преподавание не найдено");
      if (!(
        u.role === "coordinator" ||
        (u.role === "teacher" && o.teacher_id === u.id)
      )) {
        if (
          u.role !== "headman" ||
          !(
            await rows(
              "SELECT 1 FROM headman_assignments WHERE user_id=$1 AND offering_has_group($2,group_id) AND starts_on<=$3 AND (ends_on IS NULL OR ends_on>=$4)",
              [u.id, o.id, from, to],
              c,
            )
          ).length
        )
          throw error(403, "Нет прав на выгрузку за весь выбранный период");
      }
      const sessions = await rows(
        "SELECT * FROM sessions WHERE offering_id=$1 AND (starts_at AT TIME ZONE 'Europe/Moscow')::date BETWEEN $2 AND $3 AND NOT cancelled ORDER BY starts_at,id",
        [o.id, from, to],
        c,
      );
      if (sessions.length > 366) throw error(400, "Сократите период выгрузки");
      const matrix = new Map();
      for (const s of sessions)
        for (const student of await roster({ ...s, group_id: o.group_id }, c,u)) {
          if (!matrix.has(student.id))
            matrix.set(student.id, { ...student, marks: new Map() });
          matrix.get(student.id).marks.set(s.id, "—");
        }
      const marks = await rows(
        "SELECT a.* FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.offering_id=$1",
        [o.id],
        c,
      );
      const legend = { present: "П", absent: "Н", late: "О", excused: "У" };
      for (const mark of marks)
        if (matrix.get(mark.student_id)?.marks.has(mark.session_id))
          matrix
            .get(mark.student_id)
            .marks.set(mark.session_id, legend[mark.status]);
      const book = new ExcelJS.Workbook(),
        sheet = book.addWorksheet("Посещаемость"),
        summary = book.addWorksheet("Сводка"),
        info = book.addWorksheet("Сведения");
      sheet.addRow([
        "Студент",
        ...sessions.map(
          (s) =>
            s.starts_at.toLocaleDateString("ru-RU", {
              timeZone: "Europe/Moscow",
            }) +
            " " +
            s.title,
        ),
      ]);
      summary.addRow([
        "Студент",
        "Занятий",
        "Присутствий",
        "Пропусков",
        "Опозданий",
        "Уважительных",
        "Не отмечено",
        "Посещаемость %",
      ]);
      for (const s of [...matrix.values()].sort(
        (a, b) => a.name.localeCompare(b.name, "ru") || a.id - b.id,
      )) {
        sheet.addRow([
          s.name,
          ...sessions.map((x) => s.marks.get(x.id) || "Не в составе"),
        ]);
        const v = [...s.marks.values()],
          n = (x) => v.filter((t) => t === x).length,
          den = n("П") + n("О") + n("Н");
        summary.addRow([
          s.name,
          v.length,
          n("П"),
          n("Н"),
          n("О"),
          n("У"),
          n("—"),
          den ? Math.round((100 * (n("П") + n("О"))) / den) : null,
        ]);
      }
      info.addRows([
        ["Преподавание", o.id],
        ["Период", `${from} — ${to}`],
        ["Время выгрузки", new Date().toISOString()],
        [
          "Легенда",
          "П — присутствовал; Н — отсутствовал; О — опоздал; У — уважительная причина; — — не отмечен",
        ],
        ["Процент", "(П + О) / (П + О + Н) × 100; У и неотмеченные исключены"],
        ["Состав занятий", sessions.map((s) => s.id).join(", ")],
        ["Отменённые занятия", "Исключены"],
        ["Состав студентов", "По членству в группе на дату каждого занятия"],
      ]);
      for (const s of book.worksheets) {
        s.getRow(1).font = { bold: true };
        s.columns.forEach((col, i) => (col.width = i === 0 ? 34 : 22));
        s.views = [{ state: "frozen", ySplit: 1 }];
      }
      await c.query(
        "INSERT INTO attendance_exports(user_id,offering_id,from_date,to_date) VALUES($1,$2,$3,$4)",
        [u.id, o.id, from, to],
      );
      const bytes = await book.xlsx.writeBuffer();
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="attendance.xlsx"',
      );
      res.end(bytes);
      return null;
    });
  }
  if (method === "GET" && (m = match(/^\/api\/homework\/(\d+)\/history$/))) {
    const h = (
      await rows("SELECT session_id FROM homework WHERE id=$1", [id(m[1])])
    )[0];
    if (!h) throw error(404, "ДЗ не найдено");
    await session(u, h.session_id);
    return rows(
      "SELECT v.*,u.name actor FROM homework_versions v JOIN users u ON u.id=v.changed_by WHERE homework_id=$1 ORDER BY id DESC",
      [m[1]],
    );
  }
  if (method === "GET" && (m = match(/^\/api\/materials\/(\d+)\/history$/))) {
    const a = (
      await rows(
        "SELECT m.id FROM materials m JOIN offerings o ON o.id=m.offering_id WHERE m.id=$1 AND ($3='coordinator' OR o.teacher_id=$2 OR EXISTS(SELECT 1 FROM memberships x WHERE offering_has_group(o.id,x.group_id) AND x.user_id=$2 AND x.starts_on<=CURRENT_DATE AND (x.ends_on IS NULL OR x.ends_on>=CURRENT_DATE)))",
        [id(m[1]), u.id, u.role],
      )
    )[0];
    if (!a) throw error(404, "Материал не найден");
    return rows(
      "SELECT h.*,u.name actor FROM material_history h JOIN users u ON u.id=h.changed_by WHERE material_id=$1 ORDER BY version DESC",
      [m[1]],
    );
  }
  return NO_ROUTE;
}
