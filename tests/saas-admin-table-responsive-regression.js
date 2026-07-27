const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "saas-backend/public/css/app.css"), "utf8");
const html = fs.readFileSync(path.join(root, "saas-backend/public/admin.html"), "utf8");

const checks = [
  [html.includes('id="tenantTable"'), "restaurant administration table exists"],
  [css.includes("#tenantTable {") && css.includes("min-width: 2110px") && css.includes("table-layout: fixed"), "restaurant table minimum matches its usable content widths"],
  [css.includes("#tenantTable th {") && css.includes("white-space: nowrap"), "restaurant table headings never collapse letter by letter"],
  [css.includes("#tenantTable td:nth-child(11) {\n  overflow-wrap: normal;\n  white-space: nowrap;"), "restaurant identifiers and revenue never break character by character"],
  [css.includes("#tenantTable input,") && css.includes("max-width: 100%") && css.includes("min-width: 0"), "restaurant table controls remain within assigned columns"],
  [css.includes("#tenantTable th:nth-child(12)") && css.includes("width: 110px"), "restaurant table action column has a deliberate width"],
];

let failed = 0;
for (const [ok, description] of checks) {
  if (ok) console.log(`PASS: ${description}`);
  else {
    failed += 1;
    console.error(`FAIL: ${description}`);
  }
}

if (failed) process.exit(1);
