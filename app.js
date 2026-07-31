import {
  openDatabase, put, getAll, count, setMeta, getMeta, setCompany, getCompany,
  enqueue, listOutbox, remove, bulkPut, pendingEntityIds, logSync, getSyncLog,
  sanitizeRestrictedData, uuid
} from './db.js';
import { Api, getBackendUrl, setBackendUrl } from './api.js';
import { downloadQuotationPdf, downloadQuotationXlsx, downloadQuotationDocx } from './documents.js';

const $ = id => document.getElementById(id);
const state = {
  session: null,
  company: {},
  projectLines: [],
  repairLines: [],
  installPrompt: null,
  syncRunning: false,
  deviceId: ''
};

const defaultCompany = {
  companyName: 'TONEXT TECH',
  tagline: 'I.T. Solutions & Repair Services',
  address: 'Peñano Street, Calinan Pob., Davao City',
  contact: '0955 372 8640',
  email: 'tonexttech@gmail.com',
  facebook: 'facebook.com/tonexttech',
  bankName: 'BDO Calinan',
  accountName: 'TONEXTTECH I.T. AND ELECTRONICS REPAIR SERVICES',
  accountNumber: '010990144739',
  projectWarranty: '1 Year',
  repairWarranty: 'Up to 3 Months'
};

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('online', async () => { updateNetworkUi(); toast('Internet connection restored.'); await refreshPendingCount(); });
window.addEventListener('offline', () => { updateNetworkUi(); toast('Offline mode: changes will stay on this device until synced.'); });
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  state.installPrompt = event;
  $('installButton').hidden = false;
});

async function init() {
  await openDatabase();
  state.deviceId = await getMeta('deviceId') || uuid('DEV');
  await setMeta('deviceId', state.deviceId);
  state.company = { ...defaultCompany, ...(await getCompany()) };
  bindEvents();
  updateNetworkUi();
  await registerServiceWorker();

  const cached = await getMeta('session');
  const endpoint = getBackendUrl();
  $('backendUrl').value = endpoint;
  $('settingsBackendUrl').value = endpoint;

  if (cached) {
    state.session = cached;
    $('offlineContinueButton').hidden = false;
    $('offlineContinueButton').textContent = `Continue as ${cached.name} (${cached.role})`;
    if (!navigator.onLine) await enterApp(true);
  }
  await refreshPendingCount();
}

function bindEvents() {
  $('loginButton').addEventListener('click', login);
  $('offlineContinueButton').addEventListener('click', () => enterApp(true));
  $('logoutButton').addEventListener('click', logout);
  $('syncNowTop').addEventListener('click', fullSync);
  $('installButton').addEventListener('click', installApp);

  document.querySelectorAll('#mainNav button').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));

  $('newCustomerButton').addEventListener('click', () => openCustomerForm());
  $('cancelCustomerButton').addEventListener('click', closeCustomerForm);
  $('saveCustomerButton').addEventListener('click', saveCustomer);
  $('customerSearch').addEventListener('input', renderCustomers);

  $('newItemButton').addEventListener('click', () => openItemForm());
  $('cancelItemButton').addEventListener('click', closeItemForm);
  $('saveItemButton').addEventListener('click', saveItem);
  $('itemSearch').addEventListener('input', renderItems);

  $('newPartButton').addEventListener('click', () => openPartForm());
  $('cancelPartButton').addEventListener('click', closePartForm);
  $('savePartButton').addEventListener('click', savePart);
  $('partSearch').addEventListener('input', renderParts);

  $('addProjectItemButton').addEventListener('click', addSelectedProjectItem);
  $('addProjectManualButton').addEventListener('click', () => addProjectLine({ description: 'Manual item', quantity: 1, unit: 'Per Unit', unitPrice: 0, dealerPrice: 0 }));
  $('projectLines').addEventListener('input', updateProjectLineFromEvent);
  $('projectLines').addEventListener('click', removeProjectLineFromEvent);
  ['projectLaborPercent','projectManualLabor','projectDiscount','projectDownpaymentPercent'].forEach(id => $(id).addEventListener('input', renderProjectTotals));
  $('saveProjectQuoteButton').addEventListener('click', saveProjectQuote);

  $('addRepairPartButton').addEventListener('click', addSelectedRepairPart);
  $('addRepairManualButton').addEventListener('click', () => addRepairLine({ description: 'Manual repair item', quantity: 1, unitPrice: 0, labor: 0 }));
  $('repairLines').addEventListener('input', updateRepairLineFromEvent);
  $('repairLines').addEventListener('click', removeRepairLineFromEvent);
  $('saveRepairQuoteButton').addEventListener('click', saveRepairQuote);

  $('historySearch').addEventListener('input', renderHistory);
  $('historyList').addEventListener('click', handleHistoryAction);
  $('customerList').addEventListener('click', handleCustomerAction);
  $('itemList').addEventListener('click', handleItemAction);
  $('partList').addEventListener('click', handlePartAction);

  $('pushButton').addEventListener('click', pushOutbox);
  $('pullButton').addEventListener('click', pullLatest);
  $('fullSyncButton').addEventListener('click', fullSync);

  $('createUserButton').addEventListener('click', createUser);
  $('refreshUsersButton').addEventListener('click', loadUsers);

  $('saveSettingsButton').addEventListener('click', saveSettings);
  $('saveBackendButton').addEventListener('click', saveBackendSetting);
  $('requestStorageButton').addEventListener('click', requestPersistentStorage);
  $('changePasswordButton').addEventListener('click', changeMyPassword);
}

async function login() {
  const username = $('username').value.trim();
  const password = $('password').value;
  const backend = $('backendUrl').value.trim();
  $('loginMessage').textContent = 'Signing in…';

  try {
    setBackendUrl(backend);
    const result = await Api.login(username, password, state.deviceId);
    state.session = result.session;
    state.session.token = result.token;
    state.session.cachedAt = new Date().toISOString();
    await setMeta('session', state.session);
    $('password').value = '';
    $('loginMessage').textContent = '';
    await enterApp(false);
    await fullSync();
  } catch (error) {
    $('loginMessage').textContent = error.message;
  }
}

async function enterApp(offlineSession) {
  if (!state.session) return;
  await sanitizeRestrictedData(state.session.role);
  $('loginView').hidden = true;
  $('appView').hidden = false;
  $('logoutButton').hidden = false;
  $('loggedUser').textContent = `${state.session.name} • ${state.session.role}`;
  $('offlineSessionText').textContent = offlineSession ? ' — Offline cached session' : '';
  applyRoleUi();
  await loadAllViews();
  showPage('dashboard');
}

async function logout() {
  state.session = null;
  await setMeta('session', null);
  $('appView').hidden = true;
  $('loginView').hidden = false;
  $('logoutButton').hidden = true;
  $('offlineContinueButton').hidden = true;
  toast('Signed out. Offline business data remains stored on this device.');
}

function applyRoleUi() {
  const role = state.session.role;
  document.querySelectorAll('[data-roles]').forEach(element => {
    const roles = element.dataset.roles.split(',');
    element.hidden = !roles.includes(role);
  });
  document.querySelectorAll('.admin-only').forEach(element => element.hidden = role !== 'Administrator');
  document.querySelectorAll('.admin-cost').forEach(element => element.hidden = role !== 'Administrator');
  $('newCustomerButton').hidden = !['Administrator','Sales'].includes(role);
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(page => page.hidden = true);
  const page = $(`page-${name}`);
  if (!page) return;
  page.hidden = false;
  document.querySelectorAll('#mainNav button').forEach(button => button.classList.toggle('active', button.dataset.page === name));

  const renderers = {
    dashboard: renderDashboard,
    customers: renderCustomers,
    items: renderItems,
    parts: renderParts,
    project: prepareProjectQuote,
    repair: prepareRepairQuote,
    history: renderHistory,
    users: loadUsers,
    sync: renderSyncCenter,
    settings: renderSettings
  };
  renderers[name]?.();
}

async function loadAllViews() {
  await Promise.all([renderDashboard(), renderCustomers(), renderItems(), renderParts(), renderHistory(), refreshPendingCount()]);
  await populatePickers();
}

async function renderDashboard() {
  const [customers, items, parts, projects, repairs, pending] = await Promise.all([
    count('customers'), count('items'), count('repairParts'), count('projectQuotes'), count('repairQuotes'), count('outbox')
  ]);
  $('metricCustomers').textContent = customers;
  $('metricItems').textContent = items;
  $('metricParts').textContent = parts;
  $('metricProjects').textContent = projects;
  $('metricRepairs').textContent = repairs;
  $('metricPending').textContent = pending;
  $('dashboardSubtitle').textContent = navigator.onLine ? 'Online — ready to synchronize.' : 'Offline — all supported functions use the local device database.';
}

async function refreshPendingCount() {
  const pending = await count('outbox');
  $('pendingBadge').textContent = `${pending} pending`;
  $('metricPending').textContent = pending;
  $('syncPending').textContent = pending;
}

function updateNetworkUi() {
  const online = navigator.onLine;
  $('networkBadge').textContent = online ? 'Online' : 'Offline';
  $('networkBadge').className = `badge ${online ? 'badge-online' : 'badge-offline'}`;
  $('syncConnection').textContent = online ? 'Online' : 'Offline';
}

function openCustomerForm(customer = {}) {
  if (!['Administrator','Sales'].includes(state.session.role)) return toast('Your role has read-only customer access.');
  $('customerForm').hidden = false;
  $('customerFormTitle').textContent = customer.id ? 'Edit Customer' : 'New Customer';
  $('customerId').value = customer.id || '';
  $('customerType').value = customer.customerType || 'Walk-in';
  $('customerName').value = customer.customerName || '';
  $('customerCompany').value = customer.company || '';
  $('customerContact').value = customer.contact || '';
  $('customerEmail').value = customer.email || '';
  $('customerTin').value = customer.tin || '';
  $('customerAddress').value = customer.address || '';
  $('customerNotes').value = customer.notes || '';
  $('customerName').focus();
}
function closeCustomerForm() { $('customerForm').hidden = true; }

async function saveCustomer() {
  const name = $('customerName').value.trim();
  if (!name) return toast('Customer name is required.');
  const id = $('customerId').value || uuid('CUS');
  const record = {
    id,
    customerType: $('customerType').value,
    customerName: name,
    company: $('customerCompany').value.trim(),
    address: $('customerAddress').value.trim(),
    contact: $('customerContact').value.trim(),
    email: $('customerEmail').value.trim(),
    tin: $('customerTin').value.trim(),
    notes: $('customerNotes').value.trim(),
    updatedAt: new Date().toISOString(),
    updatedBy: state.session.username,
    syncStatus: 'pending'
  };
  await put('customers', record);
  await enqueue({ type: 'upsertCustomer', entityId: id, payload: record });
  closeCustomerForm();
  await renderCustomers();
  await populatePickers();
  await refreshPendingCount();
  toast('Customer saved locally.');
}

async function renderCustomers() {
  const query = normalize($('customerSearch').value);
  const rows = (await getAll('customers')).filter(customer => normalize(Object.values(customer).join(' ')).includes(query));
  rows.sort((a,b) => String(a.customerName).localeCompare(String(b.customerName)));
  $('customerList').innerHTML = rows.length ? rows.map(customer => `
    <article class="record-card">
      <h3>${escapeHtml(customer.customerName)}</h3>
      <div class="record-meta"><span>${escapeHtml(customer.customerType || '')}</span><span>${escapeHtml(customer.contact || '')}</span><span>${customer.syncStatus === 'pending' ? 'Pending sync' : 'Synced'}</span></div>
      <p>${escapeHtml(customer.company || '')}</p><p>${escapeHtml(customer.address || '')}</p>
      ${['Administrator','Sales'].includes(state.session?.role) ? `<div class="record-actions"><button class="button button-secondary button-small" data-edit-customer="${customer.id}">Edit</button></div>` : ''}
    </article>`).join('') : emptyState('No customers found.');
}

async function handleCustomerAction(event) {
  const id = event.target.dataset.editCustomer;
  if (!id) return;
  const customer = (await getAll('customers')).find(row => row.id === id);
  if (customer) openCustomerForm(customer);
}

function openItemForm(item = {}) {
  if (state.session.role !== 'Administrator') return;
  $('itemForm').hidden = false;
  $('itemId').value = item.id || '';
  $('itemCategory').value = item.category || '';
  $('itemName').value = item.itemName || '';
  $('itemBrand').value = item.brand || '';
  $('itemModel').value = item.model || '';
  $('itemUnit').value = item.pricingUnit || 'Per Unit';
  $('itemSupplier').value = item.supplier || '';
  $('itemDealer').value = item.dealerPrice ?? '';
  $('itemSrp').value = item.srp ?? '';
  $('itemStock').value = item.stock ?? 0;
  $('itemWarranty').value = item.warranty || '';
  $('itemReorder').value = item.reorderLevel ?? 0;
  $('itemLocation').value = item.location || '';
  $('itemRemarks').value = item.remarks || '';
}
function closeItemForm() { $('itemForm').hidden = true; }

async function saveItem() {
  const name = $('itemName').value.trim();
  if (!name) return toast('Item name is required.');
  const id = $('itemId').value || uuid('ITEM');
  const record = {
    id, category: $('itemCategory').value.trim(), itemName: name, brand: $('itemBrand').value.trim(), model: $('itemModel').value.trim(),
    pricingUnit: $('itemUnit').value.trim() || 'Per Unit', supplier: $('itemSupplier').value.trim(), dealerPrice: number($('itemDealer').value),
    srp: number($('itemSrp').value), stock: number($('itemStock').value), warranty: $('itemWarranty').value.trim(),
    reorderLevel: number($('itemReorder').value), location: $('itemLocation').value.trim(), remarks: $('itemRemarks').value.trim(),
    updatedAt: new Date().toISOString(), updatedBy: state.session.username, syncStatus: 'pending'
  };
  await put('items', record);
  await enqueue({ type: 'upsertItem', entityId: id, payload: record });
  closeItemForm();
  await renderItems(); await populatePickers(); await refreshPendingCount();
  toast('Item saved locally.');
}

async function renderItems() {
  const query = normalize($('itemSearch').value);
  const rows = (await getAll('items')).filter(item => normalize(Object.values(item).join(' ')).includes(query));
  rows.sort((a,b) => String(a.itemName).localeCompare(String(b.itemName)));
  $('itemList').innerHTML = rows.length ? rows.map(item => `
    <article class="record-card">
      <h3>${escapeHtml([item.itemName, item.brand, item.model].filter(Boolean).join(' — '))}</h3>
      <div class="record-meta"><span>${escapeHtml(item.category || '')}</span><span>${escapeHtml(item.pricingUnit || '')}</span><span>Stock: ${number(item.stock)}</span><span>${item.syncStatus === 'pending' ? 'Pending sync' : 'Synced'}</span></div>
      <p><strong>SRP:</strong> ${peso(item.srp)} ${state.session?.role === 'Administrator' ? ` • <strong>Dealer:</strong> ${peso(item.dealerPrice)}` : ''}</p>
      ${state.session?.role === 'Administrator' ? `<div class="record-actions"><button class="button button-secondary button-small" data-edit-item="${item.id}">Edit</button></div>` : ''}
    </article>`).join('') : emptyState('No items found.');
}

async function handleItemAction(event) {
  const id = event.target.dataset.editItem;
  if (!id) return;
  const item = (await getAll('items')).find(row => row.id === id);
  if (item) openItemForm(item);
}

function openPartForm(part = {}) {
  if (state.session.role !== 'Administrator') return;
  $('partForm').hidden = false;
  $('partId').value = part.id || '';
  $('partCategory').value = part.category || '';
  $('partName').value = part.partName || '';
  $('partBrand').value = part.brand || '';
  $('partCompatibility').value = part.compatibility || '';
  $('partDealer').value = part.dealerPrice ?? '';
  $('partSrp').value = part.srp ?? '';
  $('partShopLabor').value = part.shopLabor ?? '';
  $('partOnsiteLabor').value = part.onsiteLabor ?? '';
  $('partRepairCost').value = part.repairCost ?? '';
  $('partSupplier').value = part.supplier || '';
  $('partWarranty').value = part.warranty || '';
  $('partRemarks').value = part.remarks || '';
}
function closePartForm() { $('partForm').hidden = true; }

async function savePart() {
  const name = $('partName').value.trim();
  if (!name) return toast('Part name is required.');
  const id = $('partId').value || uuid('PART');
  const record = {
    id, category: $('partCategory').value.trim(), partName: name, brand: $('partBrand').value.trim(), compatibility: $('partCompatibility').value.trim(),
    dealerPrice: number($('partDealer').value), srp: number($('partSrp').value), shopLabor: number($('partShopLabor').value),
    onsiteLabor: number($('partOnsiteLabor').value), repairCost: number($('partRepairCost').value), supplier: $('partSupplier').value.trim(),
    warranty: $('partWarranty').value.trim(), remarks: $('partRemarks').value.trim(), updatedAt: new Date().toISOString(),
    updatedBy: state.session.username, syncStatus: 'pending'
  };
  await put('repairParts', record);
  await enqueue({ type: 'upsertRepairPart', entityId: id, payload: record });
  closePartForm();
  await renderParts(); await populatePickers(); await refreshPendingCount();
  toast('Repair part saved locally.');
}

async function renderParts() {
  const query = normalize($('partSearch').value);
  const rows = (await getAll('repairParts')).filter(part => normalize(Object.values(part).join(' ')).includes(query));
  rows.sort((a,b) => String(a.partName).localeCompare(String(b.partName)));
  $('partList').innerHTML = rows.length ? rows.map(part => `
    <article class="record-card">
      <h3>${escapeHtml([part.partName, part.brand].filter(Boolean).join(' — '))}</h3>
      <div class="record-meta"><span>${escapeHtml(part.category || '')}</span><span>${part.syncStatus === 'pending' ? 'Pending sync' : 'Synced'}</span></div>
      <p><strong>Compatibility:</strong> ${escapeHtml(part.compatibility || '')}</p>
      <p><strong>SRP:</strong> ${peso(part.srp)} • <strong>Shop labor:</strong> ${peso(part.shopLabor)} • <strong>On-site:</strong> ${peso(part.onsiteLabor)} • <strong>Repair cost:</strong> ${peso(part.repairCost)}</p>
      ${state.session?.role === 'Administrator' ? `<p><strong>Dealer:</strong> ${peso(part.dealerPrice)}</p><div class="record-actions"><button class="button button-secondary button-small" data-edit-part="${part.id}">Edit</button></div>` : ''}
    </article>`).join('') : emptyState('No repair parts found.');
}

async function handlePartAction(event) {
  const id = event.target.dataset.editPart;
  if (!id) return;
  const part = (await getAll('repairParts')).find(row => row.id === id);
  if (part) openPartForm(part);
}

async function populatePickers() {
  const customers = await getAll('customers');
  const items = await getAll('items');
  const parts = await getAll('repairParts');
  const customerOptions = `<option value="">Select customer</option>` + customers.sort((a,b) => String(a.customerName).localeCompare(String(b.customerName))).map(c => `<option value="${c.id}">${escapeHtml(c.customerName)}${c.company ? ` — ${escapeHtml(c.company)}` : ''}</option>`).join('');
  $('projectCustomer').innerHTML = customerOptions;
  $('repairCustomer').innerHTML = customerOptions;
  $('projectItemPicker').innerHTML = `<option value="">Select item</option>` + items.map(i => `<option value="${i.id}">${escapeHtml([i.itemName,i.brand,i.model].filter(Boolean).join(' — '))} • ${peso(i.srp)}</option>`).join('');
  $('repairPartPicker').innerHTML = `<option value="">Select repair part</option>` + parts.map(p => `<option value="${p.id}">${escapeHtml([p.partName,p.brand,p.compatibility].filter(Boolean).join(' — '))}</option>`).join('');
}

function prepareProjectQuote() {
  populatePickers();
  if (!state.projectLines.length) addProjectLine({ description: '', quantity: 1, unit: 'Per Unit', unitPrice: 0, dealerPrice: 0 });
  renderProjectLines();
}

async function addSelectedProjectItem() {
  const id = $('projectItemPicker').value;
  if (!id) return toast('Select an item first.');
  const item = (await getAll('items')).find(row => row.id === id);
  if (!item) return;
  addProjectLine({ itemId: item.id, description: [item.itemName,item.brand,item.model].filter(Boolean).join(' — '), quantity: 1, unit: item.pricingUnit || 'Per Unit', unitPrice: number(item.srp), dealerPrice: number(item.dealerPrice) });
}

function addProjectLine(line) {
  state.projectLines.push({ lineId: uuid('LINE'), ...line });
  renderProjectLines();
}
function renderProjectLines() {
  $('projectLines').innerHTML = state.projectLines.map((line,index) => `
    <tr data-index="${index}">
      <td><input data-field="quantity" type="number" min="0" step="1" value="${number(line.quantity)}"></td>
      <td><input class="description-input" data-field="description" value="${escapeAttribute(line.description || '')}"></td>
      <td><input data-field="unit" value="${escapeAttribute(line.unit || '')}"></td>
      <td><input data-field="unitPrice" type="number" min="0" step="0.01" value="${number(line.unitPrice)}"></td>
      <td class="admin-cost" ${state.session.role === 'Administrator' ? '' : 'hidden'}><input data-field="dealerPrice" type="number" min="0" step="0.01" value="${number(line.dealerPrice)}"></td>
      <td data-line-total>${peso(number(line.quantity) * number(line.unitPrice))}</td>
      <td><button class="remove-line" data-remove-project="${index}">×</button></td>
    </tr>`).join('');
  renderProjectTotals();
}
function updateProjectLineFromEvent(event) {
  const input = event.target;
  const row = input.closest('tr');
  if (!row || !input.dataset.field) return;
  const index = Number(row.dataset.index);
  state.projectLines[index][input.dataset.field] = ['quantity','unitPrice','dealerPrice'].includes(input.dataset.field) ? number(input.value) : input.value;
  const totalCell = row.querySelector('[data-line-total]');
  if (totalCell) totalCell.textContent = peso(number(state.projectLines[index].quantity) * number(state.projectLines[index].unitPrice));
  renderProjectTotals();
}
function removeProjectLineFromEvent(event) {
  const index = event.target.dataset.removeProject;
  if (index === undefined) return;
  state.projectLines.splice(Number(index), 1);
  renderProjectLines();
}
function computeProjectTotals() {
  const materialSrpTotal = state.projectLines.reduce((sum,line) => sum + number(line.quantity) * number(line.unitPrice), 0);
  const materialDealerCost = state.projectLines.reduce((sum,line) => sum + number(line.quantity) * number(line.dealerPrice), 0);
  const laborAuto = materialSrpTotal * number($('projectLaborPercent').value) / 100;
  const manualRaw = $('projectManualLabor').value;
  const laborUsed = manualRaw === '' ? laborAuto : number(manualRaw);
  const subtotal = materialSrpTotal + laborUsed;
  const discount = Math.min(subtotal, number($('projectDiscount').value));
  const grandTotal = Math.max(0, subtotal - discount);
  const downpaymentAmount = grandTotal * number($('projectDownpaymentPercent').value) / 100;
  return { materialSrpTotal, materialDealerCost, laborAuto, laborUsed, subtotal, discount, grandTotal, downpaymentAmount, balance: grandTotal - downpaymentAmount, materialProfit: materialSrpTotal - materialDealerCost, totalProfit: grandTotal - materialDealerCost };
}
function renderProjectTotals() {
  const t = computeProjectTotals();
  $('projectTotals').innerHTML = `<div class="total-row"><span>Materials</span><strong>${peso(t.materialSrpTotal)}</strong></div><div class="total-row"><span>Labor</span><strong>${peso(t.laborUsed)}</strong></div><div class="total-row"><span>Subtotal</span><strong>${peso(t.subtotal)}</strong></div><div class="total-row"><span>Discount</span><strong>${peso(t.discount)}</strong></div><div class="total-row grand"><span>Grand Total</span><strong>${peso(t.grandTotal)}</strong></div><div class="total-row"><span>Downpayment</span><strong>${peso(t.downpaymentAmount)}</strong></div><div class="total-row"><span>Balance</span><strong>${peso(t.balance)}</strong></div>${state.session?.role === 'Administrator' ? `<div class="total-row"><span>Estimated Profit</span><strong>${peso(t.totalProfit)}</strong></div>` : ''}`;
}

async function saveProjectQuote() {
  const customer = (await getAll('customers')).find(row => row.id === $('projectCustomer').value);
  if (!customer) return toast('Select a customer.');
  if (!state.projectLines.some(line => line.description.trim())) return toast('Add at least one quotation item.');
  const totals = computeProjectTotals();
  const id = uuid('PQ');
  const now = new Date();
  const record = {
    id, quoteNo: makeQuoteNo('PQ', now), date: now.toISOString(), customerId: customer.id, customerName: customer.customerName,
    serviceType: $('projectService').value, projectLocation: $('projectLocation').value.trim(), salesPersonnel: $('projectSales').value.trim() || state.session.name,
    laborPercent: number($('projectLaborPercent').value), manualLabor: $('projectManualLabor').value === '' ? null : number($('projectManualLabor').value),
    downpaymentPercent: number($('projectDownpaymentPercent').value), notes: $('projectNotes').value.trim(), status: 'Draft',
    lineItems: state.projectLines.map(line => ({ ...line, lineTotal: number(line.quantity) * number(line.unitPrice), lineDealerTotal: number(line.quantity) * number(line.dealerPrice) })),
    ...totals, createdBy: state.session.username, updatedAt: now.toISOString(), syncStatus: 'pending'
  };
  await put('projectQuotes', record);
  await enqueue({ type: 'upsertProjectQuote', entityId: id, payload: record });
  state.projectLines = [];
  resetProjectForm();
  await renderHistory(); await refreshPendingCount(); await renderDashboard();
  toast(`Project quotation ${record.quoteNo} saved locally.`);
}
function resetProjectForm() {
  $('projectLocation').value = ''; $('projectNotes').value = ''; $('projectManualLabor').value = ''; $('projectDiscount').value = 0;
  addProjectLine({ description: '', quantity: 1, unit: 'Per Unit', unitPrice: 0, dealerPrice: 0 });
}

function prepareRepairQuote() {
  populatePickers();
  if (!state.repairLines.length) addRepairLine({ description: '', quantity: 1, unitPrice: 0, labor: 0 });
  renderRepairLines();
}
async function addSelectedRepairPart() {
  const id = $('repairPartPicker').value;
  if (!id) return toast('Select a repair part first.');
  const part = (await getAll('repairParts')).find(row => row.id === id);
  if (!part) return;
  addRepairLine({ partId: part.id, description: [part.partName,part.brand,part.compatibility].filter(Boolean).join(' — '), quantity: 1, unitPrice: number(part.srp), labor: number(part.shopLabor || part.repairCost) });
}
function addRepairLine(line) { state.repairLines.push({ lineId: uuid('LINE'), ...line }); renderRepairLines(); }
function renderRepairLines() {
  $('repairLines').innerHTML = state.repairLines.map((line,index) => `
    <tr data-index="${index}"><td><input data-field="quantity" type="number" min="0" step="1" value="${number(line.quantity)}"></td><td><input class="description-input" data-field="description" value="${escapeAttribute(line.description || '')}"></td><td><input data-field="unitPrice" type="number" min="0" step="0.01" value="${number(line.unitPrice)}"></td><td><input data-field="labor" type="number" min="0" step="0.01" value="${number(line.labor)}"></td><td data-line-total>${peso(number(line.quantity) * number(line.unitPrice) + number(line.labor))}</td><td><button class="remove-line" data-remove-repair="${index}">×</button></td></tr>`).join('');
  renderRepairTotals();
}
function updateRepairLineFromEvent(event) {
  const input = event.target; const row = input.closest('tr');
  if (!row || !input.dataset.field) return;
  const index = Number(row.dataset.index);
  state.repairLines[index][input.dataset.field] = ['quantity','unitPrice','labor'].includes(input.dataset.field) ? number(input.value) : input.value;
  const totalCell = row.querySelector('[data-line-total]');
  if (totalCell) totalCell.textContent = peso(number(state.repairLines[index].quantity) * number(state.repairLines[index].unitPrice) + number(state.repairLines[index].labor));
  renderRepairTotals();
}
function removeRepairLineFromEvent(event) { const index = event.target.dataset.removeRepair; if (index === undefined) return; state.repairLines.splice(Number(index),1); renderRepairLines(); }
function computeRepairTotals() {
  const partsTotal = state.repairLines.reduce((sum,line) => sum + number(line.quantity) * number(line.unitPrice), 0);
  const laborTotal = state.repairLines.reduce((sum,line) => sum + number(line.labor), 0);
  return { partsTotal, laborTotal, grandTotal: partsTotal + laborTotal };
}
function renderRepairTotals() { const t = computeRepairTotals(); $('repairTotals').innerHTML = `<div class="total-row"><span>Parts</span><strong>${peso(t.partsTotal)}</strong></div><div class="total-row"><span>Labor</span><strong>${peso(t.laborTotal)}</strong></div><div class="total-row grand"><span>Grand Total</span><strong>${peso(t.grandTotal)}</strong></div>`; }
async function saveRepairQuote() {
  const customer = (await getAll('customers')).find(row => row.id === $('repairCustomer').value);
  if (!customer) return toast('Select a customer.');
  if (!state.repairLines.some(line => line.description.trim())) return toast('Add at least one repair item.');
  const totals = computeRepairTotals(); const now = new Date(); const id = uuid('RQ');
  const record = { id, quoteNo: makeQuoteNo('RQ', now), date: now.toISOString(), customerId: customer.id, customerName: customer.customerName,
    deviceType: $('repairDeviceType').value.trim(), brand: $('repairBrand').value.trim(), model: $('repairModel').value.trim(), problem: $('repairProblem').value.trim(),
    status: $('repairStatus').value, notes: $('repairNotes').value.trim(), lineItems: state.repairLines.map(line => ({ ...line, lineTotal: number(line.quantity)*number(line.unitPrice)+number(line.labor) })),
    ...totals, createdBy: state.session.username, updatedAt: now.toISOString(), syncStatus: 'pending' };
  await put('repairQuotes', record); await enqueue({ type:'upsertRepairQuote', entityId:id, payload:record });
  state.repairLines = []; resetRepairForm(); await renderHistory(); await refreshPendingCount(); await renderDashboard();
  toast(`Repair quotation ${record.quoteNo} saved locally.`);
}
function resetRepairForm() { ['repairDeviceType','repairBrand','repairModel','repairProblem','repairNotes'].forEach(id => $(id).value=''); addRepairLine({ description:'', quantity:1, unitPrice:0, labor:0 }); }

async function renderHistory() {
  const query = normalize($('historySearch').value);
  const projects = (await getAll('projectQuotes')).map(q => ({...q, quoteType:'project'}));
  const repairs = (await getAll('repairQuotes')).map(q => ({...q, quoteType:'repair'}));
  const rows = [...projects,...repairs].filter(q => normalize(`${q.quoteNo} ${q.customerName} ${q.serviceType} ${q.deviceType}`).includes(query)).sort((a,b) => String(b.date).localeCompare(String(a.date)));
  $('historyList').innerHTML = rows.length ? rows.map(q => `
    <article class="record-card"><h3>${escapeHtml(q.quoteNo || q.id)}</h3><div class="record-meta"><span>${q.quoteType === 'project' ? 'Project' : 'Repair'}</span><span>${formatDate(q.date)}</span><span>${q.syncStatus === 'pending' ? 'Pending sync' : 'Synced'}</span></div><p><strong>${escapeHtml(q.customerName || '')}</strong> • ${peso(q.grandTotal)}</p><div class="record-actions"><button class="button button-small" data-doc="pdf" data-type="${q.quoteType}" data-id="${q.id}">PDF</button><button class="button button-secondary button-small" data-doc="xlsx" data-type="${q.quoteType}" data-id="${q.id}">Excel</button><button class="button button-secondary button-small" data-doc="docx" data-type="${q.quoteType}" data-id="${q.id}">Word</button></div></article>`).join('') : emptyState('No quotations found.');
}
async function handleHistoryAction(event) {
  const format = event.target.dataset.doc; if (!format) return;
  const type = event.target.dataset.type; const id = event.target.dataset.id;
  const quote = (await getAll(type === 'project' ? 'projectQuotes' : 'repairQuotes')).find(q => q.id === id);
  if (!quote) return;
  const company = { ...defaultCompany, ...(await getCompany()) };
  if (format === 'pdf') downloadQuotationPdf(quote, company, type);
  if (format === 'xlsx') downloadQuotationXlsx(quote, company, type);
  if (format === 'docx') downloadQuotationDocx(quote, company, type);
}

async function pushOutbox() {
  if (state.syncRunning) return;
  if (!navigator.onLine) return toast('Cannot upload while offline.');
  if (!state.session?.token) return toast('Please sign in online again before syncing.');
  state.syncRunning = true;
  try {
    let batch = await listOutbox(20);
    while (batch.length) {
      appendSyncLog(`Uploading ${batch.length} operation(s)…`);
      const result = await Api.syncBatch(state.session.token, state.deviceId, batch);
      for (const operationId of result.successfulOperationIds || []) await remove('outbox', operationId);
      if (result.failed?.length) result.failed.forEach(f => appendSyncLog(`FAILED ${f.operationId}: ${f.error}`));
      batch = await listOutbox(20);
      if (result.successfulOperationIds?.length === 0) break;
    }
    await setMeta('lastSync', new Date().toISOString());
    appendSyncLog('Pending changes uploaded.');
    await refreshPendingCount();
  } catch (error) { appendSyncLog(`Upload error: ${error.message}`); toast(error.message); }
  finally { state.syncRunning = false; await renderSyncCenter(); }
}

async function pullLatest() {
  if (state.syncRunning) return;
  if (!navigator.onLine) return toast('Cannot download while offline.');
  if (!state.session?.token) return toast('Please sign in online again before syncing.');
  state.syncRunning = true;
  try {
    appendSyncLog('Downloading current data…');
    const result = await Api.pull(state.session.token, state.deviceId, '');
    const pendingIds = await pendingEntityIds();
    await mergeServerRows('customers', result.customers, pendingIds);
    await mergeServerRows('items', result.items, pendingIds);
    await mergeServerRows('repairParts', result.repairParts, pendingIds);
    await mergeServerRows('projectQuotes', result.projectQuotes, pendingIds);
    await mergeServerRows('repairQuotes', result.repairQuotes, pendingIds);
    if (result.users) await mergeServerRows('users', result.users, new Set());
    if (result.company) { state.company = { ...defaultCompany, ...result.company }; await setCompany(state.company); }
    await sanitizeRestrictedData(state.session.role);
    await setMeta('lastSync', new Date().toISOString());
    appendSyncLog('Latest server data downloaded.');
    await loadAllViews();
  } catch (error) { appendSyncLog(`Download error: ${error.message}`); toast(error.message); }
  finally { state.syncRunning = false; await renderSyncCenter(); }
}

async function mergeServerRows(store, rows = [], pendingIds) {
  const safeRows = (rows || []).filter(row => row?.id && !pendingIds.has(row.id)).map(row => ({ ...row, syncStatus:'synced' }));
  await bulkPut(store, safeRows);
}
async function fullSync() { if (!navigator.onLine) return toast('Offline: records remain safely in the device outbox.'); await pushOutbox(); await pullLatest(); }
async function renderSyncCenter() {
  updateNetworkUi();
  $('syncPending').textContent = await count('outbox');
  const last = await getMeta('lastSync');
  $('syncLast').textContent = last ? new Date(last).toLocaleString('en-PH') : 'Never';
  const logs = await getSyncLog(50);
  $('syncLog').textContent = logs.map(log => `[${new Date(log.timestamp).toLocaleTimeString()}] ${log.message}`).join('\n') || 'No sync activity yet.';
}
async function appendSyncLog(message) { await logSync(message); const box = $('syncLog'); box.textContent = `[${new Date().toLocaleTimeString()}] ${message}\n${box.textContent || ''}`; }

async function loadUsers() {
  if (state.session?.role !== 'Administrator') return;
  if (!navigator.onLine) { $('userList').innerHTML = emptyState('User management requires internet.'); return; }
  try {
    const users = await Api.listUsers(state.session.token);
    await bulkPut('users', users);
    $('userList').innerHTML = users.map(user => `<article class="record-card"><h3>${escapeHtml(user.fullName)}</h3><div class="record-meta"><span>${escapeHtml(user.username)}</span><span>${escapeHtml(user.role)}</span><span>${escapeHtml(user.status)}</span></div></article>`).join('');
  } catch (error) { toast(error.message); }
}
async function createUser() {
  if (!navigator.onLine) return toast('Creating users requires internet.');
  const user = { fullName:$('newUserFullName').value.trim(), username:$('newUserUsername').value.trim(), password:$('newUserPassword').value, role:$('newUserRole').value };
  if (!user.fullName || !user.username || !user.password) return toast('Complete the user name, username, and password.');
  try { await Api.createUser(state.session.token, user); ['newUserFullName','newUserUsername','newUserPassword'].forEach(id => $(id).value=''); await loadUsers(); toast('User created.'); } catch(error) { toast(error.message); }
}

async function renderSettings() {
  state.company = { ...defaultCompany, ...(await getCompany()) };
  const map = { settingCompanyName:'companyName', settingTagline:'tagline', settingAddress:'address', settingContact:'contact', settingEmail:'email', settingFacebook:'facebook', settingBank:'bankName', settingAccountName:'accountName', settingAccountNumber:'accountNumber', settingProjectWarranty:'projectWarranty', settingRepairWarranty:'repairWarranty' };
  Object.entries(map).forEach(([id,key]) => $(id).value = state.company[key] || '');
  $('settingsBackendUrl').value = getBackendUrl();
}
async function saveSettings() {
  const settings = { companyName:$('settingCompanyName').value.trim(), tagline:$('settingTagline').value.trim(), address:$('settingAddress').value.trim(), contact:$('settingContact').value.trim(), email:$('settingEmail').value.trim(), facebook:$('settingFacebook').value.trim(), bankName:$('settingBank').value.trim(), accountName:$('settingAccountName').value.trim(), accountNumber:$('settingAccountNumber').value.trim(), projectWarranty:$('settingProjectWarranty').value.trim(), repairWarranty:$('settingRepairWarranty').value.trim() };
  state.company = settings; await setCompany(settings); await enqueue({ type:'upsertSettings', entityId:'company', payload:settings }); await refreshPendingCount(); toast('Settings saved locally.');
}
function saveBackendSetting() { try { setBackendUrl($('settingsBackendUrl').value); $('backendUrl').value = getBackendUrl(); toast('Backend URL saved.'); } catch(error) { toast(error.message); } }
async function requestPersistentStorage() { if (!navigator.storage?.persist) return toast('Persistent storage is not supported by this browser.'); const granted = await navigator.storage.persist(); toast(granted ? 'Persistent offline storage granted.' : 'The browser did not grant persistent storage.'); }
async function changeMyPassword() {
  if (!navigator.onLine) return toast('Changing the password requires internet.');
  const currentPassword = $('currentPassword').value;
  const newPassword = $('newPassword').value;
  if (newPassword.length < 8) return toast('The new password must contain at least 8 characters.');
  try {
    await Api.changePassword(state.session.token, currentPassword, newPassword);
    $('currentPassword').value = '';
    $('newPassword').value = '';
    toast('Password changed successfully.');
  } catch (error) { toast(error.message); }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('./service-worker.js', { scope:'./' }); } catch(error) { console.warn('Service worker registration failed', error); }
}
async function installApp() { if (!state.installPrompt) return; state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; $('installButton').hidden = true; }

function makeQuoteNo(prefix, date) { return `${prefix}-${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}-${String(Date.now()).slice(-6)}`; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function peso(value) { return `₱${number(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
function normalize(value) { return String(value || '').toLowerCase().trim(); }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-PH'); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function escapeAttribute(value) { return escapeHtml(value).replace(/`/g,'&#096;'); }
function emptyState(message) { return `<div class="notice"><p>${escapeHtml(message)}</p></div>`; }
let toastTimer;
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 3500); }
