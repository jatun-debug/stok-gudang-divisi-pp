import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, query,
  orderBy, serverTimestamp, onSnapshot, where, getDocs, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Init Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// DOM Elements
const userNameInput = document.getElementById("userNameInput");
const saveUserNameBtn = document.getElementById("saveUserNameBtn");
const currentUserDisplay = document.getElementById("currentUserDisplay");
const productForm = document.getElementById("productForm");
const productNameInput = document.getElementById("productName");
const productCategoryInput = document.getElementById("productCategory");
const productQtyInput = document.getElementById("productQty");
const addProductStockBtn = document.getElementById("addProductStockBtn");
const subtractProductStockBtn = document.getElementById("subtractProductStockBtn");
const productListBody = document.getElementById("productList");
const searchInput = document.getElementById("searchInput");
const chartCanvas = document.getElementById("stockChart");
const historyListBody = document.getElementById("historyList");
const historyDateFilter = document.getElementById("historyDateFilter");
const historySearch = document.getElementById("historySearch");
const darkModeToggle = document.getElementById("darkModeToggle");
const exportCSVBtn = document.getElementById("exportCSV");
const exportExcelBtn = document.getElementById("exportExcel");

// State
let currentUserName = localStorage.getItem("userName") || "";
let allProducts = [];
let filteredProducts = [];
let chartInstance;
let unsubProducts = null;
let unsubHistory = null;
let historyRows = [];

// ===== User & Initial Load =====
function initializeUser() {
  if (currentUserName) {
    userNameInput.value = currentUserName;
    currentUserDisplay.textContent = `Hai, ${currentUserName}`;
    userNameInput.style.display = 'none';
    saveUserNameBtn.textContent = 'Ganti Nama';
  } else {
    currentUserDisplay.textContent = 'Nama belum diatur!';
  }
  subscribeProducts();
  subscribeHistoryByDate(new Date()); // Load today's history by default
  historyDateFilter.valueAsDate = new Date(); // Set default date
}

saveUserNameBtn.addEventListener("click", () => {
  if (userNameInput.style.display === 'none') {
    userNameInput.style.display = 'inline-block';
    saveUserNameBtn.textContent = 'Simpan Nama';
    userNameInput.focus();
  } else {
    const newName = userNameInput.value.trim();
    if (!newName) return alert("Nama tidak boleh kosong.");
    currentUserName = newName;
    localStorage.setItem("userName", currentUserName);
    currentUserDisplay.textContent = `Hai, ${currentUserName}`;
    userNameInput.style.display = 'none';
    saveUserNameBtn.textContent = 'Ganti Nama';
  }
});

// ===== Product Stock Logic =====
addProductStockBtn.addEventListener("click", () => updateStock("add"));
subtractProductStockBtn.addEventListener("click", () => updateStock("subtract"));

async function updateStock(operation) {
  const name = productNameInput.value.trim();
  const category = productCategoryInput.value.trim();
  const qty = parseInt(productQtyInput.value, 10);

  if (!currentUserName) return alert("Harap masukkan nama Anda terlebih dahulu.");
  if (!name || !category || isNaN(qty) || qty <= 0) {
    return alert("Lengkapi nama, kategori, dan jumlah (harus lebih dari 0).");
  }

  // Find if product exists (case-insensitive)
  const existingProduct = allProducts.find(p => p.name.toLowerCase() === name.toLowerCase());

  try {
    if (existingProduct) {
      // Product exists, update its stock
      const productRef = doc(db, "products", existingProduct.id);
      await runTransaction(db, async (transaction) => {
        const productDoc = await transaction.get(productRef);
        if (!productDoc.exists()) throw "Produk tidak ditemukan!";
        
        const currentStock = productDoc.data().stock;
        let newStock;
        if (operation === "add") {
          newStock = currentStock + qty;
        } else { // subtract
          newStock = currentStock - qty;
          if (newStock < 0) throw "Stok tidak boleh kurang dari nol!";
        }
        transaction.update(productRef, { stock: newStock, category: category });
      });

      const change = operation === 'add' ? `+${qty}` : `-${qty}`;
      await logHistory({ action: `stok ${operation}`, name, change, by: currentUserName });
      alert(`Stok untuk "${name}" berhasil diubah.`);

    } else {
      // Product is new
      if (operation === 'subtract') {
        return alert("Tidak bisa mengurangi stok untuk produk yang belum ada.");
      }
      // Add new product
      await addDoc(collection(db, "products"), {
        name, category, stock: qty,
        createdAt: serverTimestamp(), createdBy: currentUserName,
      });
      await logHistory({ action: "create", name, change: `+${qty}`, by: currentUserName });
      alert(`Produk baru "${name}" berhasil ditambahkan.`);
    }
    productForm.reset();
  } catch (error) {
    alert("Gagal memperbarui stok: " + error);
  }
}

// ===== Product List & Filtering =====
function subscribeProducts() {
  if (unsubProducts) unsubProducts();
  const q = query(collection(db, "products"), orderBy("name"));
  unsubProducts = onSnapshot(q, (snapshot) => {
    allProducts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    applyProductFilters();
  });
}

function applyProductFilters() {
  const searchTerm = searchInput.value.toLowerCase();
  filteredProducts = allProducts.filter(p => 
    p.name.toLowerCase().includes(searchTerm)
  );
  renderProductsTable();
  renderChart();
}

searchInput.addEventListener("input", applyProductFilters);

function renderProductsTable() {
  productListBody.innerHTML = filteredProducts.map(p => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${p.stock ?? 0}</td>
      <td>${escapeHtml(p.category || "-")}</td>
      <td>${escapeHtml(p.createdBy || "-")}</td>
    </tr>
  `).join('');
}

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
    data: { labels, datasets: [{ label: "Stok per Kategori", data, backgroundColor: '#4CAF50' }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true } },
    }
  });
}

// ===== History =====
historyDateFilter.addEventListener('change', () => {
    const selectedDate = historyDateFilter.valueAsDate;
    if (selectedDate) {
        subscribeHistoryByDate(selectedDate);
    }
});
historySearch.addEventListener('input', renderHistoryTable);

function subscribeHistoryByDate(date) {
    if (unsubHistory) unsubHistory();
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const q = query(collection(db, "history"),
        where("createdAt", ">=", startOfDay),
        where("createdAt", "<=", endOfDay),
        orderBy("createdAt", "desc")
    );
    unsubHistory = onSnapshot(q, (snapshot) => {
        historyRows = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderHistoryTable();
    });
}

function renderHistoryTable() {
    const term = historySearch.value.toLowerCase();
    const filtered = historyRows.filter(r => 
        Object.values(r).join(' ').toLowerCase().includes(term)
    );
    historyListBody.innerHTML = filtered.map(r => {
        const timeStr = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleTimeString('id-ID') : "-";
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

async function logHistory({ action, name, change, by }) {
  try {
    await addDoc(collection(db, "history"), {
      action, name, change, by, createdAt: serverTimestamp()
    });
  } catch (e) { console.warn("Gagal menulis riwayat:", e); }
}

// ===== Export & Helpers =====
exportCSVBtn.addEventListener("click", () => exportData('csv'));
exportExcelBtn.addEventListener("click", () => exportData('excel'));

function exportData(format) {
    const header = ["Nama", "Kategori", "Stok", "Dibuat Oleh"];
    const data = filteredProducts.map(p => [p.name, p.category, p.stock, p.createdBy || ""]);
    const worksheet = XLSX.utils.aoa_to_sheet([header, ...data]);
    if (format === 'csv') {
        const csv = XLSX.utils.sheet_to_csv(worksheet);
        downloadBlob(new Blob([csv], { type: "text/csv" }), "products.csv");
    } else {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Produk");
        XLSX.writeFile(workbook, "products.xlsx");
    }
}

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

darkModeToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
});

function escapeHtml(s) {
  return (s ?? "").toString().replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

// ===== Initial Load =====
document.addEventListener('DOMContentLoaded', initializeUser);
