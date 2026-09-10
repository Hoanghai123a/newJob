const sqlite = require("node:sqlite");
const db = new sqlite.DatabaseSync("D:/Extract/pocketbase/pb_data/data.db");
const data = db.prepare("SELECT id, type, content, status FROM complaints").all();
console.log("complaints:", data.length);
data.forEach((r) => console.log(JSON.stringify(r)));
db.close();
