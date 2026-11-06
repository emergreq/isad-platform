import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { migrationFiles } from "./migrations.js";

// Прогоняет db/tests/016_checks.sql на отдельной временной базе со всеми миграциями.
// Запуск: npm run test:db (нужен DATABASE_URL с правом создавать базы).
test(
  "database logic from migration 016",
  { skip: process.env.RUN_DB_CHECKS !== "1" },
  async () => {
    const source = new URL(
      process.env.DATABASE_URL || "postgres://isad:isad@db:5432/isad",
    );
    const admin = new pg.Pool({ connectionString: source.href });
    const name = `isad_dbcheck_${Date.now()}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(source);
    url.pathname = "/" + name;
    const db = new pg.Pool({ connectionString: url.href });
    try {
      for (const file of await migrationFiles())
        await db.query(
          await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
        );
      // если какая-то проверка не прошла, скрипт сам падает со списком ошибок
      const results = await db.query(
        await readFile(
          new URL("../db/tests/016_checks.sql", import.meta.url),
          "utf8",
        ),
      );
      const table = results.find((r) => r.fields?.some((f) => f.name === "итог"));
      assert.ok(table.rows.length > 0);
      assert.deepEqual(table.rows.filter((r) => r["итог"] !== "OK"), []);
    } finally {
      await db.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      await admin.end();
    }
  },
);


test('project member updates preserve role capacity', {skip:process.env.RUN_DB_CHECKS!=='1'}, async t=>{
 const source=new URL(process.env.DATABASE_URL||'postgres://isad:isad@db:5432/isad');
 const admin=new pg.Pool({connectionString:source.href}),name='isad_capacity_'+Date.now();
 await admin.query(`CREATE DATABASE ${name}`);const url=new URL(source);url.pathname='/'+name;
 const db=new pg.Pool({connectionString:url.href});let a,b;
 try{
  for(const file of await migrationFiles())await db.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
  await db.query("INSERT INTO users(name,email,role,password_hash) VALUES('One','one@test.local','student','test'),('Two','two@test.local','student','test'),('Three','three@test.local','student','test'),('Teacher','teacher@test.local','teacher','test'),('Replacement','replacement@test.local','student','test');INSERT INTO projects(owner_id,title,description) VALUES(4,'Project A','Test'),(4,'Project B','Test');INSERT INTO project_roles(project_id,title,capacity) VALUES(1,'Full',1),(1,'Source',2),(1,'Target',1),(2,'Other project',2);INSERT INTO project_members(project_id,user_id,role_id) VALUES(1,1,1),(1,2,2),(1,3,2);");
  await t.test('moving to a full role fails and preserves membership',async()=>{
   await assert.rejects(db.query('UPDATE project_members SET role_id=1 WHERE user_id=2'),e=>e.code==='IH409');
   assert.equal((await db.query('SELECT role_id FROM project_members WHERE user_id=2')).rows[0].role_id,2);
   assert.equal((await db.query('SELECT count(*)::int n FROM project_members WHERE role_id=1')).rows[0].n,1);
  });
  await t.test('updating the same full role does not count the row twice',async()=>{
   await db.query('UPDATE project_members SET role_id=role_id WHERE user_id=1');
   await db.query('UPDATE project_members SET user_id=5 WHERE user_id=1');
   await db.query('UPDATE project_members SET user_id=1 WHERE user_id=5');
   assert.equal((await db.query('SELECT count(*)::int n FROM project_members WHERE role_id=1')).rows[0].n,1);
  });
  await t.test('a role from another project is rejected on UPDATE',async()=>{
   await assert.rejects(db.query('UPDATE project_members SET role_id=4 WHERE user_id=2'),e=>e.code==='IH422');
  });
  await t.test('a valid transfer succeeds',async()=>{
   await db.query('UPDATE project_members SET role_id=3 WHERE user_id=2');
   assert.equal((await db.query('SELECT role_id FROM project_members WHERE user_id=2')).rows[0].role_id,3);
   await db.query('UPDATE project_members SET role_id=2 WHERE user_id=2');
  });
  await t.test('two concurrent transfers cannot fill one last place twice',async()=>{
   a=await db.connect();b=await db.connect();await a.query('BEGIN');await b.query('BEGIN');await b.query("SET LOCAL statement_timeout='5s'");
   await a.query('UPDATE project_members SET role_id=3 WHERE user_id=2');
   const other=b.query('UPDATE project_members SET role_id=3 WHERE user_id=3').then(()=>null,e=>e.code);
   await a.query('COMMIT');assert.equal(await other,'IH409');await b.query('ROLLBACK');
   a.release();a=null;b.release();b=null;
   assert.equal((await db.query('SELECT count(*)::int n FROM project_members WHERE role_id=3')).rows[0].n,1);
   assert.equal((await db.query('SELECT role_id FROM project_members WHERE user_id=3')).rows[0].role_id,2);
  });
 }finally{
  if(a){await a.query('ROLLBACK');a.release();}if(b){await b.query('ROLLBACK');b.release();}
  await db.end();await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);await admin.end();
 }
});
