import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { hashPassword } from "../server/security.js";

test(
  "PostgreSQL and HTTP workflows in an isolated disposable database",
  { skip: process.env.RUN_INTEGRATION !== "1" },
  async (t) => {
    const source = new URL(
      process.env.DATABASE_URL || "postgres://isad:isad@db:5432/isad",
    );
    const admin = new pg.Pool({ connectionString: source.href });
    const name = `isad_test_${Date.now()}`;
    await admin.query(`CREATE DATABASE ${name}`);
    source.pathname = "/" + name;
    const db = new pg.Pool({ connectionString: source.href });
    let child;
    try {
      for (const file of ["001_initial.sql", "002_workflows.sql"])
        await db.query(
          await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
        );
      const password = "integration-pass";
      const hash = await hashPassword(password);
      for (const [n, role] of [
        ["student", "student"],
        ["headman", "headman"],
        ["teacher", "teacher"],
        ["coordinator", "coordinator"],
        ["other", "student"],
      ])
        await db.query(
          "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)",
          [n, n + "@example.org", hash, role],
        );
      await db.query(
        "INSERT INTO groups(name) VALUES('A'),('B');INSERT INTO memberships(user_id,group_id,starts_on) VALUES(1,1,'2025-01-01'),(2,1,'2025-01-01'),(5,2,'2025-01-01');INSERT INTO headman_assignments(user_id,group_id,starts_on) VALUES(2,1,'2025-01-01');INSERT INTO courses(title) VALUES('SQL');INSERT INTO offerings(course_id,teacher_id,group_id,semester) VALUES(1,3,1,'test')",
      );
      const port = 3198,
        base = `http://127.0.0.1:${port}/api/`;
      let output = "";
      child = spawn(process.execPath, ["server/index.js"], {
        env: { ...process.env, DATABASE_URL: source.href, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (b) => (output += b));
      child.stderr.on("data", (b) => (output += b));
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(Error(output || "API start timeout")),
          10000,
        );
        const timer = setInterval(() => {
          if (output.includes("API listening")) {
            clearInterval(timer);
            clearTimeout(timeout);
            resolve();
          }
        }, 50);
        child.once("exit", () => {
          clearInterval(timer);
          clearTimeout(timeout);
          reject(Error(output));
        });
      });
      const cookies = {};
      for (const n of [
        "student",
        "headman",
        "teacher",
        "coordinator",
        "other",
      ]) {
        const r = await fetch(base + "login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: n + "@example.org", password }),
        });
        assert.equal(r.status, 200);
        cookies[n] = r.headers.get("set-cookie").split(";")[0];
      }
      const request = async (role, path, method = "GET", data) => {
        const response = await fetch(base + path, {
          method,
          headers: {
            cookie: cookies[role] || "",
            "Content-Type": "application/json",
          },
          body: data === undefined ? undefined : JSON.stringify(data),
        });
        const result = await response.json();
        return { status: response.status, ...result, data: result };
      };
      let session, homework, debt, retake, project, position;
      await t.test(
        "teacher creates teaching objects, student cannot mutate",
        async () => {
          const r = await request("teacher", "sessions", "POST", {
            offering_id: 1,
            title: "JOIN",
            starts_at: "2026-11-03T09:00:00+03:00",
            room: "A1",
          });
          assert.equal(r.status, 200);
          session = r.id;
          const h = await request("teacher", "homework", "POST", {
            session_id: session,
            title: "Task",
            description: "ER model",
            due_at: "2026-12-01T12:00:00Z",
          });
          assert.equal(h.status, 200);
          homework = h.id;
          assert.equal(
            (
              await request("student", "sessions", "POST", {
                offering_id: 1,
                title: "bad",
                starts_at: "2026-11-03",
                room: "A",
              })
            ).status,
            403,
          );
          assert.equal(
            (await request("other", `homework/${homework}/done`, "POST", {}))
              .status,
            404,
          );
          assert.equal((await request("other", "sessions")).data.length, 0);
        },
      );
      await t.test(
        "headman roster, audit and membership boundaries",
        async () => {
          assert.equal(
            (await request("student", `sessions/${session}/roster`)).status,
            403,
          );
          assert.equal(
            (
              await request(
                "headman",
                `sessions/${session}/attendance`,
                "PUT",
                { student_id: 5, status: "present" },
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await request(
                "headman",
                `sessions/${session}/attendance`,
                "PUT",
                { student_id: 1, status: "present" },
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await request(
                "headman",
                `sessions/${session}/attendance`,
                "PUT",
                { student_id: 1, status: "absent" },
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await request(
                "teacher",
                `sessions/${session}/attendance`,
                "PUT",
                { student_id: 1, status: "late", reason: "Corrected" },
              )
            ).status,
            200,
          );
          assert.equal(
            (await request("teacher", `sessions/${session}/roster`)).history
              .length,
            2,
          );
        },
      );
      await t.test(
        "moving a session preserves homework and attendance; cancellation stops editing",
        async () => {
          assert.equal(
            (
              await request("teacher", `sessions/${session}`, "PATCH", {
                room: "A2",
              })
            ).status,
            200,
          );
          assert.equal(
            (await request("student", "homework")).data[0].id,
            homework,
          );
          assert.equal(
            (await request("student", "attendance")).data[0].status,
            "late",
          );
          await request("teacher", `sessions/${session}`, "PATCH", {
            cancelled: true,
          });
          assert.equal(
            (
              await request(
                "headman",
                `sessions/${session}/attendance`,
                "PUT",
                { student_id: 1, status: "present" },
              )
            ).status,
            409,
          );
          await request("teacher", `sessions/${session}`, "PATCH", {
            cancelled: false,
          });
        },
      );
      await t.test(
        "XLSX matches marks and includes three sheets and audit",
        async () => {
          const r = await fetch(
            base + `offerings/1/attendance.xlsx?from=2026-11-01&to=2026-11-30`,
            { headers: { cookie: cookies.headman } },
          );
          assert.equal(r.status, 200);
          const b = new ExcelJS.Workbook();
          await b.xlsx.load(Buffer.from(await r.arrayBuffer()));
          assert.deepEqual(
            b.worksheets.map((x) => x.name),
            ["Посещаемость", "Сводка", "Сведения"],
          );
          const data = b.worksheets[0].getSheetValues();
          assert.ok(data.some((row) => row && row.includes("О")));
          assert.equal(
            (await db.query("SELECT count(*)::int n FROM attendance_exports"))
              .rows[0].n,
            1,
          );
        },
      );
      await t.test(
        "unmarking preserves audit and expired headman assignments deny access",
        async () => {
          assert.equal(
            (
              await request(
                "headman",
                `sessions/${session}/attendance`,
                "PUT",
                {
                  student_id: 1,
                  status: "unmarked",
                  reason: "Reset incorrect mark",
                },
              )
            ).status,
            200,
          );
          assert.equal((await request("student", "attendance")).data.length, 0);
          assert.equal(
            (await request("headman", `sessions/${session}/roster`)).history[0]
              .status,
            "unmarked",
          );
          await db.query("UPDATE headman_assignments SET ends_on='2026-10-31'");
          assert.equal(
            (await request("headman", `sessions/${session}/roster`)).status,
            403,
          );
          await db.query("UPDATE headman_assignments SET ends_on=NULL");
        },
      );
      await t.test(
        "debts require an explicit teacher action and retake capacity is atomic",
        async () => {
          assert.equal((await request("student", "debts")).data.length, 0);
          const d = await request("teacher", "debts", "POST", {
            offering_id: 1,
            student_id: 1,
            reason: "Exam",
            source: "Teacher record",
          });
          assert.equal(d.status, 200);
          debt = d.id;
          const d2 = await request("teacher", "debts", "POST", {
            offering_id: 1,
            student_id: 2,
            reason: "Exam",
            source: "Teacher record",
          });
          const r = await request("teacher", "retakes", "POST", {
            offering_id: 1,
            starts_at: "2099-01-01T10:00:00Z",
            room: "A",
            capacity: 1,
          });
          assert.equal(r.status, 200);
          retake = r.id;
          const requests = await Promise.all([
            request("student", `retakes/${retake}/register`, "POST", {
              debt_id: debt,
            }),
            request("headman", `retakes/${retake}/register`, "POST", {
              debt_id: d2.id,
            }),
          ]);
          assert.deepEqual(requests.map((x) => x.status).sort(), [200, 409]);
          assert.equal((await request("other", "debts")).data.length, 0);
          const winner = (
            await db.query("SELECT debt_id FROM retake_registrations")
          ).rows[0].debt_id;
          assert.equal(
            (
              await request("teacher", `retakes/${retake}/result`, "POST", {
                debt_id: winner,
                result: "passed",
                note: "Exam passed",
              })
            ).status,
            200,
          );
          assert.equal(
            (await db.query("SELECT closed FROM debts WHERE id=$1", [winner]))
              .rows[0].closed,
            true,
          );
        },
      );
      await t.test(
        "concurrent project decisions cannot exceed the last place",
        async () => {
          project = (
            await request("teacher", "projects", "POST", {
              title: "Portal",
              description: "Build a portal",
            })
          ).id;
          position = (
            await request("teacher", `projects/${project}/roles`, "POST", {
              title: "Frontend",
              skills: "React",
              capacity: 1,
            })
          ).id;
          await request("student", `roles/${position}/apply`, "POST", {
            message: "Hello",
          });
          await request("headman", `roles/${position}/apply`, "POST", {
            message: "Hello",
          });
          const list = (await request("teacher", "applications")).data;
          assert.equal(
            (
              await request(
                "other",
                `applications/${list[0].id}/accept`,
                "POST",
                {},
              )
            ).status,
            404,
          );
          const results = await Promise.all(
            list.map((x) =>
              request("teacher", `applications/${x.id}/accept`, "POST", {}),
            ),
          );
          assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int n FROM project_members WHERE project_id=$1",
                [project],
              )
            ).rows[0].n,
            1,
          );
        },
      );
      await t.test(
        "materials accept only web links and preserve versions",
        async () => {
          assert.equal(
            (
              await request("teacher", "materials", "POST", {
                offering_id: 1,
                title: "Bad",
                url: "javascript:alert(1)",
              })
            ).status,
            400,
          );
          const m = await request("teacher", "materials", "POST", {
            offering_id: 1,
            title: "SQL",
            url: "https://example.org/v1",
          });
          assert.equal(
            (
              await request("teacher", `materials/${m.id}`, "PATCH", {
                title: "SQL v2",
                url: "https://example.org/v2",
              })
            ).version,
            2,
          );
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int n FROM material_history WHERE material_id=$1",
                [m.id],
              )
            ).rows[0].n,
            2,
          );
          assert.equal((await request("other", "materials")).data.length, 0);
        },
      );
      await t.test(
        "unpublished schedule is invisible and publication is idempotent",
        async () => {
          const entries = [{ title: "Sample" }];
          await db.query(
            "INSERT INTO schedule_imports(checksum,entries,source_url,created_by) VALUES($1,$2,$3,4)",
            ["testhash", JSON.stringify(entries), "https://example.org"],
          );
          const s = (await db.query("SELECT id FROM schedule_imports")).rows[0];
          assert.equal(
            (await request("student", "schedule")).entries.length,
            0,
          );
          assert.equal(
            (await request("student", `schedule/${s.id}/publish`, "POST", {}))
              .status,
            403,
          );
          assert.equal(
            (
              await request(
                "coordinator",
                `schedule/${s.id}/publish`,
                "POST",
                {},
              )
            ).status,
            200,
          );
          assert.equal(
            (await request("student", "schedule")).entries[0].title,
            "Sample",
          );
          assert.equal(
            (
              await request(
                "coordinator",
                `schedule/${s.id}/publish`,
                "POST",
                {},
              )
            ).unchanged,
            true,
          );
        },
      );
    } finally {
      if (child) {
        child.kill("SIGTERM");
        await new Promise((resolve) => child.once("exit", resolve));
      }
      await db.end();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  },
);
