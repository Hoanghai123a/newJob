const fs = require("fs");
const path = process.argv[2];
const text = fs.readFileSync(path, "utf8");
const lines = text.split(/\r?\n/);
const bad = [];
for (let i = 0; i < lines.length; i++) {
  // Match mojibake: Ã, Ä, Å, Æ, Ç, È etc followed by 0x80-0xBF chars
  if (/[\u00c0-\u00c5\u00c7-\u00d6\u00d8-\u00df][\u0080-\u00bf]/.test(lines[i])) {
    bad.push({ line: i + 1, content: lines[i] });
  }
}
console.log("Total bad lines: " + bad.length);
bad.forEach((b) => {
  console.log(b.line + ": " + b.content.substring(0, 200));
});
