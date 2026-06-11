const params = new URLSearchParams(window.location.search);
const restaurantId = params.get("restaurantId") || localStorage.getItem("restaurantId");
const tableId = params.get("tableId") || "";
const orderId = params.get("orderId") || "";

const money = (value) => Number(value || 0).toFixed(2);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

async function refreshDisplay() {
  if (!restaurantId) {
    displayStatus.textContent = "restaurantId required";
    return;
  }
  const query = new URLSearchParams({ restaurantId });
  if (tableId) query.set("tableId", tableId);
  if (orderId) query.set("orderId", orderId);
  const data = await fetch(`/customer-display/current?${query.toString()}`).then((res) => res.json()).catch(() => ({ success: false, message: "Display offline" }));
  if (!data.success || !data.order) {
    displayStatus.textContent = data.message || "Waiting for order...";
    displayItems.innerHTML = "";
    displaySubtotal.textContent = "0.00";
    displayDiscount.textContent = "0.00";
    displayTax.textContent = "0.00";
    displayGrandTotal.textContent = "0.00";
    return;
  }
  displayStatus.textContent = data.order.payment_status === "PAID" ? "Payment successful" : `Order #${data.order.id}`;
  displayItems.innerHTML = data.items.map((item) => `
    <tr>
      <td>${esc(item.name)}</td>
      <td>${item.quantity}</td>
      <td>${money(item.price)}</td>
      <td>${money(item.line_total)}</td>
    </tr>
  `).join("");
  displaySubtotal.textContent = money(data.totals.subtotal);
  displayDiscount.textContent = money(data.totals.discount);
  displayTax.textContent = money(data.totals.tax);
  displayGrandTotal.textContent = money(data.totals.grandTotal);
}

refreshDisplay();
setInterval(refreshDisplay, 3000);
