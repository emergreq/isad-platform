import pg from 'pg';
const admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();
const target=new URL(process.env.ASSISTANT_DATABASE_URL);
const user=decodeURIComponent(target.username),password=decodeURIComponent(target.password),database=target.pathname.slice(1);
if(user!=='isad_assistant'||database!=='isad_assistant')throw Error('Expected dedicated isad_assistant database and role');
if(!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[user])).rowCount){await admin.query(`CREATE ROLE isad_assistant LOGIN PASSWORD '${password.replaceAll("'","''")}'`);}
else{await admin.query(`ALTER ROLE isad_assistant PASSWORD '${password.replaceAll("'","''")}'`);}
if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount){await admin.query('CREATE DATABASE isad_assistant OWNER isad_assistant');}
console.log('Dedicated assistant role and database ready');await admin.end();
