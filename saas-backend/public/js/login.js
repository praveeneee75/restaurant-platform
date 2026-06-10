async function login() {

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  if (!email || !password) {
    document.getElementById("msg").innerText = "Enter email and password";
    return;
  }

  try {

    const res = await fetch("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        password
      })
    });

    const data = await res.json();

    if (!data.success) {
      document.getElementById("msg").innerText = data.message;
      return;
    }

    // Save JWT token
    localStorage.setItem("adminToken", data.token);

    // Redirect to SaaS admin dashboard
    window.location.href = "/admin.html";

  } catch (err) {

    console.error(err);
    document.getElementById("msg").innerText = "Server error";

  }
}