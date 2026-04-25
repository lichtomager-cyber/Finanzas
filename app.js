// Variables Globales y Configuración
let transactions = JSON.parse(localStorage.getItem('finanzas_transacciones')) || [];
let userConfig = JSON.parse(localStorage.getItem('finanzas_config')) || { onboarded: false };
let savedMotivos = JSON.parse(localStorage.getItem('finanzas_motivos')) || [];
let bcvRates = { usd: 0, eur: 0 };
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let filterDate = null;
let searchQuery = '';

const ALL_BANKS = [
    "Bolívares Efectivo", "Banesco", "Banco de Venezuela", "Mercantil", "Provincial", 
    "BNC", "Bancamiga", "Banplus", "Banco Exterior", "Banco del Tesoro", 
    "Banco Bicentenario", "Banco Caroní", "Banco Agrícola", "BANFANB", 
    "Banco Activo", "BFC", "Banco Plaza", "Banco Venezolano de Crédito", 
    "100% Banco", "DelSur", "Mi Banco", "Bancrecer"
];

// Elementos DOM
const dom = {
    displayName: document.getElementById('display-name'),
    totalBal: document.getElementById('total-balance'),
    totalPhysical: document.getElementById('total-physical-dollars'),
    accountsGrid: document.getElementById('accounts-grid'),
    list: document.getElementById('transaction-list'),
    modal: document.getElementById('transaction-modal'),
    form: document.getElementById('transaction-form'),
    searchInput: document.getElementById('search-input'),
    btnToggleView: document.getElementById('btn-toggle-view'),
    calContainer: document.getElementById('calendar-container'),
    calGrid: document.getElementById('calendar-grid'),
    calMonthYear: document.getElementById('cal-month-year'),
    motivosList: document.getElementById('motivos-list'),
    accountSelect: document.getElementById('account'),
    isExchange: document.getElementById('is-exchange'),
    exchangeFields: document.getElementById('exchange-fields'),
    exchangeRate: document.getElementById('exchange-rate'),
    onboarding: document.getElementById('onboarding-overlay')
};

// --- Lógica de Onboarding ---
const checkOnboarding = () => {
    if (!userConfig.onboarded) {
        dom.onboarding.classList.remove('hidden');
        renderBanksSelection();
    } else {
        dom.onboarding.classList.add('hidden');
        initApp();
    }
};

const goToStep = (step) => {
    if (step === 2) {
        const name = document.getElementById('user-name-input').value.trim();
        if (!name) return alert("Por favor, introduce tu nombre.");
        userConfig.name = name;
    }
    if (step === 3) {
        const selected = Array.from(document.querySelectorAll('.bank-checkbox:checked')).map(cb => cb.value);
        if (selected.length === 0) return alert("Selecciona al menos un banco.");
        userConfig.banks = selected;
        renderInitialBalancesInputs();
    }
    
    document.querySelectorAll('.onboarding-step').forEach(el => el.classList.remove('active'));
    document.getElementById(`step-${step}`).classList.add('active');
};

const renderBanksSelection = () => {
    const list = document.getElementById('banks-selection-list');
    list.innerHTML = ALL_BANKS.map(bank => `
        <label class="bank-item-select" id="label-${bank.replace(/\s/g, '')}">
            <input type="checkbox" class="bank-checkbox" value="${bank}" onchange="toggleBankUI('${bank}')">
            <span>${bank}</span>
        </label>
    `).join('');
};

const toggleBankUI = (bank) => {
    const label = document.getElementById(`label-${bank.replace(/\s/g, '')}`);
    const isChecked = label.querySelector('input').checked;
    if (isChecked) label.classList.add('selected');
    else label.classList.remove('selected');
};

const renderInitialBalancesInputs = () => {
    const list = document.getElementById('initial-balances-list');
    let html = userConfig.banks.map(bank => `
        <div class="balance-input-group">
            <label>${bank} (Bs.)</label>
            <input type="number" class="initial-balance-input" data-bank="${bank}" step="0.01" placeholder="0.00">
        </div>
    `).join('');
    html += `
        <div class="balance-input-group" style="border-top: 1px solid #ddd; margin-top: 10px; padding-top: 15px;">
            <label>Dólares en Efectivo ($)</label>
            <input type="number" id="initial-usd-input" step="0.01" placeholder="0.00">
        </div>
    `;
    list.innerHTML = html;
};

const finishOnboarding = () => {
    const balances = {};
    document.querySelectorAll('.initial-balance-input').forEach(input => {
        balances[input.dataset.bank] = parseFloat(input.value) || 0;
    });
    userConfig.initialBalances = balances;
    userConfig.initialUSD = parseFloat(document.getElementById('initial-usd-input').value) || 0;
    userConfig.onboarded = true;
    
    localStorage.setItem('finanzas_config', JSON.stringify(userConfig));
    // Clear old transactions to start fresh as requested
    transactions = [];
    localStorage.setItem('finanzas_transacciones', JSON.stringify(transactions));
    
    dom.onboarding.classList.add('hidden');
    initApp();
};

// --- Lógica Principal ---
const formatVES = (amount) => new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'VES', minimumFractionDigits: 2 }).format(amount).replace('VES', 'Bs.');
const formatForeign = (amount) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
const generateID = () => Math.floor(Math.random() * 100000000);

const fetchBCV = async () => {
    try {
        const resUSD = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
        const dataUSD = await resUSD.json();
        const resEUR = await fetch('https://ve.dolarapi.com/v1/euros/oficial');
        const dataEUR = await resEUR.json();
        const parseRate = (val) => typeof val === 'string' ? parseFloat(val.replace(',', '.')) : val;

        if (dataUSD && dataUSD.promedio && dataEUR && dataEUR.promedio) {
            const val1 = parseRate(dataUSD.promedio);
            const val2 = parseRate(dataEUR.promedio);
            if (val1 > val2) { bcvRates.eur = val1; bcvRates.usd = val2; }
            else { bcvRates.eur = val2; bcvRates.usd = val1; }
            document.getElementById('bcv-usd-rate').innerText = formatVES(bcvRates.usd);
            document.getElementById('bcv-eur-rate').innerText = formatVES(bcvRates.eur);
            updateValues();
        }
    } catch (e) { console.error("BCV Error", e); }
};

const updateValues = () => {
    if (!userConfig.onboarded) return;
    
    const bankTotals = { ...userConfig.initialBalances };
    let physicalDollars = userConfig.initialUSD;

    transactions.forEach(t => {
        const multiplier = t.type === 'ingreso' ? 1 : -1;
        const val = t.amount * multiplier;
        if (bankTotals[t.account] !== undefined) bankTotals[t.account] += val;

        if (t.isExchange && t.usdAmount) {
            if (t.type === 'egreso') physicalDollars += t.usdAmount;
            else physicalDollars -= t.usdAmount;
        }
    });

    let totalBS = Object.values(bankTotals).reduce((a, b) => a + b, 0);
    dom.totalBal.innerText = formatVES(totalBS);
    dom.totalPhysical.innerText = `$ ${physicalDollars.toFixed(2)}`;
    
    // Render dynamic cards
    dom.accountsGrid.innerHTML = userConfig.banks.map(bank => `
        <div class="card account-card">
            <div class="account-header">
                <h2>${bank}</h2>
                <i class="fa-solid fa-building-columns"></i>
            </div>
            <h3>${formatVES(bankTotals[bank] || 0)}</h3>
        </div>
    `).join('');

    if (bcvRates.usd > 0) {
        document.getElementById('usd-converted').innerText = formatForeign(totalBS / bcvRates.usd);
        document.getElementById('eur-converted').innerText = formatForeign(totalBS / bcvRates.eur);
    }
};

const initApp = () => {
    dom.displayName.innerText = userConfig.name;
    dom.accountSelect.innerHTML = userConfig.banks.map(b => `<option value="${b}">${b}</option>`).join('');
    updateMotivosDatalist();
    updateValues();
    renderTransactions();
    fetchBCV();
};

const openModal = (type, editId = null) => {
    document.getElementById('type').value = type;
    document.getElementById('edit-id').value = editId || '';
    const isEdit = editId !== null;
    document.getElementById('modal-title').innerText = isEdit ? 'Editar Registro' : (type === 'ingreso' ? 'Nuevo Ingreso' : 'Nuevo Egreso');
    const btnSave = document.getElementById('btn-save-tx');
    btnSave.style.backgroundColor = type === 'ingreso' ? 'var(--color-income)' : 'var(--color-expense)';
    
    const actionsContainer = document.getElementById('modal-actions');
    const oldDel = document.getElementById('btn-delete-tx');
    if(oldDel) oldDel.remove();

    if (isEdit) {
        const tx = transactions.find(t => t.id === editId);
        dom.accountSelect.value = tx.account;
        document.getElementById('amount').value = tx.amount;
        document.getElementById('reason').value = tx.reason;
        document.getElementById('date').value = tx.date;
        dom.isExchange.checked = !!tx.isExchange;
        dom.exchangeRate.value = tx.exchangeRate || '';
        if (tx.isExchange) dom.exchangeFields.classList.remove('hidden');
        else dom.exchangeFields.classList.add('hidden');

        const btnDel = document.createElement('button');
        btnDel.type = 'button'; btnDel.id = 'btn-delete-tx'; btnDel.className = 'btn-delete';
        btnDel.innerHTML = '<i class="fa-solid fa-trash"></i>';
        btnDel.onclick = () => { if(confirm('¿Eliminar?')) { removeTransaction(tx.id); closeModal(); } };
        actionsContainer.appendChild(btnDel);
    } else {
        document.getElementById('date').value = new Date().toISOString().split('T')[0];
        document.getElementById('amount').value = '';
        document.getElementById('reason').value = '';
        dom.isExchange.checked = false;
        dom.exchangeFields.classList.add('hidden');
    }
    dom.modal.classList.add('active');
};

const closeModal = () => dom.modal.classList.remove('active');

dom.form.onsubmit = (e) => {
    e.preventDefault();
    const type = document.getElementById('type').value;
    const account = dom.accountSelect.value;
    const amount = +document.getElementById('amount').value;
    const reason = document.getElementById('reason').value.trim();
    const date = document.getElementById('date').value;
    const editId = document.getElementById('edit-id').value;
    const isExchange = dom.isExchange.checked;
    const exchangeRate = isExchange ? +dom.exchangeRate.value : null;
    const usdAmount = isExchange ? (amount / exchangeRate) : 0;

    if (!savedMotivos.includes(reason)) {
        savedMotivos.push(reason);
        localStorage.setItem('finanzas_motivos', JSON.stringify(savedMotivos));
        updateMotivosDatalist();
    }

    const txData = { id: editId ? Number(editId) : generateID(), type, account, amount, reason, date, isExchange, exchangeRate, usdAmount };
    if (editId) transactions = transactions.map(t => t.id === txData.id ? txData : t);
    else transactions.push(txData);

    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    localStorage.setItem('finanzas_transacciones', JSON.stringify(transactions));
    updateValues();
    renderTransactions();
    closeModal();
};

const updateMotivosDatalist = () => dom.motivosList.innerHTML = savedMotivos.map(m => `<option value="${m}">`).join('');

const renderTransactions = () => {
    dom.list.innerHTML = '';
    let filtered = transactions;
    if (searchQuery) filtered = filtered.filter(t => t.reason.toLowerCase().includes(searchQuery));
    if (filterDate) filtered = filtered.filter(t => t.date === filterDate);

    if (filtered.length === 0) {
        dom.list.innerHTML = '<div class="empty-state">Sin movimientos.</div>';
        return;
    }

    filtered.forEach(tx => {
        const sign = tx.type === 'egreso' ? '-' : '+';
        const icon = tx.type === 'ingreso' ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
        const item = document.createElement('li');
        item.className = 'transaction-item';
        item.onclick = () => openModal(tx.type, tx.id);
        item.innerHTML = `
            <div class="t-info">
                <div class="t-icon ${tx.type}"><i class="fa-solid ${icon}"></i></div>
                <div class="t-details">
                    <h4>${tx.reason} <span class="t-account-tag">${tx.account}</span></h4>
                    <p>${tx.date} ${tx.isExchange ? `• <small>$${tx.usdAmount.toFixed(2)}</small>` : ''}</p>
                </div>
            </div>
            <div class="t-amount ${tx.type}"><span>${sign}${formatVES(tx.amount)}</span></div>
        `;
        dom.list.appendChild(item);
    });
};

const removeTransaction = (id) => {
    transactions = transactions.filter(t => t.id !== id);
    localStorage.setItem('finanzas_transacciones', JSON.stringify(transactions));
    updateValues();
    renderTransactions();
};

// Eventos Buscador y Calendario (Resumidos)
dom.searchInput.oninput = (e) => { searchQuery = e.target.value.toLowerCase(); renderTransactions(); };
dom.isExchange.onchange = (e) => {
    if (e.target.checked) {
        dom.exchangeFields.classList.remove('hidden');
        dom.exchangeRate.required = true;
        if (bcvRates.usd > 0) dom.exchangeRate.value = bcvRates.usd;
    } else {
        dom.exchangeFields.classList.add('hidden');
        dom.exchangeRate.required = false;
    }
};

// Init
checkOnboarding();
if (userConfig.onboarded) fetchBCV();
