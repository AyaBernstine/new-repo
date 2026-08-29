const STORAGE_KEYS = {
  apiKey: "ct_api_key",
  entries: "ct_entries",
  goal: "ct_goal",
};

const MODEL = "gemini-3.6-flash";
const SYSTEM_PROMPT = `You are a nutrition estimation assistant. You will be shown a photo of food \
and/or a text description of a meal. Identify the food(s) and estimate the total calories and \
macros for the portion shown/described.

Always respond with ONLY a JSON object, no other text, in exactly this shape:
{
  "food_name": "short name of the food/meal",
  "portion_description": "your estimate of the portion size, e.g. '1 medium bowl, ~350g'",
  "calories": <integer, best-guess total calories>,
  "protein_g": <number, grams of protein>,
  "carbs_g": <number, grams of carbs>,
  "fat_g": <number, grams of fat>,
  "confidence_note": "one short sentence on what could make this estimate off, e.g. hidden oil/sauce, unclear portion size"
}

If you truly cannot identify any food from the input, set food_name to "Unknown" and calories to 0, \
and explain why in confidence_note.`;

// ---------- storage helpers ----------

function getApiKey() {
  return localStorage.getItem(STORAGE_KEYS.apiKey) || "";
}

function setApiKey(key) {
  if (key) localStorage.setItem(STORAGE_KEYS.apiKey, key);
  else localStorage.removeItem(STORAGE_KEYS.apiKey);
}

function loadAllEntries() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.entries) || "[]");
  } catch {
    return [];
  }
}

function saveAllEntries(entries) {
  try {
    localStorage.setItem(STORAGE_KEYS.entries, JSON.stringify(entries));
  } catch (err) {
    // likely quota exceeded — drop stored photos from the oldest entries and retry once
    const stripped = entries.map((e, i) =>
      i < entries.length - 20 ? { ...e, imageDataUrl: null } : e
    );
    localStorage.setItem(STORAGE_KEYS.entries, JSON.stringify(stripped));
  }
}

function getGoal() {
  const raw = localStorage.getItem(STORAGE_KEYS.goal);
  return raw ? parseInt(raw, 10) : null;
}

function setGoal(value) {
  if (value === null || value === undefined) localStorage.removeItem(STORAGE_KEYS.goal);
  else localStorage.setItem(STORAGE_KEYS.goal, String(value));
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toISODateLocal(d) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function todayISO() {
  return toISODateLocal(new Date());
}

// ---------- image handling ----------

function resizeImageFile(file, maxDim = 800, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.onload = () => {
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Could not decode image file."));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- Gemini API ----------

async function analyzeMeal(imageDataUrl, description) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No API key set. Tap the ⚙️ icon to add one.");

  const parts = [];
  if (imageDataUrl) {
    const base64 = imageDataUrl.split(",")[1];
    parts.push({ inline_data: { mime_type: "image/jpeg", data: base64 } });
  }

  const textParts = [];
  if (description) textParts.push(`User's description of the meal: ${description}`);
  if (!imageDataUrl) textParts.push("No photo was provided, so estimate based only on the text description above.");
  if (!textParts.length) textParts.push("Analyze the food shown in the photo.");
  parts.push({ text: textParts.join("\n") });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Gemini API request failed (${res.status})`);
  }

  const rawText = (data.candidates?.[0]?.content?.parts || [])
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();

  try {
    return JSON.parse(rawText);
  } catch {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start !== -1 && end !== -1) return JSON.parse(rawText.slice(start, end + 1));
    throw new Error("Could not parse Gemini's response as JSON.");
  }
}

// ---------- DOM refs ----------

const datePicker = document.getElementById("date-picker");
const entryForm = document.getElementById("entry-form");
const imageInput = document.getElementById("image-input");
const imagePreview = document.getElementById("image-preview");
const fileLabelText = document.getElementById("file-label-text");
const descriptionInput = document.getElementById("description-input");
const submitBtn = document.getElementById("submit-btn");
const statusMessage = document.getElementById("status-message");
const totalsEl = document.getElementById("totals");
const entriesListEl = document.getElementById("entries-list");
const goalProgressEl = document.getElementById("goal-progress");
const editGoalBtn = document.getElementById("edit-goal-btn");
const periodButtons = document.querySelectorAll(".period-btn");
const progressSummaryEl = document.getElementById("progress-summary");
const progressDaysEl = document.getElementById("progress-days");
const settingsBtn = document.getElementById("settings-btn");
const setupCard = document.getElementById("setup-card");
const apiKeyInput = document.getElementById("api-key-input");
const saveKeyBtn = document.getElementById("save-key-btn");
const setupStatus = document.getElementById("setup-status");

let currentPeriod = "week";
let resizedImageDataUrl = null;

datePicker.value = todayISO();

// ---------- setup / settings ----------

function refreshSetupVisibility() {
  setupCard.hidden = !!getApiKey();
}

settingsBtn.addEventListener("click", () => {
  apiKeyInput.value = getApiKey();
  setupCard.hidden = false;
  setupCard.scrollIntoView({ behavior: "smooth", block: "start" });
});

saveKeyBtn.addEventListener("click", () => {
  const value = apiKeyInput.value.trim();
  setApiKey(value || null);
  setupStatus.textContent = value ? "Saved." : "Key cleared.";
  setupStatus.classList.remove("error");
  if (value) setTimeout(refreshSetupVisibility, 600);
});

// ---------- add meal form ----------

imageInput.addEventListener("change", async () => {
  const file = imageInput.files[0];
  if (!file) {
    imagePreview.hidden = true;
    resizedImageDataUrl = null;
    fileLabelText.textContent = "Add a photo (optional)";
    return;
  }
  fileLabelText.textContent = file.name;
  try {
    resizedImageDataUrl = await resizeImageFile(file);
    imagePreview.src = resizedImageDataUrl;
    imagePreview.hidden = false;
  } catch (err) {
    setStatus(err.message, true);
  }
});

datePicker.addEventListener("change", () => {
  loadDay();
  loadProgress();
});

entryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const description = descriptionInput.value.trim();

  if (!resizedImageDataUrl && !description) {
    setStatus("Add a photo or a description first.", true);
    return;
  }
  if (!getApiKey()) {
    setStatus("Add your Gemini API key first (tap ⚙️).", true);
    setupCard.hidden = false;
    return;
  }

  submitBtn.disabled = true;
  setStatus("Analyzing meal…");

  try {
    const estimate = await analyzeMeal(resizedImageDataUrl, description);
    const entries = loadAllEntries();
    entries.push({
      id: uid(),
      date: datePicker.value,
      createdAt: new Date().toISOString(),
      imageDataUrl: resizedImageDataUrl,
      userDescription: description || null,
      foodName: estimate.food_name,
      portionDescription: estimate.portion_description,
      calories: estimate.calories,
      proteinG: estimate.protein_g,
      carbsG: estimate.carbs_g,
      fatG: estimate.fat_g,
      confidenceNote: estimate.confidence_note,
      edited: false,
    });
    saveAllEntries(entries);

    entryForm.reset();
    resizedImageDataUrl = null;
    imagePreview.hidden = true;
    fileLabelText.textContent = "Add a photo (optional)";
    setStatus("Added!");
    loadDay();
    loadProgress();
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    submitBtn.disabled = false;
  }
});

function setStatus(msg, isError = false) {
  statusMessage.textContent = msg;
  statusMessage.classList.toggle("error", isError);
}

// ---------- goal ----------

editGoalBtn.addEventListener("click", () => {
  const current = getGoal();
  const value = prompt("Daily calorie goal (leave blank to clear):", current ?? "");
  if (value === null) return;
  const trimmed = value.trim();
  const goal = trimmed === "" ? null : parseInt(trimmed, 10);
  if (trimmed !== "" && Number.isNaN(goal)) return;
  setGoal(goal);
  refreshGoalButton();
  loadDay();
  loadProgress();
});

function refreshGoalButton() {
  const goal = getGoal();
  editGoalBtn.textContent = goal ? `Goal: ${goal} kcal` : "Set goal";
}

function renderGoalProgress(caloriesToday) {
  const goal = getGoal();
  if (!goal) {
    goalProgressEl.innerHTML = "";
    return;
  }
  const pct = Math.min(100, Math.round((caloriesToday / goal) * 100));
  const over = caloriesToday > goal;
  const remaining = goal - caloriesToday;
  goalProgressEl.innerHTML = `
    <div class="goal-bar-track">
      <div class="goal-bar-fill ${over ? "over" : ""}" style="width: ${pct}%"></div>
    </div>
    <div class="goal-caption">${
      over
        ? `${Math.abs(remaining)} kcal over your ${goal} kcal goal`
        : `${remaining} kcal remaining of your ${goal} kcal goal`
    }</div>
  `;
}

// ---------- day log ----------

function loadDay() {
  const date = datePicker.value;
  const dayEntries = loadAllEntries()
    .filter((e) => e.date === date)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const totals = {
    calories: dayEntries.reduce((s, e) => s + (e.calories || 0), 0),
    protein_g: round1(dayEntries.reduce((s, e) => s + (e.proteinG || 0), 0)),
    carbs_g: round1(dayEntries.reduce((s, e) => s + (e.carbsG || 0), 0)),
    fat_g: round1(dayEntries.reduce((s, e) => s + (e.fatG || 0), 0)),
  };

  renderTotals(totals);
  renderGoalProgress(totals.calories);
  renderEntries(dayEntries);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function renderTotals(totals) {
  totalsEl.innerHTML = `
    <div class="stat"><div class="value">${totals.calories}</div><div class="label">kcal</div></div>
    <div class="stat"><div class="value">${totals.protein_g}g</div><div class="label">protein</div></div>
    <div class="stat"><div class="value">${totals.carbs_g}g</div><div class="label">carbs</div></div>
    <div class="stat"><div class="value">${totals.fat_g}g</div><div class="label">fat</div></div>
  `;
}

function renderEntries(entries) {
  if (!entries.length) {
    entriesListEl.innerHTML = `<p class="empty-state">Nothing logged for this day yet.</p>`;
    return;
  }

  entriesListEl.innerHTML = entries
    .map((entry) => {
      const img = entry.imageDataUrl ? `<img src="${entry.imageDataUrl}" alt="" />` : "";
      const editedTag = entry.edited ? " (edited)" : "";
      return `
        <div class="entry" data-id="${entry.id}">
          ${img}
          <div class="entry-body">
            <div class="top-row">
              <span class="food-name">${escapeHtml(entry.foodName || "Unknown")}${editedTag}</span>
              <span class="calories">${entry.calories ?? "?"} kcal</span>
            </div>
            ${entry.portionDescription ? `<div class="portion">${escapeHtml(entry.portionDescription)}</div>` : ""}
            <div class="macros">P ${entry.proteinG ?? 0}g · C ${entry.carbsG ?? 0}g · F ${entry.fatG ?? 0}g</div>
            ${entry.userDescription ? `<div class="description">"${escapeHtml(entry.userDescription)}"</div>` : ""}
            <div class="actions">
              <button data-action="edit-calories">Edit calories</button>
              <button data-action="delete">Delete</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

entriesListEl.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button) return;
  const entryEl = e.target.closest(".entry");
  const id = entryEl.dataset.id;

  if (button.dataset.action === "delete") {
    if (!confirm("Delete this entry?")) return;
    saveAllEntries(loadAllEntries().filter((en) => en.id !== id));
    loadDay();
    loadProgress();
  }

  if (button.dataset.action === "edit-calories") {
    const current = entryEl.querySelector(".calories").textContent;
    const value = prompt("New calorie value:", current.replace(/\D/g, ""));
    if (value === null || value.trim() === "") return;
    const calories = parseInt(value, 10);
    if (Number.isNaN(calories)) return;
    const entries = loadAllEntries();
    const idx = entries.findIndex((en) => en.id === id);
    if (idx !== -1) {
      entries[idx].calories = calories;
      entries[idx].edited = true;
      saveAllEntries(entries);
    }
    loadDay();
    loadProgress();
  }
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- progress ----------

periodButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentPeriod = btn.dataset.period;
    periodButtons.forEach((b) => b.classList.toggle("active", b === btn));
    loadProgress();
  });
});

function loadProgress() {
  const numDays = currentPeriod === "week" ? 7 : 30;
  const end = new Date(`${datePicker.value}T00:00:00`);
  const goal = getGoal();
  const all = loadAllEntries();

  const byDate = {};
  for (const e of all) {
    byDate[e.date] = (byDate[e.date] || 0) + (e.calories || 0);
  }

  const days = [];
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const iso = toISODateLocal(d);
    const calories = byDate[iso] || 0;
    days.push({ date: iso, calories, goal, diff: goal !== null ? calories - goal : null });
  }

  const logged = days.filter((d) => d.calories > 0);
  const avgCalories = logged.length
    ? round1(logged.reduce((s, d) => s + d.calories, 0) / logged.length)
    : 0;
  const daysOnTrack = goal !== null ? logged.filter((d) => d.calories <= goal).length : null;

  renderProgress({
    goal,
    days,
    summary: { avg_calories: avgCalories, days_logged: logged.length, days_on_track: daysOnTrack },
  });
}

function renderProgress(data) {
  const { summary, goal, days } = data;
  progressSummaryEl.innerHTML = `
    <div class="progress-summary-row">
      <div class="stat"><div class="value">${summary.avg_calories}</div><div class="label">avg kcal/day logged</div></div>
      <div class="stat"><div class="value">${summary.days_logged}/${days.length}</div><div class="label">days logged</div></div>
      <div class="stat"><div class="value">${
        summary.days_on_track === null ? "—" : `${summary.days_on_track}/${summary.days_logged}`
      }</div><div class="label">days within goal</div></div>
    </div>
  `;

  const maxCalories = Math.max(goal || 0, ...days.map((d) => d.calories), 1);

  progressDaysEl.innerHTML = days
    .map((d) => {
      const label = new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      const pct = d.calories === 0 ? 0 : Math.max(4, (d.calories / maxCalories) * 100);
      const over = goal !== null && d.calories > goal;
      return `
        <div class="progress-day-row">
          <div class="day-label">${label}</div>
          <div class="bar-track">
            <div class="bar-fill ${d.calories === 0 ? "empty" : over ? "over" : ""}" style="width: ${pct}%"></div>
          </div>
          <div class="day-calories">${d.calories || "–"}</div>
        </div>
      `;
    })
    .join("");
}

// ---------- boot ----------

refreshSetupVisibility();
refreshGoalButton();
loadDay();
loadProgress();
