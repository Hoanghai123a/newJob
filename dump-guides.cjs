const sqlite = require("node:sqlite");
const db = new sqlite.DatabaseSync("D:/Extract/pocketbase/pb_data/data.db");

// Test mojibake detection on guides table
const rows = db.prepare("SELECT id, title, content FROM guides").all();
console.log("Guides rows:", rows.length);
for (const r of rows) {
  console.log("---");
  console.log("ID:", r.id);
  console.log("Title:", r.title);
  console.log("Content:", r.content);
}
db.close();
