export async function sendAuthEmailCode(email: string, purpose: "register" | "login" | "reset_password" | "change_password") {
  const res = await fetch("/api/auth/send-email-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, purpose }),
  });
  if (!res.ok) {
    const { readApiError } = await import("@/lib/errors");
    throw await readApiError(res);
  }
  return res.json();
}
