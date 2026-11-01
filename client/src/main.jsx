import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
const menu = [
  ["home", "Главная", "◫"],
  ["sessions", "Расписание", "▦"],
  ["homework", "Задания", "✓"],
  ["attendance", "Посещаемость", "◷"],
  ["materials", "Материалы", "▤"],
  ["projects", "Проекты", "◇"],
  ["debts", "Пересдачи", "↗"],
  ["contacts", "Контакты", "◉"],
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
function App() {
  const [me, setMe] = useState(null),
    [checking, setChecking] = useState(true),
    [page, setPage] = useState("home"),
    [data, setData] = useState({}),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [editor, setEditor] = useState(null);
  const load = async () => {
    setLoading(true);
    try {
      const keys = [
        "sessions",
        "homework",
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
  if (checking) return <div className="empty">Загружаем кабинет…</div>;
  if (!me)
    return (
      <main className="login">
        <div className="login-card">
          <div className="brand">
            <span>И</span> ISAD HUB
          </div>
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
      <aside>
        <div className="brand">
          <span>И</span> ISAD HUB
        </div>
        <div className="aside-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav>
          {[
            ...menu,
            ...(coordinator ? [["admin", "Управление", "⚙"]] : []),
          ].map(([id, name, icon]) => (
            <button
              key={id}
              onClick={() => {
                setPage(id);
                setEditor(null);
                setError("");
              }}
              className={page === id ? "active" : ""}
            >
              <i>{icon}</i>
              {name}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <div className="avatar">{me.name[0]}</div>
          <div>
            <strong>{me.name}</strong>
            <small>{roleNames[me.role]}</small>
          </div>
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
            ↪
          </button>
        </div>
      </aside>
      <main className="main">
        <header>
          <div>
            <span className="crumb">ИСАД / {title}</span>
            <h1>
              {page === "home"
                ? `Здравствуйте, ${me.name.split(" ")[0]}`
                : title}
              <span className="dot">.</span>
            </h1>
            <p>Всё важное для учёбы и проектов — здесь.</p>
          </div>
          <button className="badge" disabled={loading} onClick={load}>
            {loading ? "Обновляем…" : "↻ Обновить данные"}
          </button>
        </header>
        {error && (
          <div className="error alert" role="alert">
            {error}
          </div>
        )}
        {editor && (
          <Form
            key={editor.title}
            {...editor}
            onClose={() => setEditor(null)}
          />
        )}
        {page === "home" && (
          <>
            <div className="hero">
              <div>
                <span className="eyebrow">ВАШЕ УЧЕБНОЕ ПРОСТРАНСТВО</span>
                <h2>
                  Хороший день,
                  <br />
                  чтобы узнать что-то новое.
                </h2>
                <p>Следите за занятиями и находите команду для своих идей.</p>
                <button onClick={() => setPage("sessions")}>
                  Открыть расписание ↗
                </button>
              </div>
              <div className="hero-art">✳</div>
            </div>
            <div className="stats">
              <div>
                <small>БЛИЖАЙШИЕ ЗАНЯТИЯ</small>
                <strong>
                  {
                    (data.sessions || []).filter(
                      (x) =>
                        !x.cancelled && new Date(x.starts_at) >= new Date(),
                    ).length
                  }
                </strong>
                <span>в вашем учебном плане</span>
              </div>
              <div>
                <small>ДОМАШНИЕ ЗАДАНИЯ</small>
                <strong>
                  {data.homework?.filter((x) => !x.done).length || 0}
                </strong>
                <span>ещё не отмечено</span>
              </div>
              <div>
                <small>ПРОЕКТЫ</small>
                <strong>{data.projects?.length || 0}</strong>
                <span>в каталоге</span>
              </div>
            </div>
            <h2>Ближайшие учебные занятия</h2>
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
                        <button
                          className="link"
                          onClick={() =>
                            action(
                              `sessions/${s.id}`,
                              { cancelled: !s.cancelled },
                              "PATCH",
                            )
                          }
                        >
                          {s.cancelled ? "Восстановить" : "Отменить"}
                        </button>
                      </>
                    )
                  : null
              }
            />
          </>
        )}
        {page === "homework" && (
          <>
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
            {!data.homework?.length && <Empty />}
          </>
        )}
        {page === "attendance" && (
          <>
            {(staff || me.role === "headman") && (
              <Journal
                me={me}
                sessions={data.sessions || []}
                offerings={data.offerings || []}
              />
            )}
            <h2>Моя посещаемость</h2>
            <List
              rows={data.attendance}
              render={(x) => (
                <>
                  <b>
                    {x.course} · {x.title}
                  </b>
                  <span>{statuses[x.status]}</span>
                </>
              )}
            />
          </>
        )}
        {page === "debts" && (
          <Retakes
            data={data}
            staff={staff}
            offerings={offeringOptions}
            mutate={mutate}
            edit={edit}
          />
        )}
        {page === "materials" && (
          <>
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
              rows={data.materials}
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
                      field("email", "Рабочая почта", "email"),
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
                      {x.position} · <a href={`mailto:${x.email}`}>{x.email}</a>{" "}
                      · проверено{" "}
                      {new Date(x.verified_at).toLocaleDateString("ru-RU")}
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
                            field("email", "Почта", "email", x.email),
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
            <div className="section-head">
              <h2>Найдите свою команду</h2>
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
                <article key={x.id}>
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
        <footer>
          ISAD HUB <span>Учёба · сообщество · проекты</span>
        </footer>
      </main>
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
function Schedule({ source, coordinator, mutate }) {
  const [course, setCourse] = useState("2 курс"),
    [group, setGroup] = useState(""),
    [sub, setSub] = useState("1"),
    [week, setWeek] = useState("upper"),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const entries = source?.entries || [],
    groups = [
      ...new Set(entries.filter((x) => x.sheet === course).map((x) => x.group)),
    ].sort((a, b) => a.localeCompare(b, "ru", { numeric: true })),
    selected = groups.includes(group) ? group : groups[0] || "";
  const rows = entries.filter(
    (x) =>
      x.sheet === course &&
      x.group === selected &&
      String(x.subgroup) === sub &&
      x.week === week,
  );
  return (
    <section>
      <div className="section-head">
        <h2>Расписание из Google Sheets</h2>
        {coordinator && (
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setPreview(await api("schedule/preview"));
                setError("");
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Читаем таблицу…" : "Проверить обновление"}
          </button>
        )}
      </div>
      <p className="source">
        <a href={source?.source_url} target="_blank" rel="noreferrer">
          Исходная таблица ↗
        </a>{" "}
        ·{" "}
        {source?.published_at
          ? `обновлено ${date(source.published_at)}`
          : "ещё не опубликовано"}
        . Верхняя и нижняя — обозначения строк исходной таблицы.
      </p>
      {error && <p className="error">{error}</p>}
      {preview && (
        <div className="form-panel">
          <h3>Предварительный просмотр</h3>
          <p>
            Прочитано {preview.entries.length} записей:{" "}
            {preview.groups.join(", ")}.
          </p>
          <p>
            {preview.entries[0]?.day} · {preview.entries[0]?.title}
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await mutate(`schedule/${preview.id}/publish`);
                setPreview(null);
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Опубликовать версию
          </button>
          <button className="link" onClick={() => setPreview(null)}>
            Отмена
          </button>
        </div>
      )}
      <div className="filters">
        <label>
          Курс
          <select
            value={course}
            onChange={(e) => {
              setCourse(e.target.value);
              setGroup("");
            }}
          >
            {["2 курс", "3 курс", "4 курс"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Группа
          <select value={selected} onChange={(e) => setGroup(e.target.value)}>
            {groups.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        <label>
          Подгруппа
          <select value={sub} onChange={(e) => setSub(e.target.value)}>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </label>
        <label>
          Строка
          <select value={week} onChange={(e) => setWeek(e.target.value)}>
            <option value="upper">Верхняя</option>
            <option value="lower">Нижняя</option>
          </select>
        </label>
      </div>
      <List
        rows={rows}
        render={(x) => (
          <>
            <div className="session-icon">{x.lesson}</div>
            <div>
              <b>
                {x.day} · {x.title}
              </b>
              <span className="multiline">
                {x.teacher} · {x.room}
              </span>
            </div>
            <time>{x.time}</time>
          </>
        )}
      />
    </section>
  );
}
function Journal({ sessions, offerings, me }) {
  const [selected, setSelected] = useState(""),
    [roster, setRoster] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [from, setFrom] = useState(new Date().toISOString().slice(0, 8) + "01"),
    [to, setTo] = useState(new Date().toISOString().slice(0, 10)),
    [off, setOff] = useState("");
  const refresh = () =>
    selected
      ? api(`sessions/${selected}/roster`)
          .then((x) => {
            setRoster(x);
            setError("");
          })
          .catch((e) => {
            setError(e.message);
            setRoster(null);
          })
      : setRoster(null);
  useEffect(() => {
    refresh();
  }, [selected]);
  const update = async (student, status) => {
    if (!status && !student.status) return;
    let reason = "";
    if (student.status && student.status !== status) {
      reason = window.prompt("Причина исправления отметки") || "";
      if (!reason) return;
    }
    setBusy(true);
    try {
      await api(`sessions/${selected}/attendance`, {
        method: "PUT",
        body: JSON.stringify({
          student_id: student.id,
          status: status || "unmarked",
          reason,
        }),
      });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="form-panel">
      <h2>Журнал группы</h2>
      <label>
        Занятие
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Выберите занятие…</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.group_name} · {s.title} · {date(s.starts_at)}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      {roster && (
        <>
          <List
            rows={roster.students}
            render={(s) => (
              <>
                <b>{s.name}</b>
                <select
                  aria-label={`Отметка: ${s.name}`}
                  value={s.status || ""}
                  disabled={busy || roster.cancelled}
                  onChange={(e) => update(s, e.target.value)}
                >
                  <option value="">Не отмечен</option>
                  {Object.entries(statuses).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </>
            )}
          />
          <details>
            <summary>История исправлений ({roster.history.length})</summary>
            <List
              rows={roster.history}
              render={(x) => (
                <span>
                  {x.actor} · {statuses[x.status] || "Не отмечен"} ·{" "}
                  {x.reason || "Первая отметка"} · {date(x.changed_at)}
                </span>
              )}
            />
          </details>
        </>
      )}
      <h3>Выгрузить Excel</h3>
      <p className="source">
        Отменённые занятия исключаются. Неотмеченные и уважительные пропуски не
        входят в знаменатель процента.
      </p>
      <div className="filters">
        <label>
          Преподавание
          <select value={off} onChange={(e) => setOff(e.target.value)}>
            <option value="">Выберите…</option>
            {offerings.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title} · {o.group_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          С
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          По
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={!off || !from || !to}
          onClick={async () => {
            try {
              const response = await fetch(
                `/api/offerings/${off}/attendance.xlsx?from=${from}&to=${to}`,
              );
              if (!response.ok) throw Error((await response.json()).error);
              const href = URL.createObjectURL(await response.blob()),
                a = document.createElement("a");
              a.href = href;
              a.download = "attendance.xlsx";
              a.click();
              setTimeout(() => URL.revokeObjectURL(href), 1000);
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          Скачать .xlsx
        </button>
      </div>
    </section>
  );
}
function Retakes({ data, staff, offerings, mutate, edit }) {
  const [students, setStudents] = useState([]),
    [off, setOff] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (off)
      api(`offerings/${off}/students`)
        .then(setStudents)
        .catch((e) => setError(e.message));
  }, [off]);
  return (
    <>
      {error && <p className="error">{error}</p>}
      {staff && (
        <>
          <div className="toolbar">
            <select
              aria-label="Предмет для задолженности"
              value={off}
              onChange={(e) => setOff(e.target.value)}
            >
              <option value="">Выберите преподавание…</option>
              {offerings.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              className="primary"
              disabled={!off}
              onClick={() =>
                edit(
                  "Новая задолженность",
                  [
                    {
                      name: "offering_id",
                      label: "Предмет",
                      options: offerings,
                      value: off,
                    },
                    {
                      name: "student_id",
                      label: "Студент",
                      options: students.map((s) => option(s.id, s.name)),
                    },
                    field("reason", "Основание", "textarea"),
                    field("source", "Источник"),
                  ],
                  "debts",
                )
              }
            >
              + Задолженность
            </button>
            <button
              className="primary"
              onClick={() =>
                edit(
                  "Назначить пересдачу",
                  [
                    {
                      name: "offering_id",
                      label: "Предмет",
                      options: offerings,
                    },
                    field("starts_at", "Дата и время", "datetime-local"),
                    field("room", "Место"),
                    field("capacity", "Число мест", "number"),
                  ],
                  "retakes",
                )
              }
            >
              + Пересдача
            </button>
          </div>
        </>
      )}
      <h2>Задолженности</h2>
      <List
        rows={data.debts}
        render={(x) => (
          <>
            <div>
              <b>
                {x.course} · {x.student}
              </b>
              <span>
                {x.reason} · {x.closed ? "Закрыта" : "Открыта"} · источник:{" "}
                {x.source}
              </span>
            </div>
          </>
        )}
      />
      <h2>Доступные пересдачи</h2>
      <List
        rows={data.retakes}
        render={(x) => (
          <>
            <div>
              <b>
                {x.course} · {date(x.starts_at)}
              </b>
              <span>
                {x.room} · свободно {Math.max(0, x.capacity - x.booked)} из{" "}
                {x.capacity}
              </span>
            </div>
            {!staff && (
              <button
                className="link"
                disabled={
                  x.booked >= x.capacity || new Date(x.starts_at) <= new Date()
                }
                onClick={() =>
                  edit(
                    "Записаться на пересдачу",
                    [
                      {
                        name: "debt_id",
                        label: "Задолженность",
                        options: (data.debts || [])
                          .filter(
                            (d) => !d.closed && d.offering_id === x.offering_id,
                          )
                          .map((d) => option(d.id, d.reason)),
                      },
                    ],
                    `retakes/${x.id}/register`,
                  )
                }
              >
                Записаться
              </button>
            )}
          </>
        )}
      />
      <h2>Записи и результаты</h2>
      <List
        rows={data.registrations}
        render={(x) => (
          <>
            <div>
              <b>
                {x.course} · {x.student}
              </b>
              <span>
                {date(x.starts_at)} ·{" "}
                {x.result === "passed"
                  ? "Сдано"
                  : x.result === "failed"
                    ? "Не сдано"
                    : "Ожидается результат"}
              </span>
            </div>
            {staff && !x.result && (
              <button
                className="link"
                onClick={() =>
                  edit(
                    "Результат пересдачи",
                    [
                      {
                        name: "debt_id",
                        label: "Задолженность",
                        options: [
                          option(x.debt_id, `${x.student} · ${x.course}`),
                        ],
                        value: x.debt_id,
                      },
                      {
                        name: "result",
                        label: "Результат",
                        options: [
                          option("passed", "Сдано"),
                          option("failed", "Не сдано"),
                        ],
                      },
                      field("note", "Основание решения", "textarea"),
                    ],
                    `retakes/${x.retake_id}/result`,
                  )
                }
              >
                Внести результат
              </button>
            )}
          </>
        )}
      />
    </>
  );
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
