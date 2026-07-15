const params = new URLSearchParams(location.search);
let shop = params.get("shop") || localStorage.getItem("shopify-stocktake-shop") || "";
let lines = JSON.parse(localStorage.getItem("shopify-stocktake-lines") || "[]");
let currentItem = null;
let zxingControls = null;
let zxingReader = null;
let lastSavedId = localStorage.getItem("shopify-stocktake-id") || "";

const els = {
  connectButton: document.querySelector("#connectButton"),
  shopInput: document.querySelector("#shopInput"),
  locationInput: document.querySelector("#locationInput"),
  barcodeInput: document.querySelector("#barcodeInput"),
  lookupResult: document.querySelector("#lookupResult"),
  qtyInput: document.querySelector("#qtyInput"),
  addButton: document.querySelector("#addButton"),
  saveButton: document.querySelector("#saveButton"),
  downloadButton: document.querySelector("#downloadButton"),
  emailButton: document.querySelector("#emailButton"),
  applyButton: document.querySelector("#applyButton"),
  lineCount: document.querySelector("#lineCount"),
  varianceCount: document.querySelector("#varianceCount"),
  savedStatus: document.querySelector("#savedStatus"),
  stockList: document.querySelector("#stockList"),
  emptyState: document.querySelector("#emptyState"),
  camera: document.querySelector("#camera"),
  cameraNote: document.querySelector("#cameraNote"),
  scanButton: document.querySelector("#scanButton"),
  stopButton: document.querySelector("#stopButton"),
  toast: document.querySelector("#toast")
};

els.shopInput.value = shop;
if (shop) {
  localStorage.setItem("shopify-stocktake-shop", shop);
  loadLocations();
}

function api(path, options = {}) {
  const separator = path.includes("?") ? "&" : "?";
  return fetch(`${path}${separator}shop=${encodeURIComponent(shop)}`, options);
}

async function loadLocations() {
  if (!shop) return;
  const response = await api("/api/locations");
  if (response.status === 401) {
    const body = await response.json();
    if (body.authUrl) location.href = body.authUrl;
    return;
  }
  const locations = await response.json();
  els.locationInput.innerHTML = locations.map((location) => `<option value="${location.id}">${escapeHtml(location.name)}</option>`).join("");
}

function connect() {
  shop = els.shopInput.value.trim();
  if (!shop) return showToast("Enter your Shopify store domain.");
  localStorage.setItem("shopify-stocktake-shop", shop);
  location.href = `/auth?shop=${encodeURIComponent(shop)}`;
}

async function lookup(code) {
  if (!shop) return showToast("Connect Shopify first.");
  const value = String(code || els.barcodeInput.value).trim();
  if (!value) return;

  const response = await api(`/api/lookup?code=${encodeURIComponent(value)}&locationId=${encodeURIComponent(els.locationInput.value)}`);
  if (!response.ok) {
    currentItem = null;
    els.lookupResult.textContent = "No Shopify product matched this barcode or SKU.";
    return showToast("No Shopify product found.");
  }

  currentItem = await response.json();
  els.lookupResult.textContent = `${currentItem.productTitle} | SKU ${currentItem.sku || "-"} | Shopify qty ${currentItem.shopifyQuantity}`;
  els.qtyInput.focus();
}

function addLine() {
  if (!currentItem) return showToast("Scan or look up a Shopify item first.");
  const countedQuantity = Math.max(0, Number.parseInt(els.qtyInput.value, 10) || 0);
  const existing = lines.find((line) => line.inventoryItemId === currentItem.inventoryItemId);
  if (existing) existing.countedQuantity = countedQuantity;
  else lines.unshift({...currentItem, countedQuantity});

  localStorage.setItem("shopify-stocktake-lines", JSON.stringify(lines));
  currentItem = null;
  els.barcodeInput.value = "";
  els.qtyInput.value = "1";
  els.lookupResult.textContent = "No Shopify item selected.";
  render();
  showToast("Count added.");
}

async function saveStocktake() {
  if (!lines.length) return showToast("Count stock before saving.");
  const response = await api("/api/stocktakes", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      name: `Stocktake ${new Date().toLocaleDateString()}`,
      locationId: els.locationInput.value,
      lines
    })
  });
  if (!response.ok) return showToast("Could not save stocktake.");
  const saved = await response.json();
  lastSavedId = saved.id;
  localStorage.setItem("shopify-stocktake-id", lastSavedId);
  els.savedStatus.textContent = "Saved";
  showToast("Stocktake saved.");
}

function downloadCsv() {
  if (lastSavedId) {
    location.href = `/api/stocktakes/${encodeURIComponent(lastSavedId)}.csv?shop=${encodeURIComponent(shop)}`;
    return;
  }
  downloadLocalCsv();
}

async function emailCsv() {
  const file = new File([csvText()], "shopify-stocktake.csv", {type: "text/csv"});
  if (navigator.canShare?.({files: [file]}) && navigator.share) {
    await navigator.share({files: [file], title: "Shopify stocktake CSV"});
  } else {
    showToast("Use Download CSV, then attach it to email.");
  }
}

async function applyToShopify() {
  if (!lastSavedId) await saveStocktake();
  if (!lastSavedId) return;
  const ok = confirm("Update Shopify inventory for all variance lines? This changes live stock.");
  if (!ok) return;
  const response = await api(`/api/stocktakes/${encodeURIComponent(lastSavedId)}/apply`, {method: "POST"});
  const body = await response.json();
  if (!response.ok || body.userErrors?.length) return showToast("Shopify update returned errors.");
  showToast("Shopify inventory updated.");
}

async function startScan() {
  if (!window.ZXingBrowser?.BrowserMultiFormatReader) return showToast("Barcode reader did not load.");
  zxingReader = zxingReader || new ZXingBrowser.BrowserMultiFormatReader();
  els.scanButton.disabled = true;
  els.stopButton.disabled = false;
  els.cameraNote.textContent = "Point the camera at a barcode.";
  zxingControls = await zxingReader.decodeFromConstraints(
    {video: {facingMode: {ideal: "environment"}, width: {ideal: 1280}, height: {ideal: 720}}, audio: false},
    els.camera,
    (result) => {
      if (!result) return;
      const value = result.getText ? result.getText() : result.text;
      stopScan();
      els.barcodeInput.value = value;
      lookup(value);
    }
  );
}

function stopScan() {
  zxingControls?.stop();
  zxingControls = null;
  els.scanButton.disabled = false;
  els.stopButton.disabled = true;
  els.camera.srcObject = null;
  els.cameraNote.textContent = "Connect your Shopify store, then scan a barcode.";
}

function render() {
  els.lineCount.textContent = lines.length.toString();
  els.varianceCount.textContent = lines.filter((line) => variance(line.shopifyQuantity, line.countedQuantity) !== 0).length.toString();
  els.emptyState.hidden = lines.length > 0;
  els.stockList.innerHTML = "";
  for (const line of lines) {
    const row = document.createElement("article");
    row.className = "stock-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(line.productTitle || "Unnamed product")}</strong>
        <span>${escapeHtml(line.barcode || "")} | SKU ${escapeHtml(line.sku || "-")} | Shopify ${line.shopifyQuantity} | Counted ${line.countedQuantity}</span>
      </div>
      <strong class="variance">${variance(line.shopifyQuantity, line.countedQuantity)}</strong>
    `;
    els.stockList.append(row);
  }
}

function csvText() {
  const rows = [["Barcode", "SKU", "Product", "Variant", "Shopify quantity", "Counted quantity", "Variance", "Inventory item ID"]];
  for (const line of lines) {
    rows.push([line.barcode, line.sku, line.productTitle, line.variantTitle, line.shopifyQuantity, line.countedQuantity, variance(line.shopifyQuantity, line.countedQuantity), line.inventoryItemId]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function downloadLocalCsv() {
  const blob = new Blob([csvText()], {type: "text/csv"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "shopify-stocktake.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function variance(expected, counted) {
  return Number(counted || 0) - Number(expected || 0);
}

function csvCell(value = "") {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"}[char]));
}

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

els.connectButton.addEventListener("click", connect);
els.barcodeInput.addEventListener("change", () => lookup());
els.barcodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") lookup();
});
els.addButton.addEventListener("click", addLine);
els.saveButton.addEventListener("click", saveStocktake);
els.downloadButton.addEventListener("click", downloadCsv);
els.emailButton.addEventListener("click", emailCsv);
els.applyButton.addEventListener("click", applyToShopify);
els.scanButton.addEventListener("click", startScan);
els.stopButton.addEventListener("click", stopScan);
window.addEventListener("pagehide", stopScan);

render();
