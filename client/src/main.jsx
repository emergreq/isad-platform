import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import MvpPages from "./MvpPages.jsx";
import TodaySchedule from "./TodaySchedule.jsx";
import Schedule from "./StudySchedule.jsx";
import ProjectInterests from "./ProjectInterests.jsx";
import {StudentDebts} from "./RetakeDays.jsx";
import DebtManager from "./DebtManager.jsx";
import CourseworkPanel from "./CourseworkPanel.jsx";
import Journal from "./AttendanceJournal.jsx";
import CourseRequirements,{assessmentNames} from "./CourseRequirements.jsx";
import {currentRoute,useDeepFocus} from "./navigation.js";
const menu = [
  ["home", "Главная", "◫"],
  ["calendar", "Календарь", "▦"],
  ["sessions", "Расписание", "▦"],
  ["homework", "Задания", "✓"],
  ["attendance", "Посещаемость", "◷"],
  ["materials", "Материалы", "▤"],
  ["projects", "Проекты", "◇"],
  ["debts", "Долги и пересдачи", "↗"],
  ["contacts", "Контакты", "◉"],
  ["assistant", "Помощник", "✧"],
  ["hackathons", "Хакатоны и зачёты", "◇"],
  ["notifications", "Уведомления", "◉"],
  ["profile", "Мой профиль", "◉"],
];
const roleNames = {
  student: "Студент",
  headman: "Староста",
  teacher: "Преподаватель",
  coordinator: "Координатор",
};
const statuses = {
  present: "Присутствовал",
  absent: "Отсутствовал",
  late: "Опоздал",
  excused: "Уважительная причина",
};
const api = async (path, options = {}) => {
  const r = await fetch("/api/" + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error);
  return d;
};
const date = (x) =>
  new Date(x).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
const option = (id, label) => ({ value: id, label });
function Form({ title, fields, onSubmit, submit = "Сохранить", onClose }) {
  const [values, setValues] = useState(
      Object.fromEntries(fields.map((f) => [f.name, f.value ?? ""])),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="form-panel">
      <div className="section-head">
        <h3>{title}</h3>
        {onClose && (
          <button type="button" className="link" onClick={onClose}>
            Закрыть ×
          </button>
        )}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSubmit(
              Object.fromEntries(
                Object.entries(values).map(([k, v]) => [
                  k,
                  fields.find((f) => f.name === k)?.type === "datetime-local" &&
                  v
                    ? new Date(v).toISOString()
                    : v,
                ]),
              ),
            );
            onClose?.();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {fields.map((f) => (
            <label key={f.name}>
              {f.label}
              {f.options ? (
                <select
                  required={f.required !== false}
                  value={values[f.name]}
                  onChange={(e) =>
                    setValues({ ...values, [f.name]: e.target.value })
                  }
                >
                  <option value="">Выберите…</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  required={f.required !== false}
                  value={values[f.name]}
                  onChange={(e) =>
                    setValues({ ...values, [f.name]: e.target.value })
                  }
                />
              ) : (
                <input
                  type={f.type || "text"}
                  min={f.type === "number" ? 1 : undefined}
                  required={f.required !== false}
                  value={values[f.name]}
                  onChange={(e) =>
                    setValues({ ...values, [f.name]: e.target.value })
                  }
                />
              )}
            </label>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Сохраняем…" : submit}
        </button>
      </form>
    </section>
  );
}
const field = (name, label, type = "text", value) => ({
  name,
  label,
  type,
  value,
});
function Icon({ name, size = 20, ...props }) {
  const paths = {
    home: "M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
    sessions: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2Zm2 10h3m4 0h3m-10 4h3",
    homework: "m8 12 3 3 5-6M9 3h6l1 3H8l1-3ZM8 4H5v17h14V4h-3",
    attendance: "M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
    materials: "M4 4h6l2 2h8v14H4V4Zm4 6h8m-8 4h6",
    projects: "M8 7V4h8v3M3 7h18v13H3V7Zm0 6h18m-11 0v3h4v-3",
    debts: "M5 7h12l-4-4m4 4-4 4M19 17H7l4 4m-4-4 4-4",
    contacts: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m13-17a4 4 0 0 1 0 8m7 9v-2a4 4 0 0 0-3-3M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    search: "m16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    refresh: "M20 7v5h-5m5 0a8 8 0 1 0-2 6",
    logout: "M9 3H4v18h5m-1-9h13m-5-5 5 5-5 5",
    sparkle: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
    admin: "M12 8v8m-4-4h8M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name] || paths[({calendar:"sessions",assistant:"sparkle",notifications:"homework",profile:"contacts",hackathons:"projects"})[name]] || paths.materials} /></svg>;
}
function Brand() {
  return <div className="brand"><span className="brand-symbol misis-logo" role="img" aria-label="Логотип Университета МИСИС"><img src="/misis-logo.png" alt="" /></span><div>isad<span className="brand-hub">hub</span><small>твоё учебное пространство</small></div></div>;
}
function StudyArt({ id = "study" }) {
  return <svg className="study-art" viewBox="0 0 330 280" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-ring`} x1="40" y1="40" x2="240" y2="240" gradientUnits="userSpaceOnUse"><stop stopColor="#A4F8FF"/><stop offset=".45" stopColor="#24C9FB"/><stop offset="1" stopColor="#2855FF"/></linearGradient>
      <linearGradient id={`${id}-book`} x1="110" y1="60" x2="270" y2="230" gradientUnits="userSpaceOnUse"><stop stopColor="#fff"/><stop offset="1" stopColor="#C9E4FF"/></linearGradient>
      <linearGradient id={`${id}-petal`} x1="210" y1="20" x2="250" y2="110" gradientUnits="userSpaceOnUse"><stop stopColor="#DFFBFF"/><stop offset="1" stopColor="#24C9FB"/></linearGradient>
      <radialGradient id={`${id}-ball`} cx=".35" cy=".25" r=".8"><stop stopColor="#E8FFFF"/><stop offset=".45" stopColor="#34D6ED"/><stop offset="1" stopColor="#057CE5"/></radialGradient>
      <filter id={`${id}-shadow`} x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="15" stdDeviation="10" floodColor="#001C87" floodOpacity=".2"/></filter>
    </defs>
    <ellipse cx="168" cy="244" rx="102" ry="12" fill="#001C87" opacity=".1"/>
    <g filter={`url(#${id}-shadow)`}><ellipse cx="115" cy="145" rx="81" ry="91" transform="rotate(-29 115 145)" stroke={`url(#${id}-ring)`} strokeWidth="29"/>
    <g transform="rotate(13 205 156)"><rect x="135" y="88" width="120" height="144" rx="14" fill="#123AAE"/><rect x="141" y="83" width="119" height="143" rx="13" fill={`url(#${id}-book)`}/><path d="M159 92v123" stroke="#67ADF7" strokeWidth="2"/><path d="M177 117h59m-59 12h43m-43 54h57m-57 10h37" stroke="#3072C9" strokeWidth="4" strokeLinecap="round"/><path d="m197 146 6 13 14 2-10 10 2 14-12-7-13 7 3-14-11-10 15-2 6-13Z" fill="#1756CE"/></g></g>
    <g transform="translate(255 65)"><circle r="28" stroke="#7BEAFF" strokeWidth="11"/><path d="M0-28a28 28 0 0 1 28 28" stroke="#1764FA" strokeWidth="11"/><circle r="13" stroke="#E5FCFF" strokeWidth="5"/><circle r="4" fill="#7BEAFF"/></g>
    <circle cx="84" cy="63" r="15" fill={`url(#${id}-ball)`}/><circle cx="278" cy="223" r="21" fill={`url(#${id}-ball)`}/><path d="m43 189 3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z" fill="#D5FAFF"/>
  </svg>;
}
function App() {
  const [me, setMe] = useState(null),
    [checking, setChecking] = useState(true),
    [page, setPage] = useState(currentRoute().page),
    [data, setData] = useState({}),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [editor, setEditor] = useState(null),
    [query, setQuery] = useState(""),
    [materialCourse, setMaterialCourse] = useState("");
  const [requirements,setRequirements]=useState(null);
  const searchRef = useRef(null);
  const [routeKey,setRouteKey]=useState(location.hash);
  useDeepFocus(data.projects,routeKey);
  const scheduleWeek=useRef(null);scheduleWeek.current=data.schedule?.week_from;
  const latestNotification=useRef('');latestNotification.current=String(data.notifications?.[0]?.id||'');
  useEffect(()=>{
    if(!me)return;let stopped=false;
    const refresh=async()=>{if(document.hidden)return;try{const previousLatest=latestNotification.current;const notifications=await api('notifications');if(!stopped)setData(d=>({...d,notifications}));const day=new Date(Date.now()+3*3600000);const monday=new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate()-((day.getUTCDay()||7)-1))).toISOString().slice(0,10);if((scheduleWeek.current&&scheduleWeek.current!==monday)||String(notifications[0]?.id||'')!==previousLatest){const [schedule,coursework,debts,retakes,registrations]=await Promise.all([api('schedule'),api('coursework'),api('debts'),api('retakes'),api('registrations')]);if(!stopped)setData(d=>({...d,schedule,coursework,debts,retakes,registrations}));}}catch{}};
    const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);
    return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[me?.id]);
  useEffect(()=>{const changed=()=>{const route=currentRoute();setPage(menu.some(x=>x[0]===route.page)?route.page:'home');setRouteKey(location.hash);setRequirements(null);setEditor(null);setQuery('');if(route.page==='home')api('offerings').then(offerings=>setData(d=>({...d,offerings}))).catch(()=>{});if(route.page==='projects')api('projects').then(projects=>setData(d=>({...d,projects}))).catch(()=>{});if(route.page==='sessions')api('schedule').then(schedule=>setData(d=>({...d,schedule}))).catch(()=>{});};window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed);},[]);
  useEffect(() => {
    const handleKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        if (searchRef.current) { event.preventDefault(); searchRef.current.focus(); }
      }
      if (event.key === "Escape") setQuery("");
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
  const load = async () => {
    setLoading(true);
    try {
      const keys = [
        "sessions",
        "homework",
        "coursework",
        "attendance",
        "debts",
        "materials",
        "projects",
        "contacts",
        "applications",
        "offerings",
        "retakes",
        "registrations",
        "schedule",
        "notifications",
        "study-overview",
      ];
      if (me?.role === "coordinator") keys.push("directory");
      setData(
        Object.fromEntries(
          await Promise.all(keys.map(async (k) => [k, await api(k)])),
        ),
      );
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    api("me")
      .then(setMe)
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (me) load();
  }, [me]);
  const mutate = async (path, value = {}, method = "POST") => {
    const result = await api(path, { method, body: JSON.stringify(value) });
    await load();
    return result;
  };
  const action = async (...args) => {
    try {
      await mutate(...args);
    } catch (e) {
      setError(e.message);
    }
  };
  const edit = (title, fields, path, method = "POST") =>
    setEditor({ title, fields, onSubmit: (v) => mutate(path, v, method) });
  const staff = ["teacher", "coordinator"].includes(me?.role),
    coordinator = me?.role === "coordinator";
  const offerings = (data.offerings || []).filter(
      (o) => coordinator || o.teacher_id === me?.id,
    ),
    offeringOptions = offerings.map((o) =>
      option(o.id, `${o.title} · ${o.group_name}`),
    );
  const navigate = (id) => {
    location.hash=id; setPage(id); setRequirements(null); setEditor(null); setError(""); setQuery(""); setMaterialCourse("");
  };
  const courses = [...new Map((data.offerings || []).map(x => [x.title, x])).values()];
  const railDeadlines = data["study-overview"]?.deadlines || [];
  const pending = (data.homework || []).filter(x => !x.done).sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  const searchRows = query.trim() ? [
    ...menu.map(([id, title]) => ({ id: `page-${id}`, title, kind: "Раздел", page: id })),
    ...(data.materials || []).map(x => ({ id: `material-${x.id}`, title: x.title, detail: x.course, kind: "Материал", page: "materials", course: x.course })),
    ...(data.homework || []).map(x => ({ id: `homework-${x.id}`, title: x.title, detail: x.course, kind: "Задание", page: "homework" })),
    ...courses.map(x => ({ id: `course-${x.id}`, title: x.title, kind: "Предмет", page: "materials", course: x.title })),
  ].filter(x => `${x.title} ${x.detail || ""}`.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"))).slice(0, 8) : [];
  if (checking) return <div className="empty">Загружаем кабинет…</div>;
  if (!me)
    return (
      <main className="login">
        <section className="login-story">
          <Brand />
          <div className="login-story-copy"><h2>Учиться.<br/>Создавать.<br/><em>Быть собой.</em></h2><p>Твои предметы, люди и возможности.<br/>Собрали всё в одном пространстве.</p></div>
          <StudyArt id="login" />
          <span className="login-story-note">a little space for big ideas ✧</span>
        </section>
        <div className="login-card">
          <div className="login-mobile-brand"><Brand /></div>
          <p className="eyebrow">ПОРТАЛ КАФЕДРЫ</p>
          <h1>
            Всё для учёбы
            <br />в одном месте.
          </h1>
          <p>Занятия, материалы и проекты вашего сообщества.</p>
          <Form
            title="Вход в кабинет"
            fields={[
              field("email", "Почта", "email", "student@example.org"),
              field("password", "Пароль", "password"),
            ]}
            submit="Войти →"
            onSubmit={async (v) => {
              await api("login", { method: "POST", body: JSON.stringify(v) });
              setMe(await api("me"));
            }}
          />
          <small>Демонстрационный стенд · ИСАД</small>
        </div>
      </main>
    );
  const title =
    page === "admin" ? "Управление" : menu.find((x) => x[0] === page)?.[1];
  return (
    <div className="layout">
      <a className="skip-link" href="#main-content">Перейти к содержимому</a>
      <aside className="sidebar">
        <Brand />
        <div className="aside-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav aria-label="Разделы портала">
          {[
            ...menu,
            ...(coordinator ? [["admin", "Управление", "⚙"]] : []),
          ].map(([id, name]) => (
            <button
              key={id}
              onClick={() => navigate(id)}
              aria-current={page === id ? "page" : undefined}
              className={page === id ? "active" : ""}
            >
              <Icon name={id} />
              <span>{name}</span>
              {id === "homework" && pending.length > 0 && <span className="nav-count">{pending.length}</span>}{id === "notifications" && data.notifications?.some(x => !x.read_at) && <span className="nav-count">{data.notifications.filter(x => !x.read_at).length}</span>}
            </button>
          ))}
        </nav>

        <div className="aside-bottom">
          <button className="profile-shortcut" onClick={()=>navigate('profile')} aria-label="Открыть мой профиль"><span className="avatar">{me.name[0]}</span><span className="profile-shortcut-name"><strong>{me.name}</strong><small>{roleNames[me.role]}</small></span></button>
          <button
            title="Выйти"
            onClick={async () => {
              try {
                await api("logout", { method: "POST", body: "{}" });
                setMe(null);
                setData({});
                setPage("home");
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            <Icon name="logout" size={18} />
          </button>
        </div>
      </aside>
      <main className="main" id="main-content">
        <div className="topbar">
          <div className="search-wrap">
            <div className="search-field"><Icon name="search" size={18} /><input ref={searchRef} aria-label="Поиск по разделам, предметам, материалам и заданиям" placeholder="Найти предмет, материал или задание" value={query} onChange={e => setQuery(e.target.value)} aria-controls={query.trim() ? "search-results" : undefined} /><kbd>Ctrl K</kbd></div>
            {query.trim() && <div className="search-results" id="search-results"><div className="search-caption" role="status">{searchRows.length ? "Найдено в твоём пространстве" : "Ничего не нашлось. Попробуй другое слово."}</div>{searchRows.map(x => <button key={x.id} onClick={() => { navigate(x.page); if (x.course) setMaterialCourse(x.course); }}><Icon name={x.page}/><span><strong>{x.title}</strong><small>{x.kind}{x.detail ? ` · ${x.detail}` : ""}</small></span><Icon name="arrow" size={16}/></button>)}</div>}
          </div>
          <span className="today-label">{new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", weekday: "short" })}</span>
        </div>
        <header>
          <div>

            <h1>
              {page === "home"
                ? `Привет, ${me.name.split(" ")[0]}`
                : title}
              <span className="dot">.</span>
            </h1>

          </div>

        </header>
        {error && (
          <div className="error alert" role="alert">
            {error}
          </div>
        )}
        {requirements&&<CourseRequirements offering={requirements} api={api} onClose={()=>setRequirements(null)} onSaved={load}/>}
        {editor && (
          <Form
            key={editor.title}
            {...editor}
            onClose={() => setEditor(null)}
          />
        )}
        <MvpPages courseworks={data.coursework||[]} key={routeKey} page={page} me={me} offerings={data.offerings || []} onChanged={load} onGroupChanged={async()=>{setMaterialCourse("");setQuery("");const fresh=await api("me");if(fresh.name!==me.name)setMe(fresh);else await load();}} materialCourse={materialCourse}/>
        {page === "home" && (
          <>
            <TodaySchedule source={data.schedule} me={me} offerings={offerings}/>
            <div className="hero">
              <div>
                <span className="hero-label"><Icon name="sparkle" size={14}/> УЧЁБА В ТВОЁМ РИТМЕ</span>
                <h2>Меньше хаоса.<br/><em>Больше открытий.</em></h2>
                <p>Всё, что нужно для нового шага,<br/>уже в твоём пространстве.</p>
                <button onClick={() => navigate("sessions")}>Моё расписание <Icon name="arrow" size={17}/></button>
              </div>
              <StudyArt id="hero" />
            </div>
            {(data["study-overview"]?.deadlines || []).length > 0 && <section className="overview-box" style={{marginTop:18}}><div className="section-head"><h3>Ближайшие контрольные и сроки</h3><button className="link" onClick={() => navigate("calendar")}>Календарь →</button></div>{data["study-overview"].deadlines.slice(0,4).map(x => <div className="overview-item" key={x.key}><div><b>{x.title}</b><p>{x.course} · {x.date}{x.all_day ? " · время не указано" : ""}</p>{x.topics && <p>Темы: {x.topics}</p>}</div>{x.url && <a href={x.url} target="_blank" rel="noreferrer">Контест ↗</a>}</div>)}</section>}
            <div className="section-head"><div><h2>Мои предметы</h2></div><button className="link" onClick={() => navigate("materials")}>Все материалы <Icon name="arrow" size={15}/></button></div>
            <div className="course-grid">
              {courses.length ? courses.map((course, i) => {
                const materials = (data.materials || []).filter(x => x.course === course.title);
                const tasks = (data.homework || []).filter(x => x.course === course.title && !x.done);
                return <article className={`course-card course-tone-${i % 3}`} key={course.id} id={`course-${course.id}`}>
                  <div className="course-top"><span className="course-monogram">{course.title.split(" ").slice(0, 2).map(x => x[0]).join("").toLocaleUpperCase("ru")}</span><span className="course-group">{(course.group_names||[course.group_name]).join(' + ')}</span></div>
                  <h3>{course.title}</h3><p>{course.semester}</p>{course.assessment_type&&<span className="tag">{assessmentNames[course.assessment_type]}</span>}{course.completion_conditions&&<details className="course-conditions"><summary>Условия закрытия</summary><p className="multiline">{course.completion_conditions}</p></details>}{staff&&(coordinator||course.teacher_id===me.id)&&<button className="link" onClick={()=>setRequirements(course)}>Форма контроля и условия</button>}
                  <div className="course-files">{materials.length ? materials.slice(0, 2).map(x => <a href={x.url} key={x.id} target="_blank" rel="noreferrer"><Icon name="materials" size={15}/><span>{x.title}</span><Icon name="arrow" size={13}/></a>) : <div className="course-no-files">Материалы ещё не добавлены</div>}</div>
                  <div className="course-bottom"><span/><button aria-label={`Материалы: ${course.title}`} onClick={() => { navigate("materials"); setMaterialCourse(course.title); }}><Icon name="arrow" size={18}/></button></div>
                </article>;
              }) : <p className="empty">Предметы появятся после назначения преподаваний.</p>}
            </div>
            <div className="section-head upcoming-heading"><div><h2>Ближайшие занятия</h2></div><button className="link" onClick={() => navigate("sessions")}>Расписание <Icon name="arrow" size={15}/></button></div>

            <Sessions
              rows={(data.sessions || [])
                .filter(
                  (x) => !x.cancelled && new Date(x.starts_at) >= new Date(),
                )
                .slice(0, 3)}
            />
          </>
        )}
        {page === "sessions" && (
          <>
            <Schedule
              source={data.schedule}
              offerings={offerings}
              coordinator={coordinator}
              mutate={mutate}
            />
            <div className="section-head">
              <h2>Учебные занятия и ДЗ</h2>
              {staff && (
                <button
                  className="primary"
                  onClick={() =>
                    edit(
                      "Новое занятие",
                      [
                        {
                          name: "offering_id",
                          label: "Преподавание",
                          options: offeringOptions,
                        },
                        field("title", "Тема"),
                        field(
                          "starts_at",
                          "Дата и время (местное время браузера)",
                          "datetime-local",
                        ),
                        field("room", "Аудитория"),
                      ],
                      "sessions",
                    )
                  }
                >
                  + Занятие
                </button>
              )}
            </div>
            <Sessions
              rows={data.sessions || []}
              actions={
                staff
                  ? (s) => (
                      <>
                        <button
                          className="link"
                          onClick={() =>
                            edit(
                              "Изменить занятие",
                              [
                                field("title", "Тема", "text", s.title),
                                field(
                                  "starts_at",
                                  "Дата и время",
                                  "datetime-local",
                                  localDate(s.starts_at),
                                ),
                                field(
                                  "room",
                                  "Аудитория",
                                  "text",
                                  s.room || "",
                                ),
                              ],
                              `sessions/${s.id}`,
                              "PATCH",
                            )
                          }
                        >
                          Изменить
                        </button>
                        <button className="link" onClick={() => navigate("calendar")}>Отмена, ссылки и запись →</button>
                      </>
                    )
                  : null
              }
            />
          </>
        )}
        {page === "homework" && (
          <>
            <CourseworkPanel items={data.coursework||[]} offerings={offerings} staff={staff} api={api} onChanged={load}/>
            {staff && (
              <button
                className="primary"
                onClick={() =>
                  edit(
                    "Новое домашнее задание",
                    [
                      {
                        name: "session_id",
                        label: "Занятие",
                        options: (data.sessions || [])
                          .filter((s) =>
                            offerings.some((o) => o.id === s.offering_id),
                          )
                          .map((s) =>
                            option(s.id, `${s.title} · ${date(s.starts_at)}`),
                          ),
                      },
                      field("title", "Название"),
                      field("description", "Описание", "textarea"),
                      field("due_at", "Срок", "datetime-local"),
                    ],
                    "homework",
                  )
                }
              >
                + Задание
              </button>
            )}
            <div className="cards">
              {(data.homework || []).map((x) => (
                <article key={x.id}>
                  <div className="meta">
                    {x.course} · до {date(x.due_at)}
                  </div>
                  <h3>{x.title}</h3>
                  <p>{x.description}</p>
                  <span className="tag">{x.session_title}</span>
                  <div className="toolbar">
                    <button
                      onClick={() =>
                        action(
                          `homework/${x.id}/done`,
                          {},
                          x.done ? "DELETE" : "POST",
                        )
                      }
                    >
                      {x.done
                        ? "✓ Выполнено · отменить"
                        : "Отметить выполненным"}
                    </button>
                    {staff && (
                      <button
                        onClick={() =>
                          edit(
                            "Изменить ДЗ",
                            [
                              field("title", "Название", "text", x.title),
                              field(
                                "description",
                                "Описание",
                                "textarea",
                                x.description,
                              ),
                              field(
                                "due_at",
                                "Срок",
                                "datetime-local",
                                localDate(x.due_at),
                              ),
                            ],
                            `homework/${x.id}`,
                            "PATCH",
                          )
                        }
                      >
                        Редактировать
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {!data.homework?.length&&!data.coursework?.length && <Empty />}
          </>
        )}
        {page === "attendance" && (
          <>
            {(staff || me.role === "headman") && (
              <Journal
                me={me}
                api={api}
                onChanged={load}
                sessions={data.sessions || []}
                offerings={data.offerings || []}
              />
            )}
            {['student','headman'].includes(me.role)&&<>
            <h2>Моя посещаемость</h2>
            <List
              rows={data.attendance}
              render={(x) => (
                <>
                  <div className="attendance-session"><b>{x.course} · {x.title}</b><time className="attendance-date" dateTime={x.starts_at}>{new Date(x.starts_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})} МСК</time></div>
                  <span>{statuses[x.status]}</span>
                </>
              )}
            />
            </>}
          </>
        )}
        {page === "debts" && (
          <Retakes
            data={data}
            staff={staff}
            offerings={offeringOptions}
            owned={offerings}
            mutate={mutate}
            edit={edit}
          />
        )}
        {page === "legacy-materials" && (
          <>
            {materialCourse && <div className="material-filter"><span>Предмет: <strong>{materialCourse}</strong></span><button className="link" onClick={() => setMaterialCourse("")}>Все предметы ×</button></div>}
            {staff && (
              <button
                className="primary"
                onClick={() =>
                  edit(
                    "Добавить материал",
                    [
                      {
                        name: "offering_id",
                        label: "Преподавание",
                        options: offeringOptions,
                      },
                      field("title", "Название"),
                      field("url", "Ссылка", "url"),
                    ],
                    "materials",
                  )
                }
              >
                + Материал
              </button>
            )}
            <List
              rows={(data.materials || []).filter(x => !materialCourse || x.course === materialCourse)}
              render={(x) => (
                <>
                  <div>
                    <b>{x.title}</b>
                    <span>
                      {x.course} · версия {x.version} ·{" "}
                      <a href={x.url} target="_blank" rel="noreferrer">
                        Открыть ↗
                      </a>
                    </span>
                  </div>
                  {staff && (
                    <button
                      className="link"
                      onClick={() =>
                        edit(
                          "Новая версия материала",
                          [
                            field("title", "Название", "text", x.title),
                            field("url", "Ссылка", "url", x.url),
                          ],
                          `materials/${x.id}`,
                          "PATCH",
                        )
                      }
                    >
                      Новая версия
                    </button>
                  )}
                </>
              )}
            />
          </>
        )}
        {page === "contacts" && (
          <>
            {coordinator && (
              <button
                className="primary"
                onClick={() =>
                  edit(
                    "Добавить контакт",
                    [
                      field("name", "Имя"),
                      field("position", "Ответственность"),
                      {...field("email", "Рабочая почта", "email"),required:false},
                      {...field("telegram", "Telegram (@username)"),required:false},
                    ],
                    "contacts",
                  )
                }
              >
                + Контакт
              </button>
            )}
            <List
              rows={data.contacts}
              render={(x) => (
                <>
                  <div>
                    <b>{x.name}</b>
                    <span>
                      {x.position}
                    </span><span className="contact-links">{x.telegram&&<a href={`https://t.me/${x.telegram}`} target="_blank" rel="noreferrer">@{x.telegram} ↗</a>}{x.email&&<a href={`mailto:${x.email}`}>{x.email}</a>}
                    </span>
                  </div>
                  {coordinator && (
                    <button
                      className="link"
                      onClick={() =>
                        edit(
                          "Изменить контакт",
                          [
                            field("name", "Имя", "text", x.name),
                            field(
                              "position",
                              "Ответственность",
                              "text",
                              x.position,
                            ),
                            {...field("email", "Почта", "email", x.email),required:false},
                            {...field("telegram", "Telegram (@username)", "text", x.telegram),required:false},
                          ],
                          `contacts/${x.id}`,
                          "PATCH",
                        )
                      }
                    >
                      Изменить
                    </button>
                  )}
                </>
              )}
            />
          </>
        )}
        {page === "projects" && (
          <>
            <ProjectInterests api={api}/>
            <div className="section-head">
              <button
                className="primary"
                onClick={() =>
                  edit(
                    "Создать проект",
                    [
                      field("title", "Название"),
                      field("description", "Описание", "textarea"),
                    ],
                    "projects",
                  )
                }
              >
                + Проект
              </button>
            </div>
            <div className="cards">
              {(data.projects || []).map((x) => (
                <article key={x.id} id={`project-${x.id}`}>
                  <div className="meta">ПРОЕКТ · {x.owner}</div>
                  <h3>{x.title}</h3>
                  <p>{x.description}</p>
                  {x.roles.map((r) => {
                    const own = (data.applications || []).find(
                      (a) => a.role_id === r.id && a.user_id === me.id,
                    );
                    return (
                      <div className="role" key={r.id}>
                        <div>
                          <b>{r.title}</b>
                          <small>
                            {r.skills} · всего мест: {r.capacity}
                          </small>
                        </div>
                        {["student", "headman"].includes(me.role) &&
                          x.owner_id !== me.id && (
                            <button
                              disabled={!!own}
                              onClick={() =>
                                edit(
                                  "Заявка в проект",
                                  [
                                    field(
                                      "message",
                                      "Сообщение автору",
                                      "textarea",
                                    ),
                                  ],
                                  `roles/${r.id}/apply`,
                                  "POST",
                                )
                              }
                            >
                              {own
                                ? {
                                    pending: "На рассмотрении",
                                    accepted: "Принята",
                                    rejected: "Отклонена",
                                  }[own.status]
                                : "Подать заявку"}
                            </button>
                          )}
                      </div>
                    );
                  })}
                  {x.owner_id === me.id && (
                    <button
                      className="link"
                      onClick={() =>
                        edit(
                          "Добавить позицию",
                          [
                            field("title", "Роль"),
                            field("skills", "Навыки"),
                            field("capacity", "Число мест", "number"),
                          ],
                          `projects/${x.id}/roles`,
                        )
                      }
                    >
                      + Позиция в проекте
                    </button>
                  )}
                </article>
              ))}
            </div>
            <h2>Мои заявки и заявки в мои проекты</h2>
            <List
              rows={data.applications}
              render={(x) => (
                <>
                  <div>
                    <b>
                      {x.project} · {x.role}
                    </b>
                    <span>
                      {x.applicant} · {x.message} ·{" "}
                      {
                        {
                          pending: "На рассмотрении",
                          accepted: "Принята",
                          rejected: "Отклонена",
                        }[x.status]
                      }
                    </span>
                  </div>
                  {x.user_id !== me.id && x.status === "pending" && (
                    <div className="toolbar">
                      <button
                        className="link"
                        onClick={() => action(`applications/${x.id}/accept`)}
                      >
                        Принять
                      </button>
                      <button
                        className="link"
                        onClick={() => action(`applications/${x.id}/reject`)}
                      >
                        Отклонить
                      </button>
                    </div>
                  )}
                </>
              )}
            />
          </>
        )}
        {page === "admin" && coordinator && (
          <Admin
            directory={data.directory}
            offerings={data.offerings}
            edit={edit}
          />
        )}

      </main>
      <section className="study-rail" aria-label="Дедлайны и быстрые переходы">
        <div className="rail-heading"><span className="rail-symbol"><Icon name="sparkle" size={21}/></span><div><strong>Твой учебный ритм</strong></div></div>
        <div className="rail-section-head"><h2>Ближайшие дедлайны</h2><span>{railDeadlines.length}</span></div>
        <div className="deadline-list">{railDeadlines.length ? railDeadlines.slice(0, 4).map(x => <button key={x.key} onClick={() => navigate("calendar")}><span className={`deadline-dot ${x.priority === "Срок прошёл" ? "overdue" : ""}`}/><span><small>{x.course}</small><strong>{x.title}</strong><time dateTime={x.date}>{new Date(x.date + "T12:00:00+03:00").toLocaleDateString("ru-RU", {timeZone:"Europe/Moscow",day:"numeric",month:"long"})}{x.all_day ? " · время не указано" : ""}</time></span><Icon name="arrow" size={14}/></button>) : <div className="rail-empty"><Icon name="homework" size={26}/><strong>Ближайших сроков нет</strong><p>Данные проверены в учебном календаре.</p></div>}</div>
        <div className="rail-divider"/>

        <div className="quick-links"><button onClick={() => navigate("materials")}><span className="quick-icon rose"><Icon name="materials"/></span><span>Библиотека<small>Материалы: {data.materials?.length || 0}</small></span><Icon name="arrow" size={16}/></button><button onClick={() => navigate("projects")}><span className="quick-icon lilac"><Icon name="projects"/></span><span>Найти команду<small>Учебные проекты и идеи</small></span><Icon name="arrow" size={16}/></button><button onClick={() => navigate("contacts")}><span className="quick-icon mint"><Icon name="contacts"/></span><span>Быть на связи<small>Контакты кафедры</small></span><Icon name="arrow" size={16}/></button></div>


      </section>
    </div>
  );
}
function localDate(x) {
  const d = new Date(x);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function Empty() {
  return <p className="empty">Пока ничего нет.</p>;
}
function List({ rows = [], render }) {
  return (
    <div className="list">
      {rows.length ? (
        rows.map((x, i) => <div key={x.id || i}>{render(x)}</div>)
      ) : (
        <Empty />
      )}
    </div>
  );
}
function Sessions({ rows, actions }) {
  return (
    <List
      rows={rows}
      render={(x) => (
        <>
          <div className="session-icon">▦</div>
          <div>
            <b>
              {x.title} {x.cancelled && <span className="tag">Отменено</span>}
            </b>
            <span>
              {x.course} · {x.group_name} · {x.room || "Аудитория не указана"}
            </span>
          </div>
          <time>{date(x.starts_at)}</time>
          {actions?.(x)}
        </>
      )}
    />
  );
}
function Retakes({data,staff,owned,mutate,edit}) {
 return staff?<DebtManager data={data} offerings={owned} api={api} mutate={mutate} edit={edit}/>:<StudentDebts data={data} mutate={mutate}/>;
}
function Admin({ directory = {}, offerings = [], edit }) {
  const users = (directory.users || []).map((u) =>
      option(u.id, `${u.name} · ${roleNames[u.role]}`),
    ),
    groups = (directory.groups || []).map((g) => option(g.id, g.name)),
    courses = (directory.courses || []).map((c) => option(c.id, c.title));
  return (
    <>
      <div className="toolbar">
        <button
          className="primary"
          onClick={() =>
            edit(
              "Новый пользователь",
              [
                field("name", "Имя"),
                field("email", "Почта", "email"),
                field(
                  "password",
                  "Начальный пароль (от 12 символов)",
                  "password",
                ),
                {
                  name: "role",
                  label: "Роль",
                  options: Object.entries(roleNames).map(([k, v]) =>
                    option(k, v),
                  ),
                },
              ],
              "users",
            )
          }
        >
          + Пользователь
        </button>
        <button
          className="primary"
          onClick={() =>
            edit("Новая группа", [field("name", "Название")], "groups")
          }
        >
          + Группа
        </button>
        <button
          className="primary"
          onClick={() =>
            edit("Новая дисциплина", [field("title", "Название")], "courses")
          }
        >
          + Дисциплина
        </button>
        <button
          className="primary"
          onClick={() =>
            edit(
              "Новое преподавание",
              [
                { name: "course_id", label: "Дисциплина", options: courses },
                {
                  name: "teacher_id",
                  label: "Преподаватель",
                  options: (directory.users || [])
                    .filter((u) => u.role === "teacher")
                    .map((u) => option(u.id, u.name)),
                },
                { name: "group_id", label: "Группа", options: groups },
                field("semester", "Семестр"),
              ],
              "offerings",
            )
          }
        >
          + Преподавание
        </button>
        <button
          className="primary"
          onClick={() =>
            edit(
              "Зачислить в группу",
              [
                { name: "user_id", label: "Студент", options: users },
                { name: "group_id", label: "Группа", options: groups },
                field("starts_on", "Дата начала", "date"),
                {
                  ...field("ends_on", "Дата окончания", "date"),
                  required: false,
                },
              ],
              "memberships",
            )
          }
        >
          Зачислить в группу
        </button>
        <button
          className="primary"
          onClick={() =>
            edit(
              "Назначить старосту",
              [
                {
                  name: "user_id",
                  label: "Староста",
                  options: (directory.users || [])
                    .filter((u) => u.role === "headman")
                    .map((u) => option(u.id, u.name)),
                },
                { name: "group_id", label: "Группа", options: groups },
                field("starts_on", "Начало полномочий", "date"),
                {
                  ...field("ends_on", "Окончание полномочий", "date"),
                  required: false,
                },
              ],
              "headmen",
            )
          }
        >
          Назначить старосту
        </button>
      </div>
      <h2>Пользователи</h2>
      <List
        rows={directory.users}
        render={(x) => (
          <>
            <b>{x.name}</b>
            <span>
              {roleNames[x.role]} · {x.email}
            </span>
          </>
        )}
      />
      <h2>Состав групп и периоды</h2>
      <List
        rows={directory.memberships}
        render={(m) => (
          <>
            <div>
              <b>
                {(directory.users || []).find((u) => u.id === m.user_id)?.name}{" "}
                ·{" "}
                {
                  (directory.groups || []).find((g) => g.id === m.group_id)
                    ?.name
                }
              </b>
              <span>
                С {new Date(m.starts_on).toLocaleDateString("ru-RU")} ·{" "}
                {m.ends_on
                  ? `по ${new Date(m.ends_on).toLocaleDateString("ru-RU")}`
                  : "действует"}
              </span>
            </div>
            {!m.ends_on && (
              <button
                className="link"
                onClick={() =>
                  edit(
                    "Завершить членство",
                    [
                      {
                        name: "user_id",
                        label: "Студент",
                        options: [
                          option(
                            m.user_id,
                            (directory.users || []).find(
                              (u) => u.id === m.user_id,
                            )?.name,
                          ),
                        ],
                        value: m.user_id,
                      },
                      {
                        name: "group_id",
                        label: "Группа",
                        options: [
                          option(
                            m.group_id,
                            (directory.groups || []).find(
                              (g) => g.id === m.group_id,
                            )?.name,
                          ),
                        ],
                        value: m.group_id,
                      },
                      field(
                        "starts_on",
                        "Начало периода",
                        "date",
                        m.starts_on.slice(0, 10),
                      ),
                      field("ends_on", "Окончание периода", "date"),
                    ],
                    "memberships/end",
                  )
                }
              >
                Завершить период
              </button>
            )}
          </>
        )}
      />
      <h2>Преподавания</h2>
      <List
        rows={offerings}
        render={(x) => (
          <>
            <b>{x.title}</b>
            <span>
              {x.group_name} · {x.semester}
            </span>
          </>
        )}
      />
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
