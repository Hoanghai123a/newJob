const sqlite = require("node:sqlite");
const db = new sqlite.DatabaseSync("D:/Extract/pocketbase/pb_data/data.db");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
tables.forEach((t) => console.log(t.name));
db.close();
