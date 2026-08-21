const resp = await fetch("http://127.0.0.1:8290/api/collections/guides/records?perPage=1");
const text = await resp.text();
const data = JSON.parse(text);
console.log("Headers content-type:", resp.headers.get("content-type"));
console.log("Raw bytes len:", new TextEncoder().encode(text).length);
console.log("Title raw:", data.items[0].title);
console.log(
  "Title bytes:",
  Array.from(new TextEncoder().encode(data.items[0].title))
    .map((b) => b.toString(16))
    .join(" "),
);
