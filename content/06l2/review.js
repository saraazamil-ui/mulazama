const expected =
  "6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f";
const status = document.getElementById("status"),
  select = document.getElementById("surah"),
  list = document.getElementById("ayahs");
try {
  const response = await fetch("./tanzil-uthmani-1.1.txt");
  if (!response.ok) throw Error("تعذر تحميل ملف المصدر.");
  const bytes = await response.arrayBuffer(),
    digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  if (digest !== expected) throw Error("اختلفت بصمة المصدر؛ لم يعرض النص.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    rows = [];
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line || line.startsWith("#")) continue;
    const match = /^([1-9][0-9]*)\|([1-9][0-9]*)\|(.+)$/.exec(line);
    if (!match) throw Error("تنسيق المصدر غير صالح.");
    rows.push({
      surah: Number(match[1]),
      ayah: Number(match[2]),
      text: match[3],
    });
  }
  for (let n = 1; n <= 114; n++) {
    const option = document.createElement("option");
    option.value = String(n);
    option.textContent = String(n);
    select.append(option);
  }
  const render = () => {
    list.replaceChildren();
    for (const row of rows.filter((r) => r.surah === Number(select.value))) {
      const li = document.createElement("li"),
        label = document.createElement("small"),
        ayah = document.createElement("p");
      li.dataset.key = `${row.surah}:${row.ayah}`;
      label.textContent = `مرجع ${row.surah}:${row.ayah}`;
      ayah.className = "ayah";
      ayah.textContent = row.text;
      li.append(label, ayah);
      list.append(li);
    }
  };
  document.getElementById("copyright").textContent = text
    .split("\n")
    .filter((line) => line.startsWith("#"))
    .join("\n");
  select.addEventListener("change", render);
  select.disabled = false;
  render();
  status.textContent =
    "تطابقت بصمة الملف. العرض للمقابلة البشرية فقط؛ لا اعتماد علمي أو تشغيلي.";
  document.documentElement.dataset.sourceHash = digest;
} catch (error) {
  select.disabled = true;
  list.replaceChildren();
  status.setAttribute("role", "alert");
  status.textContent =
    error instanceof Error ? error.message : "تعذر التحقق من النص.";
}
