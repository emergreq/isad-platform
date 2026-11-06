import {encryptPrivateData} from "./private-data.js";
import {mkdir,writeFile} from "node:fs/promises";
import { pool, transaction } from "./db.js";
import { hashPassword } from "./security.js";
if (process.env.NODE_ENV === "production")
  throw new Error("Demo seed is disabled in production");
const password = process.env.DEMO_PASSWORD;
if(!password||password.length<16)throw Error("Set a private DEMO_PASSWORD (16+ characters) in .env; run scripts/init-local-secrets.js first");
const hash = await hashPassword(password);
await transaction(async (c) => {
  if ((await c.query("SELECT 1 FROM users LIMIT 1")).rowCount)
    throw Error("Seed requires an empty database");
  for (const [name, email, role] of [
    ["Анна Студент", "student@example.org", "student"],
    ["Ирина Староста", "headman@example.org", "headman"],
    ["Сергей Преподаватель", "teacher@example.org", "teacher"],
    ["Мария Координатор", "coordinator@example.org", "coordinator"],
    ["Студент второй группы", "student2@example.org", "student"],
  ])
    await c.query(
      "INSERT INTO users(name,email,role,password_hash) VALUES($1,$2,$3,$4)",
      [name, email, role, hash],
    );
  await c.query(
    "INSERT INTO groups(name) VALUES ('ИСАД-101'),('ИСАД-102'); INSERT INTO memberships(user_id,group_id,starts_on) VALUES(1,1,'2025-09-01'),(2,1,'2025-09-01'),(5,2,'2025-09-01'); INSERT INTO courses(title) VALUES('Базы данных'),('Веб-разработка'); INSERT INTO offerings(course_id,teacher_id,group_id,semester) VALUES (1,3,1,'2026 осень'),(2,3,2,'2026 осень'); INSERT INTO sessions(offering_id,title,starts_at,room) VALUES (1,'Реляционная модель',now()+interval '2 days','А-401'); INSERT INTO homework(session_id,title,description,due_at) VALUES (1,'Спроектировать схему','Подготовьте ER-диаграмму.',now()+interval '9 days'); INSERT INTO materials(offering_id,title,url) VALUES (1,'Основы PostgreSQL','https://www.postgresql.org/docs/'); INSERT INTO contacts(name,position,email) VALUES ('Пример контакта','Учебный координатор','contact@example.org'); INSERT INTO projects(owner_id,title,description) VALUES(3,'Портал кафедры','Собираем команду для учебного проекта.'); INSERT INTO project_roles(project_id,title,skills,capacity) VALUES(1,'Frontend-разработчик','React, CSS',1)",
  );
});
if(process.env.LOCAL_ACCOUNTS_KEY){
 const accounts=(await pool.query("SELECT name,email,role FROM users ORDER BY id")).rows.map(x=>({...x,password}));
 await mkdir('work/private',{recursive:true});await writeFile('work/private/accounts.enc.json',JSON.stringify(encryptPrivateData({accounts},process.env.LOCAL_ACCOUNTS_KEY)),{mode:0o600});
}
console.log("Demo accounts created. Use npm run accounts:show -- --reveal in your private terminal.");
await pool.end();
