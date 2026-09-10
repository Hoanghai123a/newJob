const sqlite = require("node:sqlite");
const db = new sqlite.DatabaseSync("D:/Extract/pocketbase/pb_data/data.db");

// Find string columns in each table
const tables = [
  "advances",
  "app_settings",
  "attendance",
  "check_attendance_batches",
  "check_attendance_items",
  "check_salary_batches",
  "check_salary_items",
  "complaints",
  "employment_histories",
  "factories",
  "factory_managers",
  "group_chat_messages",
  "guides",
  "recruitment_areas",
  "recruitments",
  "settings",
  "staff_action_logs",
  "transport_contacts",
  "user_delegations",
  "users",
];
for (const t of tables) {
  const cols = db.prepare("PRAGMA table_info(" + t + ")").all();
  const txtCols = cols.filter((c) => /TEXT|VARCHAR/i.test(c.type));
  if (txtCols.length > 0) {
    console.log(t + ":");
    txtCols.forEach((c) => console.log("  " + c.name + " (" + c.type + ")"));
  }
}
db.close();
