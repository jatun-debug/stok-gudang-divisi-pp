// Import Firebase SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  serverTimestamp,
  onSnapshot,
  where,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Init Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// DOM Elements
const userNameInput = document.getElementById("userNameInput");
const saveUserNameBtn = document.getElementById("saveUserNameBtn");
const currentUserDisplay = document.getElementById("currentUserDisplay");
const productForm = document.getElementById("productForm");
const productListBody = document.getElementById("productList");
const darkModeToggle = document.getElementById("darkModeToggle");
const exportCSVBtn = document.getElementById("exportCSV");
const exportExcelBtn = document.getElementById("exportExcel");
const productCategorySelect = document.getElementById("productCategory");
const addCategoryBtn = document.getElementById("addCategoryBtn");
const newCategoryInput = document.getElementById("newCategoryName");
const filterCategorySelect = document.getElementById("filterCategory");
const searchInput = document.getElementById("searchInput");
const historyListBody = document.getElementById("historyList");
const historyQuickRange = document.getElementById("historyQuickRange");
const historyStartDate = document.getElementById("historyStart");
const historyEndDate = document.getElementById("historyEnd");
const applyHistoryFilterBtn = document.getElementById("applyHistoryFilter");
const historySearchInput = document.getElementById("historySearch");
const chartCanvas = document.getElementById("stockChart");
const clearFormBtn = document.getElementById("clearFormBtn");
const productIdInput = document.getElementById("productId");

// State
let currentUserName = localStorage.getItem("userName") || "";
let allProducts = [];
let filteredProducts = [];
let categories = [];
let chartInstance;
let unsubProducts = null;
let unsubHistory = null;
let historyRows = [];

// ===== User Name Handling =====
function initializeUser() {
  if (currentUserName) {
    userNameInput.value = currentUserName;
    currentUserDisplay.textContent = `Hai, ${currentUserName}`;
    userNameInput.style.display = 'none';
    saveUserNameBtn.textContent = 'Ganti Nama';
  } else {
    currentUserDisplay.textContent = 'Nama belum diatur!';
  }
  
  // Start loading data once the page is ready
  subscribeCategories();
  subscribeProducts();
  applyHistoryQuickRange();
}

saveUserNameBtn.addEventListener("click", () => {
  if (userNameInput.style.display === 'none') {
    // Mode "Ganti Nama"
    userNameInput.style.display = 'inline-block';
    saveUserNameBtn.textContent = 'Simpan Nama';
    userNameInput.focus();
  } else {
    // Mode "Simpan Nama"
    const newName = userNameInput.value.trim();
    if (!newName) {
      alert("Nama tidak boleh kosong.");
      return;
    }
    currentUserName = newName;
    localStorage.setItem("userName", currentUserName);
    currentUserDisplay.textContent = `Hai, ${currentUserName}`;
    userNameInput.style.display = 'none';
    saveUserNameBtn.textContent = 'Ganti Nama';
  }
});

// ===== Categories =====
function subscribeCategories() {
  const qCat = query(collection(db, "categories"), orderBy("name"));
  onSnapshot(qCat, (snapshot) => {
    categories = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCategorySelects();
  });
}

function renderCategorySelects() {
  const currentFilter = filterCategorySelect.value;
  productCategorySelect.innerHTML = `<option value="" disabled selected>Pilih Kategori</option>`;
  filterCategorySelect.innerHTML = `<option value="">Semua Kategori</option>`;
  categories.forEach(c => {
    const optionHTML = `<option value="${c.name}">${c.name}</option>`;
    productCategorySelect.innerHTML += optionHTML;
    filterCategorySelect.innerHTML += optionHTML;
  });
  filterCategorySelect.value = currentFilter;
}

addCategoryBtn.addEventListener("click", async () => {
  const name = newCategoryInput.value.trim();
  if (!name) return alert("Nama kategori tidak boleh kosong.");
  if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    return alert("Kategori sudah ada.");
  }
  try {
    await addDoc(collection(db, "categories"), { name });
    newCategoryInput.value = "";
  } catch (e) {
    alert("Gagal menambah kategori: " + e.message);
  }
});

// ===== Products (CRUD) =====
productForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUserName) {
    return alert("Harap masukkan nama Anda terlebih dahulu sebelum menyimpan produk.");
  }

  const id = productIdInput.value;
  const name = productForm.productName.value.trim();
  const category = productForm.productCategory.value;
  const stock = parseInt(productForm.productQty.value, 10);

  if (!name || !category || isNaN(stock)) {
    return alert("Lengkapi nama, kategori, dan jumlah.");
  }

  try {
    if (id) {
      // Update existing product
      const productRef = doc(db, "products", id);
      const oldProductSnap = await getDoc(productRef);
      const oldStock = oldProductSnap.data().stock;
      
      await updateDoc(productRef, { name, category, stock });
      
      const delta = stock - oldStock;
      await logHistory({
        action: "update",
        name,
        change: delta >= 0 ? `+${delta}` : `${delta}`,
        by: currentUserName
      });
      alert("Produk berhasil diperbarui!");
    } else {
      // Add new product
      await addDoc(collection(db, "products"), {
        name,
        category,
        stock,
        createdAt: serverTimestamp(),
        createdBy: currentUserName
      });
      await logHistory({
        action: "create",
        name,
        change: `+${stock}`,
        by: currentUserName
      });
      alert("Produk berhasil ditambahkan!");
    }
    clearProductForm();
  } catch (err) {
    alert("Gagal menyimpan produk: " + err.message);
  }
});

function subscribeProducts() {
  if (unsubProducts) unsubProducts();
  const qProd = query(collection(db, "products"), orderBy("name"));
  unsubProducts = onSnapshot(qProd, (snapshot) => {
    allProducts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    applyProductFilters();
  });
}

function renderProductsTable() {
  productListBody.innerHTML = "";
  filteredProducts.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td>${p.stock ?? 0}</td>
      <td>${escapeHtml(p.category || "-")}</td>
      <td>${escapeHtml(p.createdBy || "-")}</td>
      <td class="actions">
        <button class="icon-btn" title="Edit" data-action="edit" data-id="${p.id}">✏️</button>
        <button class="icon-btn danger" title="Hapus" data-action="delete" data-id="${p.id}">🗑️</button>
      </td>
    `;
    productListBody.appendChild(tr);
  });
}

productListBody.addEventListener('click', (e) => {
  const target = e.target.closest('button');
  if (!target) return;

  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!action || !id) return;
  
  if (!currentUserName) {
    return alert("Harap masukkan nama Anda terlebih dahulu.");
  }

  const product = allProducts.find(p => p.id === id);
  if (!product) return;

  if (action === 'edit') {
    productIdInput.value = product.id;
    productForm.productName.value = product.name;
    productForm.productCategory.value = product.category;
    productForm.productQty.value = product.stock;
    productForm.scrollIntoView();
  } else if (action === 'delete') {
    deleteProduct(id, product.name, product.stock);
  }
});

async function deleteProduct(id, name, stock) {
  if (!confirm(`Yakin hapus produk "${name}"?`)) return;
  try {
    await deleteDoc(doc(db, "products", id));
    await logHistory({
      action: "delete",
      name,
      change: `-${stock}`,
      by: currentUserName
    });
    alert("Produk berhasil dihapus!");
  } catch (err) {
    alert("Gagal hapus: " + err.message);
  }
}

clearFormBtn.addEventListener("click", clearProductForm);

function clearProductForm() {
    productForm.reset();
    productIdInput.value = "";
}

// ===== Filtering and Searching =====
function applyProductFilters() {
  const query = searchInput.value.toLowerCase();
  const category = filterCategorySelect.value;
  filteredProducts = allProducts.filter(p => {
    const nameMatch = (p.name || "").toLowerCase().includes(query);
    const categoryMatch = category ? p.category === category : true;
    return nameMatch && categoryMatch;
  });
  renderProductsTable();
  renderChart();
}
searchInput.addEventListener("input", applyProductFilters);
filterCategorySelect.addEventListener("change", applyProductFilters);

// ===== Chart =====
function renderChart() {
  const grouped = {};
  filteredProducts.forEach(p => {
    const key = p.category || "Tanpa Kategori";
    grouped[key] = (grouped[key] || 0) + (p.stock || 0);
  });

  const labels = Object.keys(grouped);
  const data = Object.values(grouped);

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(chartCanvas, {
    type: "bar",
    data: { labels, datasets: [{ label: "Stok per Kategori", data }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true } }
    }
  });
}

// ===== History =====
async function logHistory({ action, name, change, by }) {
  try {
    await addDoc(collection(db, "history"), {
      action, name, change, by,
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.warn("Gagal menulis riwayat:", e);
  }
}

function subscribeHistoryByRange(startDate, endDate) {
  if (unsubHistory) unsubHistory();
  let qHist = query(collection(db, "history"), orderBy("createdAt", "desc"));
  if (startDate && endDate) {
    qHist = query(
      collection(db, "history"),
      where("createdAt", ">=", startDate),
      where("createdAt", "<=", endDate),
      orderBy("createdAt", "desc")
    );
  }
  unsubHistory = onSnapshot(qHist, (snapshot) => {
    historyRows = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHistoryTable();
  });
}

function renderHistoryTable() {
  const term = historySearchInput.value.toLowerCase();
  const filtered = historyRows.filter(r => {
    const text = `${r.action || ""} ${r.name || ""} ${r.change || ""} ${r.by || ""}`.toLowerCase();
    return text.includes(term);
  });
  historyListBody.innerHTML = filtered.map(r => {
    const timeStr = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString('id-ID') : "-";
    return `
      <tr>
        <td>${escapeHtml(timeStr)}</td>
        <td>${escapeHtml(r.action || "-")}</td>
        <td>${escapeHtml(r.name || "-")}</td>
        <td>${escapeHtml(r.change || "-")}</td>
        <td>${escapeHtml(r.by || "-")}</td>
      </tr>
    `;
  }).join('');
}

function applyHistoryQuickRange() {
  const val = historyQuickRange.value;
  historyStartDate.disabled = val !== "custom";
  historyEndDate.disabled = val !== "custom";
  if (val === "custom") return;
  
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - parseInt(val, 10));
  subscribeHistoryByRange(start, now);
}

historyQuickRange.addEventListener("change", applyHistoryQuickRange);
applyHistoryFilterBtn.addEventListener("click", () => {
  if (historyQuickRange.value !== "custom") return applyHistoryQuickRange();
  const s = historyStartDate.value ? new Date(historyStartDate.value + "T00:00:00") : null;
  const e = historyEndDate.value ? new Date(historyEndDate.value + "T23:59:59") : null;
  if (!s || !e) return alert("Pilih tanggal mulai & akhir.");
  subscribeHistoryByRange(s, e);
});
historySearchInput.addEventListener("input", renderHistoryTable);

// ===== Export =====
function exportData(format) {
    const header = ["Nama", "Kategori", "Stok", "Dibuat Oleh"];
    const data = filteredProducts.map(p => [p.name, p.category, p.stock, p.createdBy || ""]);
    
    const worksheet = XLSX.utils.aoa_to_sheet([header, ...data]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Produk");
    
    if (format === 'csv') {
        const csv = XLSX.utils.sheet_to_csv(worksheet);
        downloadBlob(new Blob([csv], { type: "text/csv" }), "products.csv");
    } else {
        XLSX.writeFile(workbook, "products.xlsx");
    }
}
exportCSVBtn.addEventListener("click", () => exportData('csv'));
exportExcelBtn.addEventListener("click", () => exportData('excel'));

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ===== Dark Mode =====
darkModeToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
});
if (localStorage.getItem("theme") === "dark") {
  document.body.classList.add("dark");
}

// ===== Helpers =====
function escapeHtml(s) {
  return (s ?? "").toString().replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

// ===== Initial Load =====
document.addEventListener('DOMContentLoaded', initializeUser);
