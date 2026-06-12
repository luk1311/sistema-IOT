const fs = require('fs');
const initSqlJs = require('sql.js');

async function test() {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync('data/iot.sqlite'));
  const stmt = db.prepare('SELECT * FROM devices');
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  console.log(JSON.stringify(rows, null, 2));
}

test();
