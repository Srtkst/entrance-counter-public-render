const CATEGORIES = [
  "未就学児",
  "小学生",
  "中学生",
  "高校生",
  "在校生1年",
  "在校生2年",
  "在校生3,4年",
  "保護者",
  "地域の人",
  "その他"
];

const RECEPTIONS = [
  "A",
  "B",
  "C",
  "D"
];

const receptionSelect = document.getElementById("receptionSelect");
const dateInput = document.getElementById("dateInput");
const totalTitle = document.getElementById("totalTitle");
const totalCount = document.getElementById("totalCount");
//const aTotal = document.getElementById("aTotal");
//const bTotal = document.getElementById("bTotal");
const hqIncludeBox = document.getElementById("hqIncludeBox");
const includeInHQ = document.getElementById("includeInHQ");
const hqIncludeWarning = document.getElementById("hqIncludeWarning");
const hqWarning = document.getElementById("hqWarning");

const hqTotals = document.getElementById("hqTotals");
const categoryGrid = document.getElementById("categoryGrid");
const statusText = document.getElementById("statusText");
const mainView = document.getElementById("mainView");
const historyView = document.getElementById("historyView");
const historyList = document.getElementById("historyList");
const toast = document.getElementById("toast");

function localDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const TODAY = localDateString();
dateInput.value = TODAY;

const savedReception = localStorage.getItem("reception");
if (["A", "B", "C", "D", "HQ"].includes(savedReception)) {
  receptionSelect.value = savedReception;
}

function receptionLabel(value) {
  if (value === "A") return "受付A";
  if (value === "B") return "受付B";
  if (value === "C") return "受付C";
  if (value === "D") return "受付D";
  return "本部";
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2000);
}

async function fetchDay() {
  const response = await fetch(`/api/day?date=${encodeURIComponent(dateInput.value)}`, {
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to load");
  return response.json();
}

function renderCategoryCards(counts, editable) {
  categoryGrid.innerHTML = "";

  for (const category of CATEGORIES) {
    const card = document.createElement("article");
    card.className = "category-card";

    const buttons = editable
      ? `
        <div class="button-row">
          <button class="minus" data-category="${category}" data-amount="-1">−1</button>
          <button class="plus" data-category="${category}" data-amount="1">+1</button>
        </div>`
      : "";

    card.innerHTML = `
      <h3>${category}</h3>
      <strong>${counts[category] ?? 0}</strong>
      ${buttons}
    `;

    categoryGrid.appendChild(card);
  }

  if (editable) {
    categoryGrid.querySelectorAll("[data-category]").forEach(button => {
      button.addEventListener("click", () => {
        changeCount(button.dataset.category, Number(button.dataset.amount));
      });
    });
  }
}

function renderHQReceptionTotals(receptions) {
  hqTotals.innerHTML = "";
  const excluded = [];

  for (const reception of RECEPTIONS) {
    const data = receptions[reception];
    const card = document.createElement("article");

    card.innerHTML = `
      <span>${receptionLabel(reception)}</span>
      <strong>${data.total}</strong>
      <small>人</small>
      <div>${data.includeInHQ ? "集計対象" : "集計対象外"}</div>
    `;

    if (!data.includeInHQ) {

      card.classList.add("excluded-reception");
      excluded.push(receptionLabel(reception));
    }

    hqTotals.appendChild(card);
  }

  if (excluded.length > 0) {
    hqWarning.textContent =
      `※ ${excluded.join("・")} は本部合計に含まれていません。`;
    hqWarning.classList.remove("hidden");
  } else {
    hqWarning.classList.add("hidden");
  }
}

async function render() {
  try {
    const payload = await fetchDay();
    const reception = receptionSelect.value;
    const selectedDate = dateInput.value;
    const isToday = selectedDate === TODAY;
    statusText.textContent =
      `${selectedDate} / ${receptionLabel(reception)}`;

    // =========================
    // 本部
    // =========================

    if (reception === "HQ") {
      totalTitle.textContent = "本部集計 合計";
      totalCount.textContent = payload.hq.total;
      hqIncludeBox.classList.add("hidden");
      hqTotals.classList.remove("hidden");

      renderHQReceptionTotals(payload.receptions);
      renderCategoryCards(payload.hq.combined,false);

      return;
    }

    // =========================
    // 受付A～D
    // =========================

    const data = payload.receptions[reception];
    totalTitle.textContent = `${receptionLabel(reception)} 合計`;
    totalCount.textContent = data.total;
    
    hqTotals.classList.add("hidden");
    hqWarning.classList.add("hidden");
    hqIncludeBox.classList.remove("hidden");

    includeInHQ.checked = data.includeInHQ;
    includeInHQ.disabled = !isToday;

    if (data.includeInHQ) {
      hqIncludeWarning.classList.add("hidden");
    } else {
      hqIncludeWarning.classList.remove("hidden");
    }

    renderCategoryCards(
      data.counts,
      isToday
    );
  } catch (error) {
    console.error(error);
    showToast(
      "データを取得できませんでした"
    );
  }
}

async function changeCount(category, amount) {
  const reception = receptionSelect.value;

  if (reception === "HQ") return;

  if (dateInput.value !== TODAY) {
    showToast("過去の日付は閲覧のみです");
    return;
  }

  try {
    const response = await fetch("/api/change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: dateInput.value,
        reception,
        category,
        amount
      })
    });

    if (!response.ok) throw new Error("Failed to update");
    await render();
  } catch (error) {
    console.error(error);
    showToast("更新に失敗しました");
  }
}

includeInHQ.addEventListener("change", async () => {
  const reception = receptionSelect.value;

  if (reception === "HQ") return;

  if (dateInput.value !== TODAY) {
    showToast("過去の日付は閲覧のみです");
    await render();
    return;
  }

  try{
    const response = await fetch("/api/reception-setting",{
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: dateInput.value,
        reception,
        includeInHQ: includeInHQ.checked
      })
    });
    
    if (!response.ok) {
      throw new Error("Failed to update setting");
    }

    if (includeInHQ.checked) {
      showToast(`${receptionLabel(reception)} を本部集計に含めるように設定しました`);
    } else {
      showToast(`${receptionLabel(reception)} を本部集計に含めないように設定しました`);
    }

    await render();

  } catch (error) {
    console.error(error);
    showToast("受付設定の更新に失敗しました");

    await render(); 
  }
});

async function openHistory() {
  mainView.classList.add("hidden");
  historyView.classList.remove("hidden");
  historyList.innerHTML = "<div class='history-card'>読み込み中...</div>";

  try {
    const response = await fetch("/api/history", { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to load history");
    const payload = await response.json();

    if (!payload.history.length) {
      historyList.innerHTML = "<div class='history-card'>まだ記録がありません。</div>";
      return;
    }

    historyList.innerHTML = "";

    for (const item of payload.history) {
      const card = document.createElement("article");
      card.className = "history-card";

      let receptionText = "";

      for (const reception of RECEPTIONS) {
        const data = item.receptions[reception];
        receptionText += `
          <div>
            ${receptionLabel(reception)}：
            ${data.total}人  
            ${data.includeInHQ ? "" : "(集計対象外)"}  
          </div>`;
      }

      card.innerHTML = `
        <div>
          <strong class="history-date">${item.date}</strong>
          <div class="history-receptions">
            ${receptionText}
          </div>
          <p>
            <strong>
              本部合計：${item.hqTotal}人
            </strong>
          </p>
        </div>
        <button data-date="${item.date}">詳細</button>
      `;

      card.querySelector("button").addEventListener("click", async () => {
        dateInput.value = item.date;
        receptionSelect.value = "HQ";
        localStorage.setItem("reception", "HQ");
        historyView.classList.add("hidden");
        mainView.classList.remove("hidden");
        await render();
      });

      historyList.appendChild(card);
    }
  } catch (error) {
    console.error(error);
    historyList.innerHTML = "<div class='history-card'>履歴を取得できませんでした。</div>";
  }
}

receptionSelect.addEventListener("change", () => {
  localStorage.setItem("reception", receptionSelect.value);
  render();
});

dateInput.addEventListener("change", render);

document.getElementById("todayButton").addEventListener("click", () => {
  dateInput.value = TODAY;
  render();
});

document.getElementById("historyOpenButton").addEventListener("click", openHistory);

document.getElementById("historyCloseButton").addEventListener("click", () => {
  historyView.classList.add("hidden");
  mainView.classList.remove("hidden");
  render();
});

// Public deployment version:
// Reception A/B remain independent, while HQ refreshes automatically.
// Polling also works reliably across normal hosting setups.
setInterval(() => {
  if (!historyView.classList.contains("hidden")) return;
  render();
}, 3000);

render();
