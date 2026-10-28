let csrf = "";
export const setCsrf = (value) => {
  csrf = value || "";
};
export async function api(path, { method = "GET", body, signal } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = Error(data.error || "تعذر الاتصال بالخادم.");
    error.status = response.status;
    throw error;
  }
  if (data.csrf) setCsrf(data.csrf);
  return data;
}
export async function downloadCSV(day) {
  const r = await fetch(`/api/admin/export?day=${day}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!r.ok) {
    const e = await r.json();
    throw Error(e.error);
  }
  saveBlob(await r.blob(), `attendance-${day}.csv`);
}
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
