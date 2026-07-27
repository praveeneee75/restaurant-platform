const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "saas-backend/public/css/app.css"), "utf8");
const html = fs.readFileSync(path.join(root, "saas-backend/public/admin.html"), "utf8");
const js = fs.readFileSync(path.join(root, "saas-backend/public/js/admin.js"), "utf8");

const checks = [
  [html.includes('id="tenantTable"'), "restaurant administration table exists"],
  [(html.match(/<th>/g) || []).length >= 9 && html.includes("<th>Revenue</th><th>Action</th>"), "important restaurant columns remain visible"],
  [css.includes("#tenantTable {") && css.includes("min-width: 0") && css.includes("table-layout: auto"), "restaurant table fits its container without a forced wide canvas"],
  [!css.includes("min-width: 2110px"), "restaurant table does not force horizontal scrolling"],
  [js.includes('className = "tenant-editor-row"') && js.includes("View details") && js.includes("Hide details"), "remaining restaurant fields use one expandable details row"],
  [js.includes('colspan="9"') && js.includes("Notification email") && js.includes("Mobile POS URL"), "expanded view retains all editable restaurant fields"],
  [css.includes(".tenant-extra-details") && css.includes(".tenant-editor-row[hidden]"), "expanded details are styled and hidden until requested"],
  [css.includes("@media (max-width: 1180px)") && css.includes(".tenant-summary-row td::before"), "restaurant rows become labelled cards at narrow widths"],
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
