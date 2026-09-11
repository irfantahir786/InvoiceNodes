// Tab Navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;
    
    // Update active button
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Show corresponding content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(tabId).classList.add('active');
  });
});

// File Drop Zone
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('file');
const fileInfo = document.getElementById('fileInfo');

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    fileInput.files = files;
    updateFileInfo(files[0]);
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    updateFileInfo(fileInput.files[0]);
  }
});

function updateFileInfo(file) {
  const size = (file.size / 1024 / 1024).toFixed(2);
  fileInfo.textContent = `Selected: ${file.name} (${size} MB)`;
  fileInfo.classList.remove('hidden');
}

// Form Submission
const uploadForm = document.getElementById('uploadForm');
const submitBtn = document.getElementById('submitBtn');
const btnText = submitBtn.querySelector('.btn-text');
const btnLoader = submitBtn.querySelector('.btn-loader');
const uploadError = document.getElementById('uploadError');
const resultsSection = document.getElementById('resultsSection');

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // Reset error
  uploadError.classList.add('hidden');
  resultsSection.classList.add('hidden');
  
  // Get form data
  const formData = new FormData(uploadForm);
  const extractionType = document.getElementById('extractionType').value;
  const file = fileInput.files[0];
  
  if (!file) {
    showError('Please select a file to upload.');
    return;
  }
  
  // Validate file size (10MB max)
  if (file.size > 10 * 1024 * 1024) {
    showError('File size must be less than 10MB.');
    return;
  }
  
  // Set loading state
  setLoading(true);
  
  try {
    const endpoint = extractionType === 'text' 
      ? '/api/invoice/extract-text' 
      : '/api/invoice/extract-ocr';
    
    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
    });
    
    const result = await response.json();
    
    if (response.ok && result.success) {
      displayResults(result.data);
      saveToHistory(file.name, result.data);
    } else {
      showError(result.error?.message || 'Extraction failed. Please try again.');
    }
  } catch (error) {
    console.error('Upload error:', error);
    showError('Network error. Please check your connection and try again.');
  } finally {
    setLoading(false);
  }
});

function setLoading(loading) {
  submitBtn.disabled = loading;
  btnText.classList.toggle('hidden', loading);
  btnLoader.classList.toggle('hidden', !loading);
}

function showError(message) {
  uploadError.textContent = message;
  uploadError.classList.remove('hidden');
}

function resetForm() {
  uploadForm.reset();
  fileInfo.classList.add('hidden');
  resultsSection.classList.add('hidden');
  uploadError.classList.add('hidden');
}

// Display Results
function displayResults(data) {
  resultsSection.classList.remove('hidden');
  
  // Document Info
  const docInfo = document.getElementById('documentInfo');
  docInfo.innerHTML = `
    <p><strong>Type:</strong> <span class="value found">${data.document.type || 'N/A'}</span></p>
    <p><strong>Source:</strong> <span class="value found">${data.document.source || 'N/A'}</span></p>
    <p><strong>Pages:</strong> <span class="value found">${data.document.page_count || 0}</span></p>
  `;
  
  // Invoice Details
  const invoiceDetails = document.getElementById('invoiceDetails');
  const invoice = data.invoice || {};
  invoiceDetails.innerHTML = `
    <p><strong>Invoice Number:</strong> <span class="value ${invoice.invoice_number ? 'found' : 'missing'}">${invoice.invoice_number || 'Not found'}</span></p>
    <p><strong>Date:</strong> <span class="value ${invoice.invoice_date ? 'found' : 'missing'}">${invoice.invoice_date || 'Not found'}</span></p>
    <p><strong>Due Date:</strong> <span class="value ${invoice.due_date ? 'found' : 'missing'}">${invoice.due_date || 'Not found'}</span></p>
    <p><strong>Place of Supply:</strong> <span class="value ${invoice.place_of_supply ? 'found' : 'missing'}">${invoice.place_of_supply || 'Not found'}</span></p>
    <p><strong>Reverse Charge:</strong> <span class="value ${invoice.reverse_charge ? 'found' : 'missing'}">${invoice.reverse_charge || 'Not found'}</span></p>
    <p><strong>E-Way Bill:</strong> <span class="value ${invoice.eway_bill_number ? 'found' : 'missing'}">${invoice.eway_bill_number || 'Not found'}</span></p>
    <p><strong>IRN:</strong> <span class="value ${invoice.irn ? 'found' : 'missing'}">${invoice.irn || 'Not found'}</span></p>
  `;
  
  // Seller Info
  const sellerInfo = document.getElementById('sellerInfo');
  const seller = data.seller || {};
  sellerInfo.innerHTML = `
    <p><strong>Name:</strong> <span class="value ${seller.name ? 'found' : 'missing'}">${seller.name || 'Not found'}</span></p>
    <p><strong>GSTIN:</strong> <span class="value ${seller.gstin ? 'found' : 'missing'}">${seller.gstin || 'Not found'}</span></p>
    <p><strong>PAN:</strong> <span class="value ${seller.pan ? 'found' : 'missing'}">${seller.pan || 'Not found'}</span></p>
    <p><strong>Address:</strong> <span class="value ${seller.address ? 'found' : 'missing'}">${seller.address || 'Not found'}</span></p>
    <p><strong>Phone:</strong> <span class="value ${seller.phone ? 'found' : 'missing'}">${seller.phone || 'Not found'}</span></p>
    <p><strong>Email:</strong> <span class="value ${seller.email ? 'found' : 'missing'}">${seller.email || 'Not found'}</span></p>
    <p><strong>State:</strong> <span class="value ${seller.state ? 'found' : 'missing'}">${seller.state || 'Not found'}</span></p>
    <p><strong>State Code:</strong> <span class="value ${seller.state_code ? 'found' : 'missing'}">${seller.state_code || 'Not found'}</span></p>
  `;
  
  // Buyer Info
  const buyerInfo = document.getElementById('buyerInfo');
  const buyer = data.buyer || {};
  buyerInfo.innerHTML = `
    <p><strong>Name:</strong> <span class="value ${buyer.name ? 'found' : 'missing'}">${buyer.name || 'Not found'}</span></p>
    <p><strong>GSTIN:</strong> <span class="value ${buyer.gstin ? 'found' : 'missing'}">${buyer.gstin || 'Not found'}</span></p>
    <p><strong>PAN:</strong> <span class="value ${buyer.pan ? 'found' : 'missing'}">${buyer.pan || 'Not found'}</span></p>
    <p><strong>Address:</strong> <span class="value ${buyer.address ? 'found' : 'missing'}">${buyer.address || 'Not found'}</span></p>
    <p><strong>Phone:</strong> <span class="value ${buyer.phone ? 'found' : 'missing'}">${buyer.phone || 'Not found'}</span></p>
    <p><strong>Email:</strong> <span class="value ${buyer.email ? 'found' : 'missing'}">${buyer.email || 'Not found'}</span></p>
    <p><strong>State:</strong> <span class="value ${buyer.state ? 'found' : 'missing'}">${buyer.state || 'Not found'}</span></p>
    <p><strong>State Code:</strong> <span class="value ${buyer.state_code ? 'found' : 'missing'}">${buyer.state_code || 'Not found'}</span></p>
  `;
  
  // Totals
  const totalsInfo = document.getElementById('totalsInfo');
  const totals = data.totals || {};
  totalsInfo.innerHTML = `
    <p><strong>Subtotal:</strong> <span class="value ${totals.subtotal !== null ? 'found' : 'missing'}">${formatCurrency(totals.subtotal)}</span></p>
    <p><strong>Discount:</strong> <span class="value ${totals.discount !== null ? 'found' : 'missing'}">${formatCurrency(totals.discount)}</span></p>
    <p><strong>Taxable Value:</strong> <span class="value ${totals.taxable_value !== null ? 'found' : 'missing'}">${formatCurrency(totals.taxable_value)}</span></p>
    <p><strong>CGST:</strong> <span class="value ${totals.cgst !== null ? 'found' : 'missing'}">${formatCurrency(totals.cgst)}</span></p>
    <p><strong>SGST:</strong> <span class="value ${totals.sgst !== null ? 'found' : 'missing'}">${formatCurrency(totals.sgst)}</span></p>
    <p><strong>IGST:</strong> <span class="value ${totals.igst !== null ? 'found' : 'missing'}">${formatCurrency(totals.igst)}</span></p>
    <p><strong>Cess:</strong> <span class="value ${totals.cess !== null ? 'found' : 'missing'}">${formatCurrency(totals.cess)}</span></p>
    <p><strong>Round Off:</strong> <span class="value ${totals.round_off !== null ? 'found' : 'missing'}">${formatCurrency(totals.round_off)}</span></p>
    <p><strong>Grand Total:</strong> <span class="value ${totals.grand_total !== null ? 'found' : 'missing'}">${formatCurrency(totals.grand_total)}</span></p>
    <p><strong>Amount Paid:</strong> <span class="value ${totals.amount_paid !== null ? 'found' : 'missing'}">${formatCurrency(totals.amount_paid)}</span></p>
    <p><strong>Balance Due:</strong> <span class="value ${totals.balance_due !== null ? 'found' : 'missing'}">${formatCurrency(totals.balance_due)}</span></p>
  `;
  
  // Items Table
  const itemsBody = document.getElementById('itemsBody');
  const itemCount = document.getElementById('itemCount');
  const items = data.items || [];
  itemCount.textContent = items.length;
  
  if (items.length === 0) {
    itemsBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #6c757d;">No line items detected</td></tr>';
  } else {
    itemsBody.innerHTML = items.map(item => `
      <tr>
        <td>${escapeHtml(item.description || '-')}</td>
        <td>${item.hsn || item.sac || '-'}</td>
        <td>${item.quantity !== null ? item.quantity : '-'}</td>
        <td>${item.rate !== null ? formatCurrency(item.rate) : '-'}</td>
        <td>${item.taxable_value !== null ? formatCurrency(item.taxable_value) : '-'}</td>
        <td>${formatGst(item)}</td>
        <td>${item.total !== null ? formatCurrency(item.total) : '-'}</td>
      </tr>
    `).join('');
  }
  
  // Warnings
  const warningsSection = document.getElementById('warningsSection');
  const warningsList = document.getElementById('warningsList');
  const warnings = data.warnings || [];
  
  if (warnings.length > 0) {
    warningsSection.classList.remove('hidden');
    warningsList.innerHTML = warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('');
  } else {
    warningsSection.classList.add('hidden');
  }
  
  // Confidence
  const confidence = data.confidence || {};
  const overallConfidence = Math.round((confidence.overall || 0) * 100);
  const confidenceFill = document.getElementById('confidenceFill');
  const confidenceValue = document.getElementById('confidenceValue');
  
  confidenceFill.style.width = `${overallConfidence}%`;
  confidenceValue.textContent = `${overallConfidence}%`;
  
  // Color code confidence
  if (overallConfidence >= 80) {
    confidenceFill.style.background = 'linear-gradient(90deg, #27ae60 0%, #2ecc71 100%)';
    confidenceValue.style.color = '#27ae60';
  } else if (overallConfidence >= 50) {
    confidenceFill.style.background = 'linear-gradient(90deg, #f39c12 0%, #f1c40f 100%)';
    confidenceValue.style.color = '#f39c12';
  } else {
    confidenceFill.style.background = 'linear-gradient(90deg, #e74c3c 0%, #c0392b 100%)';
    confidenceValue.style.color = '#e74c3c';
  }
  
  // Raw JSON
  document.getElementById('rawJson').textContent = JSON.stringify(data, null, 2);
  
  // Scroll to results
  resultsSection.scrollIntoView({ behavior: 'smooth' });
}

function formatCurrency(value) {
  if (value === null || value === undefined) return '-';
  return `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatGst(item) {
  const parts = [];
  if (item.cgst_rate !== null) parts.push(`CGST ${item.cgst_rate}%`);
  if (item.sgst_rate !== null) parts.push(`SGST ${item.sgst_rate}%`);
  if (item.igst_rate !== null) parts.push(`IGST ${item.igst_rate}%`);
  if (item.gst_rate !== null && !parts.length) parts.push(`GST ${item.gst_rate}%`);
  
  if (parts.length === 0) return '-';
  return parts.join(' + ');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function copyJson() {
  const jsonText = document.getElementById('rawJson').textContent;
  navigator.clipboard.writeText(jsonText).then(() => {
    alert('JSON copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

// History Management
function saveToHistory(filename, data) {
  let history = JSON.parse(localStorage.getItem('invoiceHistory') || '[]');
  
  const entry = {
    id: Date.now(),
    filename,
    timestamp: new Date().toISOString(),
    confidence: data.confidence?.overall || 0,
    invoiceNumber: data.invoice?.invoice_number,
    grandTotal: data.totals?.grand_total,
    data
  };
  
  history.unshift(entry);
  history = history.slice(0, 10); // Keep last 10
  
  localStorage.setItem('invoiceHistory', JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const historyList = document.getElementById('historyList');
  const history = JSON.parse(localStorage.getItem('invoiceHistory') || '[]');
  
  if (history.length === 0) {
    historyList.innerHTML = '<p class="empty-state">No recent extractions yet.</p>';
    return;
  }
  
  historyList.innerHTML = history.map(item => {
    const confidenceClass = item.confidence >= 0.8 ? 'confidence-high' : 
                           item.confidence >= 0.5 ? 'confidence-medium' : 'confidence-low';
    const confidencePercent = Math.round(item.confidence * 100);
    
    return `
      <div class="history-item" onclick="loadHistoryItem(${item.id})">
        <div class="filename">📄 ${escapeHtml(item.filename)}</div>
        <div class="meta">
          ${new Date(item.timestamp).toLocaleString()} • 
          Invoice: ${item.invoiceNumber || 'N/A'} • 
          Total: ${formatCurrency(item.grandTotal)}
        </div>
        <span class="confidence-badge ${confidenceClass}">${confidencePercent}% confidence</span>
      </div>
    `;
  }).join('');
}

function loadHistoryItem(id) {
  const history = JSON.parse(localStorage.getItem('invoiceHistory') || '[]');
  const item = history.find(h => h.id === id);
  
  if (item) {
    displayResults(item.data);
    document.querySelector('[data-tab="upload"]').click();
    resultsSection.classList.remove('hidden');
    resultsSection.scrollIntoView({ behavior: 'smooth' });
  }
}

function clearHistory() {
  if (confirm('Are you sure you want to clear all history?')) {
    localStorage.removeItem('invoiceHistory');
    renderHistory();
  }
}

// Initialize
renderHistory();
