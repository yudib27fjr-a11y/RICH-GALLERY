const q = new URLSearchParams(location.search);
const server = q.get("u") || "";
document.getElementById("alamat").textContent = server || "server";
document.getElementById("detail").textContent = q.get("e") || "";
document.getElementById("ulang").onclick = () => window.RGNative && window.RGNative.setMode("online", server);
document.getElementById("offline").onclick = () => window.RGNative && window.RGNative.setMode("offline", "");
