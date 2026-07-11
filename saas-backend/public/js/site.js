const menuButton = document.getElementById("menuButton");
const mobileNav = document.getElementById("mobileNav");
const inquiryForm = document.getElementById("inquiryForm");
const inquirySubmit = document.getElementById("inquirySubmit");
const inquiryStatus = document.getElementById("inquiryStatus");

document.getElementById("year").textContent = new Date().getFullYear();

menuButton.addEventListener("click", () => {
  const open = mobileNav.hidden;
  mobileNav.hidden = !open;
  menuButton.setAttribute("aria-expanded", String(open));
});
mobileNav.addEventListener("click", (event) => {
  if (event.target.closest("a")) {
    mobileNav.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  }
});

inquiryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  inquirySubmit.disabled = true;
  inquiryStatus.textContent = "Sending your enquiry...";
  const values = Object.fromEntries(new FormData(inquiryForm).entries());
  try {
    const response = await fetch("/inquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The enquiry could not be sent.");
    inquiryStatus.textContent = data.message;
    inquiryForm.reset();
    inquiryForm.outletCount.value = "1";
  } catch (error) {
    inquiryStatus.textContent = error.message;
  } finally {
    inquirySubmit.disabled = false;
  }
});
