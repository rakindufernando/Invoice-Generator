(() => {
  "use strict";

  const DRAFT_KEY = "invoiceflow_draft_v2";
  const SAVED_KEY = "invoiceflow_saved_v2";
  const COUNTER_KEY = "invoiceflow_counter_v2";
  const $ = id => document.getElementById(id);
  const fieldIds = [
    "businessName", "businessEmail", "businessPhone", "taxNumber", "businessAddress",
    "customerName", "customerEmail", "customerAddress", "invoiceNumber", "currency",
    "issueDate", "dueDate", "status", "paymentMethod", "discountType", "discountValue",
    "taxPercent", "shipping", "amountPaid", "notes", "terms"
  ];
  const currencyInfo = {
    LKR: { symbol: "Rs.", label: "LKR" }, USD: { symbol: "$", label: "USD" },
    EUR: { symbol: "€", label: "EUR" }, GBP: { symbol: "£", label: "GBP" },
    AUD: { symbol: "A$", label: "AUD" }, CAD: { symbol: "C$", label: "CAD" },
    INR: { symbol: "₹", label: "INR" }
  };
  let logoData = "";
  let autosaveTimer;
  let toastTimer;

  const safeNumber = value => Math.max(0, Number(value) || 0);
  const isoDate = date => date.toISOString().slice(0, 10);
  const addDays = (dateString, days) => {
    const date = new Date(`${dateString}T12:00:00`);
    date.setDate(date.getDate() + days);
    return isoDate(date);
  };
  const formatDate = value => value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "Not set";
  const formatMoney = (value, code = $("currency").value) => {
    const info = currencyInfo[code] || { symbol: code, label: code };
    const number = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safeNumber(value));
    return `${info.symbol} ${number}`;
  };
  const pdfMoney = (value, code) => `${currencyInfo[code]?.label || code} ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safeNumber(value))}`;
  const joinLines = values => values.filter(Boolean).join("\n");
  const safeFilename = value => (value || "invoice").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 70) || "invoice";

  function showToast(message, type = "success") {
    clearTimeout(toastTimer);
    const toast = $("toast");
    toast.textContent = message;
    toast.className = `toast show${type === "error" ? " error" : ""}`;
    toastTimer = setTimeout(() => { toast.className = "toast"; }, 2800);
  }

  function nextInvoiceNumber(increment = false) {
    let counter = Number(localStorage.getItem(COUNTER_KEY) || 1);
    const now = new Date();
    const number = `INV-${now.getFullYear()}-${String(counter).padStart(4, "0")}`;
    if (increment) localStorage.setItem(COUNTER_KEY, String(counter + 1));
    return number;
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
    const discountInput = safeNumber($("discountValue").value);
    const discount = $("discountType").value === "percentage" ? subtotal * Math.min(discountInput, 100) / 100 : Math.min(discountInput, subtotal);
    const taxable = Math.max(0, subtotal - discount);
    const tax = taxable * Math.min(safeNumber($("taxPercent").value), 100) / 100;
    const shipping = safeNumber($("shipping").value);
    const total = Math.max(0, taxable + tax + shipping);
    const paid = Math.min(safeNumber($("amountPaid").value), total);
    return { subtotal, discount, taxable, tax, shipping, total, paid, balance: Math.max(0, total - paid) };
  }

  function setText(id, value) { $(id).textContent = value; }
  function toggleRow(id, visible) { $(id).hidden = !visible; }

  function updatePreview() {
    const items = getItems();
    const totals = getTotals(items);
    const code = $("currency").value;

    document.querySelectorAll(".item-row").forEach((row, index) => {
      row.querySelector(".line-amount").textContent = formatMoney(items[index].amount, code);
    });
    [
      ["editorSubtotal", totals.subtotal], ["editorDiscount", totals.discount], ["editorTax", totals.tax],
      ["editorShipping", totals.shipping], ["editorTotal", totals.total], ["editorBalance", totals.balance],
      ["previewSubtotal", totals.subtotal], ["previewDiscount", totals.discount], ["previewTax", totals.tax],
      ["previewShipping", totals.shipping], ["previewTotal", totals.total], ["previewPaid", totals.paid],
      ["previewBalance", totals.balance]
    ].forEach(([id, value]) => setText(id, formatMoney(value, code)));

    setText("previewBusinessName", $("businessName").value.trim() || "Your business");
    setText("previewBusinessDetails", joinLines([$("businessAddress").value.trim(), $("businessEmail").value.trim(), $("businessPhone").value.trim(), $("taxNumber").value.trim() && `Registration: ${$("taxNumber").value.trim()}`]));
    setText("previewCustomerName", $("customerName").value.trim() || "Customer name");
    setText("previewCustomerDetails", joinLines([$("customerAddress").value.trim(), $("customerEmail").value.trim()]));
    setText("previewInvoiceNumber", $("invoiceNumber").value.trim() || "Not set");
    setText("previewIssueDate", formatDate($("issueDate").value));
    setText("previewDueDate", formatDate($("dueDate").value));
    setText("previewPaymentMethod", $("paymentMethod").value);
    setText("previewNotes", $("notes").value.trim());
    setText("previewTerms", $("terms").value.trim());

    const status = $("status").value;
    const badge = $("previewStatus");
    badge.textContent = status;
    badge.className = `status-badge ${status.toLowerCase().replaceAll(" ", "-")}`;
    toggleRow("previewDiscountRow", totals.discount > 0);
    toggleRow("previewTaxRow", totals.tax > 0);
    toggleRow("previewShippingRow", totals.shipping > 0);
    toggleRow("previewPaidRow", totals.paid > 0);
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
    if (!data || typeof data !== "object") throw new Error("Invalid invoice data");
    fieldIds.forEach(id => { if (data[id] !== undefined) $(id).value = String(data[id]); });
    logoData = typeof data.logoData === "string" ? data.logoData : "";
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
      image.src = logoData || "";
      image.hidden = !logoData;
    });
    $("logoUploadContent").hidden = Boolean(logoData);
    $("removeLogoBtn").hidden = !logoData;
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
    if ($("dueDate").value && $("issueDate").value && $("dueDate").value < $("issueDate").value) invalid.push("dueDate");
    const validItems = getItems().filter(item => item.description && item.quantity > 0);
    if (!validItems.length) {
      $("itemsList").querySelector(".item-description")?.classList.add("invalid");
      showToast("Add at least one item with a description and quantity.", "error");
      return false;
    }
    if (invalid.length) {
      [...new Set(invalid)].forEach(id => $(id).classList.add("invalid"));
      $(invalid[0]).focus();
      showToast(invalid.includes("dueDate") ? "The due date cannot be before the issue date." : "Please complete the highlighted invoice details.", "error");
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
      showToast(index >= 0 ? "Saved invoice updated." : "Invoice saved in this browser.");
    } catch { showToast("The invoice could not be saved. Try removing a large logo.", "error"); }
  }

  function renderSavedInvoices() {
    const list = $("savedList");
    list.replaceChildren();
    const invoices = savedInvoices();
    if (!invoices.length) {
      const empty = document.createElement("div");
      empty.className = "empty-saved";
      empty.textContent = "No saved invoices yet.";
      list.appendChild(empty);
      return;
    }
    invoices.forEach((invoice, index) => {
      const card = document.createElement("article");
      card.className = "saved-card";
      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = invoice.invoiceNumber || "Untitled invoice";
      const meta = document.createElement("small");
      meta.textContent = `${invoice.customerName || "No customer"} · ${formatDate(invoice.issueDate)}`;
      info.append(title, meta);
      const actions = document.createElement("div");
      const load = document.createElement("button");
      load.type = "button";
      load.textContent = "Load";
      load.addEventListener("click", () => { applyData(invoice); closeSavedModal(); showToast("Invoice loaded."); });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-saved";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => {
        if (!confirm(`Delete ${invoice.invoiceNumber || "this invoice"}?`)) return;
        const updated = savedInvoices();
        updated.splice(index, 1);
        localStorage.setItem(SAVED_KEY, JSON.stringify(updated));
        refreshSavedCount();
        renderSavedInvoices();
        showToast("Saved invoice deleted.");
      });
      actions.append(load, remove);
      card.append(info, actions);
      list.appendChild(card);
    });
  }

  function closeSavedModal() { $("savedModal").hidden = true; }

  function exportJson() {
    const blob = new Blob([JSON.stringify(collectData(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFilename($("invoiceNumber").value)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Invoice data exported.");
  }

  function importJson(file) {
    if (!file || file.size > 5 * 1024 * 1024) { showToast("Select a valid JSON file under 5 MB.", "error"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try { applyData(JSON.parse(String(reader.result))); showToast("Invoice data imported."); }
      catch { showToast("This file does not contain valid invoice data.", "error"); }
    };
    reader.readAsText(file);
  }

  function newInvoice(confirmFirst = true) {
    if (confirmFirst && !confirm("Start a new invoice? Your autosaved draft will be replaced.")) return;
    const today = isoDate(new Date());
    const keepBusiness = {
      businessName: $("businessName").value, businessEmail: $("businessEmail").value,
      businessPhone: $("businessPhone").value, taxNumber: $("taxNumber").value,
      businessAddress: $("businessAddress").value, logoData
    };
    fieldIds.forEach(id => { $(id).value = ""; });
    Object.entries(keepBusiness).forEach(([id, value]) => { if (id !== "logoData") $(id).value = value; });
    logoData = keepBusiness.logoData;
    $("invoiceNumber").value = nextInvoiceNumber(true);
    $("currency").value = "LKR";
    $("issueDate").value = today;
    $("dueDate").value = addDays(today, 14);
    $("status").value = "Unpaid";
    $("paymentMethod").value = "Bank transfer";
    $("discountType").value = "percentage";
    $("discountValue").value = "0";
    $("taxPercent").value = "0";
    $("shipping").value = "0";
    $("amountPaid").value = "0";
    $("notes").value = "Thank you for your business.";
    $("itemsList").replaceChildren();
    createItemRow();
    updateLogoViews();
    handleChange();
  }

  function addPdfFooter(doc) {
    const pages = doc.internal.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      const width = doc.internal.pageSize.getWidth();
      const height = doc.internal.pageSize.getHeight();
      doc.setDrawColor(226, 232, 239);
      doc.line(14, height - 15, width - 14, height - 15);
      doc.setTextColor(120, 133, 150);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("Generated with InvoiceFlow", 14, height - 9);
      doc.text(`Page ${page} of ${pages}`, width - 14, height - 9, { align: "right" });
    }
  }

  function downloadPdf() {
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
      if (logoData) {
        try {
          const format = logoData.includes("image/png") ? "PNG" : "JPEG";
          doc.addImage(logoData, format, margin, 16, 24, 20, undefined, "FAST");
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
      doc.setFontSize(25);
      doc.text("INVOICE", right, 20, { align: "right" });
      doc.setFontSize(9);
      doc.setTextColor(20, 121, 255);
      doc.text($("status").value.toUpperCase(), right, 27, { align: "right" });

      doc.setDrawColor(220, 229, 239);
      doc.line(margin, 43, right, 43);
      doc.setTextColor(128, 140, 156);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      doc.text("BILL TO", margin, 51);
      doc.setTextColor(23, 36, 56);
      doc.setFontSize(10.5);
      doc.text($("customerName").value.trim(), margin, 58);
      doc.setTextColor(90, 105, 124);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text(doc.splitTextToSize(joinLines([$("customerAddress").value.trim(), $("customerEmail").value.trim()]), 88), margin, 64);

      const metaX = 130;
      const meta = [["Invoice number", $("invoiceNumber").value.trim()], ["Issue date", formatDate($("issueDate").value)], ["Due date", formatDate($("dueDate").value)]];
      meta.forEach(([label, value], index) => {
        const y = 50 + index * 7;
        doc.setFont("helvetica", "normal"); doc.setTextColor(112, 126, 144); doc.text(label, metaX, y);
        doc.setFont("helvetica", "bold"); doc.setTextColor(23, 36, 56); doc.text(String(value), right, y, { align: "right" });
      });

      doc.autoTable({
        startY: 82,
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
      const summaryHeight = 51 + (totals.paid > 0 ? 6 : 0);
      if (y + summaryHeight > 272) { doc.addPage(); y = 20; }
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(128, 140, 156);
      doc.text("PAYMENT METHOD", margin, y + 2);
      doc.setTextColor(23, 36, 56);
      doc.text($("paymentMethod").value, margin, y + 8);
      const labelX = 132;
      const summaryRows = [["Subtotal", totals.subtotal], ["Discount", totals.discount], ["Tax", totals.tax], ["Shipping", totals.shipping]];
      summaryRows.forEach(([label, value], index) => {
        const rowY = y + index * 6;
        doc.setFont("helvetica", "normal"); doc.setTextColor(102, 116, 134); doc.text(label, labelX, rowY);
        doc.setFont("helvetica", "bold"); doc.setTextColor(23, 36, 56); doc.text(pdfMoney(value, code), right, rowY, { align: "right" });
      });
      const totalY = y + 27;
      doc.setDrawColor(190, 202, 215); doc.line(labelX, totalY - 4, right, totalY - 4);
      doc.setFontSize(11); doc.setTextColor(7, 26, 51); doc.text("Total", labelX, totalY); doc.text(pdfMoney(totals.total, code), right, totalY, { align: "right" });
      let balanceY = totalY + 8;
      if (totals.paid > 0) {
        doc.setFontSize(8); doc.setTextColor(102, 116, 134); doc.text("Amount paid", labelX, balanceY); doc.setTextColor(23, 36, 56); doc.text(pdfMoney(totals.paid, code), right, balanceY, { align: "right" });
        balanceY += 8;
      }
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
      addPdfFooter(doc);
      doc.setProperties({ title: `Invoice ${$("invoiceNumber").value}`, subject: `Invoice for ${$("customerName").value}`, author: $("businessName").value, creator: "InvoiceFlow" });
      doc.save(`${safeFilename($("invoiceNumber").value)}-${safeFilename($("customerName").value)}.pdf`);
      showToast("Your professional PDF is ready.");
    } catch (error) {
      console.error(error);
      showToast("The PDF could not be created. Please try again.", "error");
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  function initialise() {
    const today = isoDate(new Date());
    $("issueDate").value = today;
    $("dueDate").value = addDays(today, 14);
    $("invoiceNumber").value = nextInvoiceNumber(false);
    $("notes").value = "Thank you for your business.";
    createItemRow({ description: "", quantity: 1, rate: 0 });
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (draft) applyData(draft);
    } catch { /* Start with a fresh invoice if stored data is invalid. */ }
    updatePreview();
    refreshSavedCount();

    fieldIds.forEach(id => { $(id).addEventListener("input", handleChange); $(id).addEventListener("change", handleChange); });
    $("addItemBtn").addEventListener("click", () => { createItemRow(); handleChange(); $("itemsList").lastElementChild.querySelector("input").focus(); });
    $("generateNumberBtn").addEventListener("click", () => { $("invoiceNumber").value = nextInvoiceNumber(true); handleChange(); });
    $("logoInput").addEventListener("change", event => { loadLogo(event.target.files[0]); event.target.value = ""; });
    $("removeLogoBtn").addEventListener("click", () => { logoData = ""; updateLogoViews(); handleChange(); });
    $("downloadPdfBtn").addEventListener("click", downloadPdf);
    $("printBtn").addEventListener("click", () => { updatePreview(); window.print(); });
    $("newInvoiceBtn").addEventListener("click", () => newInvoice(true));
    $("saveInvoiceBtn").addEventListener("click", saveInvoice);
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
