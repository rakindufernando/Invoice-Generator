(() => {
  "use strict";

  const DRAFT_KEY = "invoiceflow_draft_v3";
  const SAVED_KEY = "invoiceflow_saved_v3";
  const COUNTER_KEY = "invoiceflow_counter_v3";
  const DEFAULT_LOGO = "assets/W_Family_Logo_Enhanced.svg";
  const BUMBI_LOGO = "assets/BUMBI_LOGO.svg";
  const $ = id => document.getElementById(id);
  const fieldIds = [
    "businessName", "billedBy", "businessEmail", "businessPhone", "taxNumber", "businessAddress",
    "customerName", "customerEmail", "customerAddress", "invoiceNumber", "currency",
    "issueDate", "dueDate", "statusMode", "status", "paymentMethod", "amountPaid",
    "notes", "terms", "signatureName"
  ];
  const currencyInfo = {
    LKR: { symbol: "Rs.", label: "LKR" }, USD: { symbol: "$", label: "USD" },
    EUR: { symbol: "€", label: "EUR" }, GBP: { symbol: "£", label: "GBP" },
    AUD: { symbol: "A$", label: "AUD" }, CAD: { symbol: "C$", label: "CAD" },
    INR: { symbol: "₹", label: "INR" }
  };
  let logoData = DEFAULT_LOGO;
  let autosaveTimer;
  let toastTimer;

  const safeNumber = value => Math.max(0, Number(value) || 0);
  const isoDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const localDateTime = (date = new Date()) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  };
  const addDays = (dateString, days) => {
    const date = new Date(`${dateString}T12:00:00`);
    date.setDate(date.getDate() + days);
    return isoDate(date);
  };
  const parseLocalDate = value => new Date(value.length === 10 ? `${value}T12:00:00` : value);
  const formatDate = value => value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(parseLocalDate(value)) : "Not set";
  const formatDateTime = value => value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(parseLocalDate(value)) : "Not set";
  const formatMoney = (value, code = $("currency").value) => {
    const info = currencyInfo[code] || { symbol: code, label: code };
    const number = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safeNumber(value));
    return `${info.symbol} ${number}`;
  };
  const pdfMoney = (value, code) => `${currencyInfo[code]?.label || code} ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safeNumber(value))}`;
  const joinLines = values => values.filter(Boolean).join("\n");
  const safeFilename = value => (value || "receipt").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 70) || "receipt";

  function showToast(message, type = "success") {
    clearTimeout(toastTimer);
    const toast = $("toast");
    toast.textContent = message;
    toast.className = `toast show${type === "error" ? " error" : ""}`;
    toastTimer = setTimeout(() => { toast.className = "toast"; }, 2800);
  }

  function nextInvoiceNumber() {
    let counter = 1;
    try { counter = Number(localStorage.getItem(COUNTER_KEY) || 1); } catch { /* Use an in-memory fallback. */ }
    const now = new Date();
    const usedNumbers = new Set(savedInvoices().map(receipt => receipt.invoiceNumber));
    let number = `REC-${now.getFullYear()}-${String(counter).padStart(4, "0")}`;
    while (usedNumbers.has(number)) {
      counter += 1;
      number = `REC-${now.getFullYear()}-${String(counter).padStart(4, "0")}`;
    }
    try { localStorage.setItem(COUNTER_KEY, String(counter + 1)); } catch { /* Number generation still works without storage. */ }
    return number;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function createItemRow(item = { description: "", quantity: 1, rate: 0 }) {
    const row = document.createElement("div");
    row.className = "item-row";

    const description = document.createElement("input");
    description.type = "text";
    description.className = "item-description";
    description.placeholder = "Product or service";
    description.maxLength = 180;
    description.setAttribute("aria-label", "Item description");
    description.value = item.description || "";

    const quantity = document.createElement("input");
    quantity.type = "number";
    quantity.className = "item-quantity";
    quantity.min = "0";
    quantity.step = "0.01";
    quantity.setAttribute("aria-label", "Quantity");
    quantity.value = Number.isFinite(Number(item.quantity)) ? item.quantity : 1;

    const rate = document.createElement("input");
    rate.type = "number";
    rate.className = "item-rate";
    rate.min = "0";
    rate.step = "0.01";
    rate.setAttribute("aria-label", "Unit rate");
    rate.value = safeNumber(item.rate);

    const amount = document.createElement("span");
    amount.className = "line-amount";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-item";
    remove.setAttribute("aria-label", "Remove item");
    remove.title = "Remove item";
    remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/></svg>';

    row.append(description, quantity, rate, amount, remove);
    row.querySelectorAll("input").forEach(input => input.addEventListener("input", handleChange));
    remove.addEventListener("click", () => {
      if ($("itemsList").children.length === 1) {
        description.value = "";
        quantity.value = 1;
        rate.value = 0;
      } else row.remove();
      handleChange();
    });
    $("itemsList").appendChild(row);
  }

  function getItems() {
    return [...$("itemsList").querySelectorAll(".item-row")].map(row => {
      const description = row.querySelector(".item-description").value.trim();
      const quantity = safeNumber(row.querySelector(".item-quantity").value);
      const rate = safeNumber(row.querySelector(".item-rate").value);
      return { description, quantity, rate, amount: quantity * rate };
    });
  }

  function getTotals(items = getItems()) {
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const total = subtotal;
    const paid = Math.min(safeNumber($("amountPaid").value), total);
    return { subtotal, total, paid, balance: Math.max(0, total - paid) };
  }

  function updatePaymentStatus(totals) {
    const automatic = $("statusMode").value === "automatic";
    $("status").disabled = automatic;
    $("statusHint").textContent = automatic ? "Status changes automatically from the paid amount." : "Select the receipt status manually.";
    if (!automatic) return;
    if (totals.total > 0 && totals.balance === 0) $("status").value = "Paid";
    else if (totals.paid > 0) $("status").value = "Partially paid";
    else $("status").value = "Unpaid";
  }

  function setText(id, value) { $(id).textContent = value; }
  function toggleRow(id, visible) { $(id).hidden = !visible; }

  function updatePreview() {
    const items = getItems();
    const totals = getTotals(items);
    const code = $("currency").value;
    updatePaymentStatus(totals);

    document.querySelectorAll(".item-row").forEach((row, index) => {
      row.querySelector(".line-amount").textContent = formatMoney(items[index].amount, code);
    });
    [
      ["editorSubtotal", totals.subtotal], ["editorTotal", totals.total], ["editorPaid", totals.paid], ["editorBalance", totals.balance],
      ["previewSubtotal", totals.subtotal], ["previewTotal", totals.total], ["previewPaid", totals.paid],
      ["previewBalance", totals.balance]
    ].forEach(([id, value]) => setText(id, formatMoney(value, code)));

    setText("previewBusinessName", $("businessName").value.trim() || "Your business");
    setText("previewBusinessDetails", joinLines([$("businessAddress").value.trim(), $("businessEmail").value.trim(), $("businessPhone").value.trim(), $("taxNumber").value.trim() && `Registration: ${$("taxNumber").value.trim()}`]));
    setText("previewBilledBy", $("billedBy").value.trim() || "Not specified");
    setText("previewCustomerName", $("customerName").value.trim() || "Customer name");
    setText("previewCustomerDetails", joinLines([$("customerAddress").value.trim(), $("customerEmail").value.trim()]));
    setText("previewInvoiceNumber", $("invoiceNumber").value.trim() || "Not set");
    setText("previewIssueDate", formatDateTime($("issueDate").value));
    setText("previewDueDate", formatDate($("dueDate").value));
    setText("previewPaymentMethod", $("paymentMethod").value);
    setText("previewNotes", $("notes").value.trim());
    setText("previewTerms", $("terms").value.trim());
    setText("previewSignatureName", $("signatureName").value.trim() || $("billedBy").value.trim() || "Authorized issuer");

    const status = $("status").value;
    const badge = $("previewStatus");
    badge.textContent = status;
    badge.className = `status-badge ${status.toLowerCase().replaceAll(" ", "-")}`;
    toggleRow("previewNotesSection", Boolean($("notes").value.trim()));
    toggleRow("previewTermsSection", Boolean($("terms").value.trim()));

    const previewBody = $("previewItems");
    previewBody.replaceChildren();
    const displayItems = items.filter(item => item.description || item.quantity || item.rate);
    if (!displayItems.length) {
      const row = document.createElement("tr");
      row.className = "empty-row";
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.textContent = "Add an item to begin";
      row.appendChild(cell);
      previewBody.appendChild(row);
    } else {
      displayItems.forEach(item => {
        const row = document.createElement("tr");
        [item.description || "Untitled item", String(item.quantity), formatMoney(item.rate, code), formatMoney(item.amount, code)].forEach(value => {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        });
        previewBody.appendChild(row);
      });
    }
  }

  function collectData() {
    const data = { version: 2, logoData, items: getItems() };
    fieldIds.forEach(id => { data[id] = $(id).value; });
    return data;
  }

  function applyData(data) {
    if (!data || typeof data !== "object") throw new Error("Invalid receipt data");
    fieldIds.forEach(id => { if (data[id] !== undefined) $(id).value = String(data[id]); });
    logoData = typeof data.logoData === "string" && data.logoData ? data.logoData : DEFAULT_LOGO;
    updateLogoViews();
    $("itemsList").replaceChildren();
    const items = Array.isArray(data.items) && data.items.length ? data.items.slice(0, 100) : [{ description: "", quantity: 1, rate: 0 }];
    items.forEach(createItemRow);
    updatePreview();
    scheduleAutosave();
  }

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    $("saveState").classList.add("saving");
    $("saveState").lastChild.textContent = " Saving changes";
    autosaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(collectData()));
        $("saveState").classList.remove("saving");
        $("saveState").lastChild.textContent = " Saved locally";
      } catch {
        $("saveState").lastChild.textContent = " Storage unavailable";
      }
    }, 450);
  }

  function handleChange() {
    updatePreview();
    scheduleAutosave();
  }

  function updateLogoViews() {
    [$("logoThumb"), $("previewLogo")].forEach(image => {
      image.src = logoData;
      image.hidden = false;
    });
    $("logoUploadContent").hidden = true;
    $("removeLogoBtn").hidden = logoData === DEFAULT_LOGO;
  }

  function loadLogo(file) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) {
      showToast("Please select a PNG, JPG or WebP image under 2 MB.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { logoData = String(reader.result); updateLogoViews(); handleChange(); };
    reader.onerror = () => showToast("The logo could not be read.", "error");
    reader.readAsDataURL(file);
  }

  function validateInvoice() {
    document.querySelectorAll(".invalid").forEach(element => element.classList.remove("invalid"));
    const required = ["businessName", "customerName", "invoiceNumber", "issueDate"];
    const invalid = required.filter(id => !$(id).value.trim());
    if ($("businessEmail").value && !$("businessEmail").validity.valid) invalid.push("businessEmail");
    if ($("customerEmail").value && !$("customerEmail").validity.valid) invalid.push("customerEmail");
    if ($("dueDate").value && $("issueDate").value && $("dueDate").value < $("issueDate").value.slice(0, 10)) invalid.push("dueDate");
    const validItems = getItems().filter(item => item.description && item.quantity > 0);
    if (!validItems.length) {
      $("itemsList").querySelector(".item-description")?.classList.add("invalid");
      showToast("Add at least one item with a description and quantity.", "error");
      return false;
    }
    if (invalid.length) {
      [...new Set(invalid)].forEach(id => $(id).classList.add("invalid"));
      $(invalid[0]).focus();
      showToast(invalid.includes("dueDate") ? "The due date cannot be before the issue date." : "Please complete the highlighted receipt details.", "error");
      return false;
    }
    return true;
  }

  function savedInvoices() {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]"); } catch { return []; }
  }

  function refreshSavedCount() { $("savedCount").textContent = String(savedInvoices().length); }

  function saveInvoice() {
    if (!validateInvoice()) return;
    const invoices = savedInvoices();
    const data = collectData();
    data.savedAt = new Date().toISOString();
    const index = invoices.findIndex(invoice => invoice.invoiceNumber === data.invoiceNumber);
    if (index >= 0) invoices[index] = data; else invoices.unshift(data);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(invoices.slice(0, 50)));
      localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
      refreshSavedCount();
      showToast(index >= 0 ? "Saved receipt updated." : "Receipt saved in this browser.");
    } catch { showToast("The receipt could not be saved. Try using the default logo.", "error"); }
  }

  function renderSavedInvoices() {
    const list = $("savedList");
    list.replaceChildren();
    const invoices = savedInvoices();
    if (!invoices.length) {
      const empty = document.createElement("div");
      empty.className = "empty-saved";
      empty.textContent = "No saved receipts yet.";
      list.appendChild(empty);
      return;
    }
    invoices.forEach((invoice, index) => {
      const card = document.createElement("article");
      card.className = "saved-card";
      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = invoice.invoiceNumber || "Untitled receipt";
      const meta = document.createElement("small");
      meta.textContent = `${invoice.customerName || "No customer"} · ${formatDate(invoice.issueDate)}`;
      info.append(title, meta);
      const actions = document.createElement("div");
      const load = document.createElement("button");
      load.type = "button";
      load.textContent = "Load";
      load.addEventListener("click", () => { applyData(invoice); closeSavedModal(); showToast("Receipt loaded."); });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-saved";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => {
        if (!confirm(`Delete ${invoice.invoiceNumber || "this receipt"}?`)) return;
        const updated = savedInvoices();
        updated.splice(index, 1);
        localStorage.setItem(SAVED_KEY, JSON.stringify(updated));
        refreshSavedCount();
        renderSavedInvoices();
        showToast("Saved receipt deleted.");
      });
      actions.append(load, remove);
      card.append(info, actions);
      list.appendChild(card);
    });
  }

  function closeSavedModal() { $("savedModal").hidden = true; }

  function exportJson() {
    const blob = new Blob([JSON.stringify(collectData(), null, 2)], { type: "application/json" });
    triggerDownload(blob, `${safeFilename($("invoiceNumber").value)}.json`);
    showToast("Receipt data exported.");
  }

  function importJson(file) {
    if (!file || file.size > 5 * 1024 * 1024) { showToast("Select a valid JSON file under 5 MB.", "error"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try { applyData(JSON.parse(String(reader.result))); showToast("Receipt data imported."); }
      catch { showToast("This file does not contain valid receipt data.", "error"); }
    };
    reader.readAsText(file);
  }

  function newInvoice(confirmFirst = true) {
    if (confirmFirst && !confirm("Start a new receipt? Your autosaved draft will be replaced.")) return;
    const now = new Date();
    const today = isoDate(now);
    const keepBusiness = {
      businessName: $("businessName").value || "WEERAHANNADIGE FAMILY", billedBy: $("billedBy").value || "Rohan Ferando", businessEmail: $("businessEmail").value,
      businessPhone: $("businessPhone").value, taxNumber: $("taxNumber").value,
      businessAddress: $("businessAddress").value, logoData
    };
    fieldIds.forEach(id => { $(id).value = ""; });
    Object.entries(keepBusiness).forEach(([id, value]) => { if (id !== "logoData") $(id).value = value; });
    logoData = keepBusiness.logoData;
    $("invoiceNumber").value = nextInvoiceNumber();
    $("currency").value = "LKR";
    $("issueDate").value = localDateTime(now);
    $("dueDate").value = addDays(today, 14);
    $("statusMode").value = "automatic";
    $("status").value = "Unpaid";
    $("paymentMethod").value = "Bank transfer";
    $("amountPaid").value = "0";
    $("notes").value = "Thank you for your business.";
    $("signatureName").value = keepBusiness.billedBy || "Rohan Ferando";
    $("itemsList").replaceChildren();
    createItemRow();
    updateLogoViews();
    handleChange();
  }

  function duplicateReceipt() {
    const now = new Date();
    const today = isoDate(now);
    $("invoiceNumber").value = nextInvoiceNumber();
    $("issueDate").value = localDateTime(now);
    $("dueDate").value = addDays(today, 14);
    $("statusMode").value = "automatic";
    $("status").value = "Unpaid";
    $("amountPaid").value = "0";
    handleChange();
    $("invoiceNumber").focus();
    showToast("Receipt duplicated with a new number and issue time.");
  }

  function markFullAmountPaid() {
    const totals = getTotals();
    $("amountPaid").value = String(totals.total);
    if ($("statusMode").value === "manual") $("status").value = "Paid";
    handleChange();
    showToast("The full receipt amount is marked as paid.");
  }

  function clearPayment() {
    $("amountPaid").value = "0";
    if ($("statusMode").value === "manual") $("status").value = "Unpaid";
    handleChange();
  }

  function clearAllItems() {
    if (!confirm("Clear all receipt items?")) return;
    $("itemsList").replaceChildren();
    createItemRow();
    handleChange();
    $("itemsList").querySelector(".item-description").focus();
    showToast("All receipt items cleared.");
  }

  function imageToPngData(source, maxWidth = 900, maxHeight = 500) {
    return new Promise(resolve => {
      if (!source) { resolve(""); return; }
      const image = new Image();
      image.onload = () => {
        try {
          const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        } catch { resolve(""); }
      };
      image.onerror = () => resolve("");
      image.src = source;
    });
  }

  function addPdfFooter(doc, bumbiLogo) {
    const pages = doc.internal.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      const width = doc.internal.pageSize.getWidth();
      const height = doc.internal.pageSize.getHeight();
      doc.setDrawColor(226, 232, 239);
      doc.line(14, height - 15, width - 14, height - 15);
      if (bumbiLogo) doc.addImage(bumbiLogo, "PNG", 14, height - 13, 20, 7, undefined, "FAST");
      doc.setTextColor(83, 99, 119);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.text("POWERED BY BUMBI SOFTWARE SOLUTIONS", bumbiLogo ? 38 : 14, height - 9);
      doc.text(`Page ${page} of ${pages}`, width - 14, height - 9, { align: "right" });
    }
  }

  async function downloadPdf() {
    if (!validateInvoice()) return;
    if (!window.jspdf || typeof window.jspdf.jsPDF !== "function") {
      showToast("The PDF library did not load. Check your internet connection and try again.", "error");
      return;
    }
    const button = $("downloadPdfBtn");
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = "Creating PDF...";
    try {
      const [pdfLogo, pdfBumbiLogo] = await Promise.all([
        imageToPngData(logoData, 700, 700),
        imageToPngData(BUMBI_LOGO, 1000, 400)
      ]);
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 14;
      const right = pageWidth - margin;
      const code = $("currency").value;
      const items = getItems().filter(item => item.description && item.quantity > 0);
      const totals = getTotals(items);

      doc.setFillColor(7, 26, 51);
      doc.rect(0, 0, pageWidth, 7, "F");
      doc.setFillColor(20, 121, 255);
      doc.rect(0, 0, 72, 7, "F");
      let leftX = margin;
      if (pdfLogo) {
        try {
          doc.addImage(pdfLogo, "PNG", margin, 13, 24, 24, undefined, "FAST");
          leftX = 42;
        } catch { /* Continue without the logo if the browser cannot decode it. */ }
      }
      doc.setTextColor(7, 26, 51);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text($("businessName").value.trim(), leftX, 20);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(90, 105, 124);
      const businessLines = doc.splitTextToSize(joinLines([$("businessAddress").value.trim(), $("businessEmail").value.trim(), $("businessPhone").value.trim(), $("taxNumber").value.trim() && `Registration: ${$("taxNumber").value.trim()}`]), 80);
      doc.text(businessLines, leftX, 25);

      doc.setTextColor(7, 26, 51);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.text("E-RECEIPT", right, 20, { align: "right" });
      doc.setFontSize(9);
      doc.setTextColor(20, 121, 255);
      doc.text($("status").value.toUpperCase(), right, 27, { align: "right" });

      doc.setDrawColor(220, 229, 239);
      doc.line(margin, 43, right, 43);
      doc.setTextColor(128, 140, 156);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      doc.text("BILLED TO", margin, 51);
      doc.setTextColor(23, 36, 56);
      doc.setFontSize(10.5);
      doc.text($("customerName").value.trim(), margin, 58);
      doc.setTextColor(90, 105, 124);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      const customerLines = doc.splitTextToSize(joinLines([$("customerAddress").value.trim(), $("customerEmail").value.trim()]), 88);
      doc.text(customerLines, margin, 64);
      const billedByY = Math.max(74, 64 + customerLines.length * 4 + 3);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(128, 140, 156);
      doc.setFontSize(7.5);
      doc.text("BILLED BY", margin, billedByY);
      doc.setTextColor(23, 36, 56);
      doc.setFontSize(9);
      doc.text($("billedBy").value.trim() || "Rohan Ferando", margin, billedByY + 5);

      const metaX = 130;
      const meta = [["Receipt number", $("invoiceNumber").value.trim()], ["Issue date and time", formatDateTime($("issueDate").value)], ["Due date", formatDate($("dueDate").value)]];
      meta.forEach(([label, value], index) => {
        const y = 50 + index * 7;
        doc.setFont("helvetica", "normal"); doc.setTextColor(112, 126, 144); doc.text(label, metaX, y);
        doc.setFont("helvetica", "bold"); doc.setTextColor(23, 36, 56); doc.text(String(value), right, y, { align: "right" });
      });

      doc.autoTable({
        startY: Math.max(87, billedByY + 10),
        margin: { left: margin, right: margin, bottom: 23 },
        head: [["Description", "Qty", `Rate (${code})`, `Amount (${code})`]],
        body: items.map(item => [item.description, String(item.quantity), pdfMoney(item.rate, code), pdfMoney(item.amount, code)]),
        theme: "plain",
        styles: { font: "helvetica", fontSize: 8.5, cellPadding: { top: 4, right: 3, bottom: 4, left: 3 }, textColor: [35, 49, 68], lineColor: [225, 232, 239], lineWidth: { bottom: .2 }, overflow: "linebreak" },
        headStyles: { fillColor: [7, 26, 51], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8, cellPadding: 4 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: { 0: { cellWidth: 92 }, 1: { cellWidth: 18, halign: "right" }, 2: { cellWidth: 34, halign: "right" }, 3: { cellWidth: 38, halign: "right", fontStyle: "bold" } },
        showHead: "everyPage"
      });

      let y = doc.lastAutoTable.finalY + 9;
      const summaryHeight = 38;
      if (y + summaryHeight > 272) { doc.addPage(); y = 20; }
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(128, 140, 156);
      doc.text("PAYMENT METHOD", margin, y + 2);
      doc.setTextColor(23, 36, 56);
      doc.text($("paymentMethod").value, margin, y + 8);
      const labelX = 132;
      const summaryRows = [["Subtotal", totals.subtotal]];
      summaryRows.forEach(([label, value], index) => {
        const rowY = y + index * 6;
        doc.setFont("helvetica", "normal"); doc.setTextColor(102, 116, 134); doc.text(label, labelX, rowY);
        doc.setFont("helvetica", "bold"); doc.setTextColor(23, 36, 56); doc.text(pdfMoney(value, code), right, rowY, { align: "right" });
      });
      const totalY = y + 10;
      doc.setDrawColor(190, 202, 215); doc.line(labelX, totalY - 4, right, totalY - 4);
      doc.setFontSize(11); doc.setTextColor(7, 26, 51); doc.text("Total", labelX, totalY); doc.text(pdfMoney(totals.total, code), right, totalY, { align: "right" });
      let balanceY = totalY + 8;
      doc.setFontSize(8); doc.setTextColor(102, 116, 134); doc.text("Amount paid", labelX, balanceY); doc.setTextColor(23, 36, 56); doc.text(pdfMoney(totals.paid, code), right, balanceY, { align: "right" });
      balanceY += 8;
      doc.setFillColor(238, 245, 255); doc.roundedRect(labelX - 3, balanceY - 5, right - labelX + 3, 10, 1.5, 1.5, "F");
      doc.setFontSize(9); doc.setTextColor(8, 101, 219); doc.text("Balance due", labelX, balanceY + 1); doc.text(pdfMoney(totals.balance, code), right - 2, balanceY + 1, { align: "right" });

      let notesY = Math.max(y + 22, balanceY + 14);
      const textSections = [["NOTES", $("notes").value.trim()], ["TERMS", $("terms").value.trim()]].filter(([, text]) => text);
      textSections.forEach(([label, text]) => {
        const lines = doc.splitTextToSize(text, 180);
        const needed = 10 + lines.length * 4;
        if (notesY + needed > 270) { doc.addPage(); notesY = 20; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(128, 140, 156); doc.text(label, margin, notesY);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(74, 89, 109); doc.text(lines, margin, notesY + 6);
        notesY += needed;
      });
      if (notesY + 22 > 270) { doc.addPage(); notesY = 24; }
      const signatureRight = right;
      const signatureLeft = right - 58;
      doc.setDrawColor(174, 185, 198);
      doc.line(signatureLeft, notesY + 8, signatureRight, notesY + 8);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(128, 140, 156);
      doc.text("E SIGNATURE", (signatureLeft + signatureRight) / 2, notesY + 14, { align: "center" });
      doc.setFontSize(9);
      doc.setTextColor(7, 26, 51);
      doc.text($("signatureName").value.trim() || $("billedBy").value.trim() || "Rohan Ferando", (signatureLeft + signatureRight) / 2, notesY + 20, { align: "center" });
      addPdfFooter(doc, pdfBumbiLogo);
      doc.setProperties({ title: `E-Receipt ${$("invoiceNumber").value}`, subject: `E-Receipt for ${$("customerName").value}`, author: $("businessName").value, creator: "InvoiceFlow" });
      triggerDownload(doc.output("blob"), `${safeFilename($("invoiceNumber").value)}-${safeFilename($("customerName").value)}.pdf`);
      showToast("Your professional e-receipt PDF is ready.");
    } catch (error) {
      console.error(error);
      showToast("The e-receipt PDF could not be created. Please try again.", "error");
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  function initialise() {
    const now = new Date();
    const today = isoDate(now);
    $("businessName").value = "WEERAHANNADIGE FAMILY";
    $("billedBy").value = "Rohan Ferando";
    $("signatureName").value = "Rohan Ferando";
    $("issueDate").value = localDateTime(now);
    $("dueDate").value = addDays(today, 14);
    $("notes").value = "Thank you for your business.";
    createItemRow({ description: "", quantity: 1, rate: 0 });
    let draftLoaded = false;
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (draft) { applyData(draft); draftLoaded = true; }
    } catch { /* Start with a fresh receipt if stored data is invalid. */ }
    if (!draftLoaded) $("invoiceNumber").value = nextInvoiceNumber();
    updateLogoViews();
    updatePreview();
    refreshSavedCount();

    fieldIds.forEach(id => { $(id).addEventListener("input", handleChange); $(id).addEventListener("change", handleChange); });
    $("addItemBtn").addEventListener("click", () => { createItemRow(); handleChange(); $("itemsList").lastElementChild.querySelector("input").focus(); });
    $("clearItemsBtn").addEventListener("click", clearAllItems);
    $("generateNumberBtn").addEventListener("click", () => { $("invoiceNumber").value = nextInvoiceNumber(); handleChange(); showToast("A new receipt number was generated."); });
    $("logoInput").addEventListener("change", event => { loadLogo(event.target.files[0]); event.target.value = ""; });
    $("removeLogoBtn").addEventListener("click", () => { logoData = DEFAULT_LOGO; updateLogoViews(); handleChange(); showToast("Default family logo restored."); });
    $("downloadPdfBtn").addEventListener("click", downloadPdf);
    $("printBtn").addEventListener("click", () => { updatePreview(); window.print(); });
    $("newInvoiceBtn").addEventListener("click", () => newInvoice(true));
    $("saveInvoiceBtn").addEventListener("click", saveInvoice);
    $("duplicateReceiptBtn").addEventListener("click", duplicateReceipt);
    $("markPaidBtn").addEventListener("click", markFullAmountPaid);
    $("clearPaymentBtn").addEventListener("click", clearPayment);
    $("savedInvoicesBtn").addEventListener("click", () => { renderSavedInvoices(); $("savedModal").hidden = false; });
    $("closeSavedBtn").addEventListener("click", closeSavedModal);
    $("savedModal").addEventListener("click", event => { if (event.target === $("savedModal")) closeSavedModal(); });
    $("exportBtn").addEventListener("click", exportJson);
    $("importBtn").addEventListener("click", () => $("importInput").click());
    $("importInput").addEventListener("change", event => { importJson(event.target.files[0]); event.target.value = ""; });
    $("mobilePreviewBtn").addEventListener("click", () => $("previewPanel").classList.add("open"));
    $("closePreviewBtn").addEventListener("click", () => $("previewPanel").classList.remove("open"));
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") { closeSavedModal(); $("previewPanel").classList.remove("open"); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); saveInvoice(); }
    });
  }

  initialise();
})();
