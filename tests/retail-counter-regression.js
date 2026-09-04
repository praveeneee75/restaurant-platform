const http = require("http"),
  fs = require("fs"),
  path = require("path");
const root = path.resolve(__dirname, ".."),
  dataDir = path.join(root, ".codex-retail-counter-test");
fs.rmSync(dataDir, { recursive: true, force: true });
process.env.POS_DATA_DIR = dataDir;
process.env.PORT = process.env.RETAIL_TEST_PORT || "3491";
process.env.POS_HEARTBEAT_DISABLED = "1";
const port = Number(process.env.PORT),
  restaurantId = "RETAILTEST",
  posRoot = path.join(root, "pos-app");
const { openDatabase } = require(path.join(posRoot, "backend/db/database"));
const { setupDatabase } = require(
  path.join(posRoot, "backend/services/dbSetup"),
);
const { seedWhitelabelDemoData } = require(
  path.join(posRoot, "backend/services/whitelabelDemoSeed"),
);
setupDatabase(restaurantId);
let db = openDatabase(restaurantId);
seedWhitelabelDemoData(db, { restaurantId, force: true });
db.prepare(
  "UPDATE system_config SET value='0' WHERE key='require_open_register_for_cash_payment'",
).run();
db.prepare(
  "UPDATE system_config SET value='0' WHERE key='service_charge_enabled'",
).run();
db.close();
require(path.join(posRoot, "backend/server"));
const owner = { id: 1, role: "OWNER", name: "Retail regression" };
function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null,
      req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: route,
          method,
          timeout: 15000,
          headers: payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {},
        },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () =>
            resolve({ status: res.statusCode, data: JSON.parse(text) }),
          );
        },
      );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (payload) req.write(payload);
    req.end();
  });
}
async function ok(method, route, body) {
  const r = await request(method, route, body);
  if (r.status >= 400 || r.data.success === false)
    throw new Error(`${route}: ${r.data.message || r.status}`);
  return r.data;
}
async function main() {
  await new Promise((r) => setTimeout(r, 800));
  let denied = await request(
    "GET",
    `/retail/bootstrap?restaurantId=${restaurantId}&role=OWNER`,
  );
  if (denied.status !== 403)
    throw new Error("disabled Retail Counter was accessible");
  await ok("POST", "/settings/update", {
    restaurantId,
    actor: owner,
    settings: {
      retail_counter_enabled: "1",
      retail_allow_negative_stock: "0",
      retail_low_stock_warning: "1",
    },
  });
  const admin = await ok(
      "GET",
      `/admin/bootstrap?restaurantId=${restaurantId}&includeInactive=true`,
    ),
    base = admin.items[0];
  await ok("POST", "/admin/items/save", {
    restaurantId,
    actor: owner,
    id: base.id,
    name: base.name,
    categoryId: base.category_id,
    price: 100,
    alphaShortCode: base.alpha_short_code || "",
    numericShortCode: "",
    taxMode: "INCLUSIVE",
    isVeg: true,
    allowDineIn: true,
    allowParcel: true,
    allowPartyOrder: true,
    allowRetail: true,
    barcode: "8901234567890",
    retailCost: 60,
    retailStock: 10,
    retailReorderLevel: 2,
    active: true,
    onlineEnabled: true,
  });
  const duplicate = admin.items[1];
  const duplicateResult = await request("POST", "/admin/items/save", {
    restaurantId,
    actor: owner,
    id: duplicate.id,
    name: duplicate.name,
    categoryId: duplicate.category_id,
    price: duplicate.price,
    allowRetail: true,
    barcode: "8901234567890",
    retailCost: 1,
    retailStock: 1,
    retailReorderLevel: 0,
    active: true,
  });
  if (
    duplicateResult.status < 400 ||
    !/already assigned/i.test(duplicateResult.data.message)
  )
    throw new Error("duplicate barcode was accepted");
  const boot = await ok(
    "GET",
    `/retail/bootstrap?restaurantId=${restaurantId}&role=OWNER`,
  );
  const retailRoleBoot = await ok(
    "GET",
    `/retail/bootstrap?restaurantId=${restaurantId}&role=RETAIL`,
  );
  if (!retailRoleBoot.items.length) throw new Error("Retail role could not view the retail catalogue");
  const item = boot.items.find((i) => i.barcode === "8901234567890");
  if (!item || Number(item.retail_stock) !== 10)
    throw new Error("retail bootstrap did not expose configured product");
  const shortage = await request("POST", "/retail/orders/prepare", {
    restaurantId,
    actor: owner,
    items: [{ itemId: item.id, quantity: 11 }],
  });
  if (shortage.status < 400 || !/only 10/i.test(shortage.data.message))
    throw new Error("insufficient stock was accepted");
  db = openDatabase(restaurantId);
  const retailRole = db.prepare("SELECT id FROM roles WHERE name='RETAIL'").get();
  const retailView = db.prepare("SELECT id FROM permissions WHERE code='retail.view'").get();
  db.prepare("UPDATE role_permissions SET allowed=0 WHERE role_id=? AND permission_id=?").run(retailRole.id, retailView.id);
  db.close();
  const permissionDenied = await request("GET", `/retail/bootstrap?restaurantId=${restaurantId}&role=RETAIL`);
  if (permissionDenied.status !== 403) throw new Error("Retail counter was visible after retail.sell was disabled");
  db = openDatabase(restaurantId);
  db.prepare("UPDATE role_permissions SET allowed=1 WHERE role_id=? AND permission_id=?").run(retailRole.id, retailView.id);
  db.close();
  await ok("POST", "/retail/orders/prepare", {
    restaurantId,
    actor: { id: 99, role: "RETAIL" },
    items: [{ itemId: item.id, quantity: 1 }],
  });
  const prepared = await ok("POST", "/retail/orders/prepare", {
    restaurantId,
    actor: { id: 99, role: "RETAIL", name: "Retail user" },
    items: [{ itemId: item.id, quantity: 3 }],
  });
  const settled = await ok("POST", "/orders/settle", {
    restaurantId,
    actor: { id: 99, role: "RETAIL", name: "Retail user" },
    orderId: prepared.orderId,
    payments: [{ method: "CARD", amount: prepared.payable }],
    redeemPoints: 0,
    isInvoice: true,
    printBill: false,
  });
  if (!settled.invoiceNo || Number(settled.payable) !== 300)
    throw new Error("retail invoice settlement failed");
  db = openDatabase(restaurantId);
  const order = db
      .prepare(
        "SELECT order_type,payment_status,invoice_no FROM orders WHERE id=?",
      )
      .get(prepared.orderId),
    stock = db
      .prepare("SELECT retail_stock FROM items WHERE id=?")
      .get(item.id),
    moves = db
      .prepare(
        "SELECT COUNT(*) count,SUM(quantity) quantity FROM retail_stock_movements WHERE order_id=? AND movement_type='SALE'",
      )
      .get(prepared.orderId),
    kds = db
      .prepare("SELECT status,archived_at FROM kots WHERE order_id=?")
      .get(prepared.orderId),
    kitchenJobs = db
      .prepare(
        "SELECT COUNT(*) count FROM print_jobs WHERE ref_id=? AND type='KOT'",
      )
      .get(prepared.orderId);
  db.close();
  if (
    order.order_type !== "RETAIL" ||
    order.payment_status !== "PAID" ||
    !order.invoice_no
  )
    throw new Error("retail order ledger is invalid");
  if (
    Number(stock.retail_stock) !== 7 ||
    Number(moves.count) !== 1 ||
    Number(moves.quantity) !== -3
  )
    throw new Error("retail stock was not deducted exactly once");
  if (!kds.archived_at || Number(kitchenJobs.count) !== 0)
    throw new Error("retail sale leaked into kitchen operations");
  const today = new Date().toISOString().slice(0, 10),
    report = await ok(
      "GET",
      `/reports/operational-summary?restaurantId=${restaurantId}&role=OWNER&type=sales&fromDate=${today}&toDate=${today}`,
    );
  if (
    !report.rows.some(
      (r) => r.order_type === "RETAIL" && Number(r.total_amount) === 300,
    )
  )
    throw new Error("retail sale missing from reports");
  const normal = await ok("GET", `/pos/bootstrap?restaurantId=${restaurantId}`);
  if (!normal.tables.length || !normal.items.length)
    throw new Error("existing POS bootstrap regressed");
  console.log(
    "Retail Counter regression passed: feature gate, barcode uniqueness, manual catalog data, stock validation, invoice settlement, exact-once stock deduction, KDS isolation, reporting and existing POS bootstrap.",
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
