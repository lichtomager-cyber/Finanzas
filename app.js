// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.error('SW error', err));
    });
}

// Variables Globales
let transactions = JSON.parse(localStorage.getItem('finanzas_transacciones')) || [];
// Migrate old data if 'account' is missing
transactions = transactions.map(t => t.account ? t : { ...t, account: 'banesco' });

let savedMotivos = JSON.parse(localStorage.getItem('finanzas_motivos')) || [];
let bcvRates = { usd: 0, eur: 0 };
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let filterDate = null;
let searchQuery = '';

// Elementos DOM
const dom = {
    totalBal: document.getElementById('total-balance'),
    totalPhysical: document.getElementById('total-physical-dollars'),
    balBanesco: document.getElementById('balance-banesco'),
    balMercantil: document.getElementById('balance-mercantil'),
    usdConv: document.getElementById('usd-converted'),
    eurConv: document.getElementById('eur-converted'),
    usdRate: document.getElementById('bcv-usd-rate'),
    eurRate: document.getElementById('bcv-eur-rate'),
    list: document.getElementById('transaction-list'),
    modal: document.getElementById('transaction-modal'),
    form: document.getElementById('transaction-form'),
    searchInput: document.getElementById('search-input'),
    btnToggleView: document.getElementById('btn-toggle-view'),
    calContainer: document.getElementById('calendar-container'),
    calGrid: document.getElementById('calendar-grid'),
    calMonthYear: document.getElementById('cal-month-year'),
    motivosList: document.getElementById('motivos-list'),
    isExchange: document.getElementById('is-exchange'),
    exchangeFields: document.getElementById('exchange-fields'),
    exchangeRate: document.getElementById('exchange-rate')
};

// Formato Moneda
const formatVES = (amount) => new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'VES', minimumFractionDigits: 2 }).format(amount).replace('VES', 'Bs.');
const formatForeign = (amount) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

const generateID = () => Math.floor(Math.random() * 100000000);

// Actualizar Datalist de Motivos
const updateMotivosDatalist = () => {
    dom.motivosList.innerHTML = savedMotivos.map(m => `<option value="${m}">`).join('');
};

// Guardar Motivo Nuevo
const saveMotivo = (motivo) => {
    if (!savedMotivos.includes(motivo)) {
        savedMotivos.push(motivo);
        localStorage.setItem('finanzas_motivos', JSON.stringify(savedMotivos));
        updateMotivosDatalist();
    }
};

// Obtener Tasa BCV
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

            // El Euro siempre es mayor que el Dólar en Bs.
            if (val1 > val2) {
                bcvRates.eur = val1;
                bcvRates.usd = val2;
            } else {
                bcvRates.eur = val2;
                bcvRates.usd = val1;
            }

            dom.usdRate.innerText = formatVES(bcvRates.usd);
            dom.eurRate.innerText = formatVES(bcvRates.eur);
            updateValues();
        }
    } catch (error) {
        console.error("Error fetching BCV", error);
        dom.usdRate.innerText = "Error API";
        dom.eurRate.innerText = "Error API";
    }
};

// Modal (Crear / Editar)
const openModal = (type, editId = null) => {
    document.getElementById('type').value = type;
    document.getElementById('edit-id').value = editId || '';
    
    const isEdit = editId !== null;
    const title = isEdit ? 'Editar Transacción' : (type === 'ingreso' ? 'Nuevo Ingreso' : 'Nuevo Egreso');
    document.getElementById('modal-title').innerText = title;

    const btnSave = document.getElementById('btn-save-tx');
    btnSave.style.backgroundColor = type === 'ingreso' ? 'var(--color-income)' : 'var(--color-expense)';
    btnSave.innerText = isEdit ? 'Actualizar' : 'Guardar Registro';

    const actionsContainer = document.getElementById('modal-actions');
    // Limpiar botones extra
    const existingDelete = document.getElementById('btn-delete-tx');
    if(existingDelete) existingDelete.remove();

    if (isEdit) {
        const tx = transactions.find(t => t.id === editId);
        document.getElementById('account').value = tx.account;
        document.getElementById('amount').value = tx.amount;
        document.getElementById('reason').value = tx.reason;
        document.getElementById('date').value = tx.date;
        
        dom.isExchange.checked = !!tx.isExchange;
        dom.exchangeRate.value = tx.exchangeRate || '';
        if (tx.isExchange) dom.exchangeFields.classList.remove('hidden');
        else dom.exchangeFields.classList.add('hidden');

        // Añadir botón borrar
        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.id = 'btn-delete-tx';
        btnDel.className = 'btn-delete';
        btnDel.innerHTML = '<i class="fa-solid fa-trash"></i>';
        btnDel.onclick = () => {
            if(confirm('¿Eliminar esta transacción?')) {
                removeTransaction(tx.id);
                closeModal();
            }
        };
        actionsContainer.appendChild(btnDel);
    } else {
        document.getElementById('date').value = new Date().toISOString().split('T')[0];
        document.getElementById('amount').value = '';
        document.getElementById('reason').value = '';
        dom.isExchange.checked = false;
        dom.exchangeRate.value = '';
        dom.exchangeFields.classList.add('hidden');
    }

    dom.modal.classList.add('active');
};

const closeModal = () => dom.modal.classList.remove('active');

// Renderizar Transacciones
const renderTransactions = () => {
    dom.list.innerHTML = '';
    
    let filtered = transactions;
    if (searchQuery) {
        filtered = filtered.filter(t => t.reason.toLowerCase().includes(searchQuery));
    }
    if (filterDate) {
        filtered = filtered.filter(t => t.date === filterDate);
    }

    if (filtered.length === 0) {
        dom.list.innerHTML = '<div class="empty-state">No hay movimientos.</div>';
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
                    <h4>${tx.reason} <span class="t-account-tag ${tx.account}">${tx.account === 'banesco' ? 'Banesco' : 'Mercantil'}</span></h4>
                    <p>${tx.date} ${tx.isExchange ? `• <small style="color:var(--color-primary)">${tx.type === 'ingreso' ? 'Venta' : 'Compra'} ($${tx.usdAmount.toFixed(2)} @ ${tx.exchangeRate})</small>` : ''}</p>
                </div>
            </div>
            <div class="t-amount ${tx.type}">
                <span>${sign}${formatVES(tx.amount)}</span>
            </div>
        `;
        dom.list.appendChild(item);
    });
};

// Actualizar Valores Totales
const updateValues = () => {
    let banesco = 0, mercantil = 0, physicalDollars = 0;

    transactions.forEach(t => {
        const multiplier = t.type === 'ingreso' ? 1 : -1;
        const val = t.amount * multiplier;
        
        if (t.account === 'banesco') banesco += val;
        else mercantil += val;

        // Lógica de Dólares Físicos
        if (t.isExchange && t.usdAmount) {
            // Si es Egreso + Compra = Suma dólares físicos
            // Si es Ingreso + Venta = Resta dólares físicos
            if (t.type === 'egreso') physicalDollars += t.usdAmount;
            else physicalDollars -= t.usdAmount;
        }
    });

    const total = banesco + mercantil;

    dom.totalBal.innerText = formatVES(total);
    dom.totalPhysical.innerText = `$ ${physicalDollars.toFixed(2)}`;
    dom.balBanesco.innerText = formatVES(banesco);
    dom.balMercantil.innerText = formatVES(mercantil);

    if (bcvRates.usd > 0) {
        dom.usdConv.innerText = formatForeign(total / bcvRates.usd);
        dom.eurConv.innerText = formatForeign(total / bcvRates.eur);
    }
};

// Formulario submit
dom.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = document.getElementById('type').value;
    const account = document.getElementById('account').value;
    const amount = +document.getElementById('amount').value;
    const reason = document.getElementById('reason').value.trim();
    const date = document.getElementById('date').value;
    const editId = document.getElementById('edit-id').value;
    
    const isExchange = dom.isExchange.checked;
    const exchangeRate = isExchange ? +dom.exchangeRate.value : null;
    const usdAmount = isExchange ? (amount / exchangeRate) : 0;

    saveMotivo(reason);

    const txData = { 
        id: editId ? Number(editId) : generateID(), 
        type, account, amount, reason, date,
        isExchange, exchangeRate, usdAmount
    };

    if (editId) {
        transactions = transactions.map(t => t.id === txData.id ? txData : t);
    } else {
        transactions.push(txData);
    }

    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    localStorage.setItem('finanzas_transacciones', JSON.stringify(transactions));
    
    init();
    closeModal();
});

// Listener para el toggle de intercambio
dom.isExchange.addEventListener('change', (e) => {
    if (e.target.checked) {
        dom.exchangeFields.classList.remove('hidden');
        dom.exchangeRate.required = true;
        // Sugerir tasa BCV actual
        if (bcvRates.usd > 0) dom.exchangeRate.value = bcvRates.usd;
    } else {
        dom.exchangeFields.classList.add('hidden');
        dom.exchangeRate.required = false;
        dom.exchangeRate.value = '';
    }
});

const removeTransaction = (id) => {
    transactions = transactions.filter(t => t.id !== id);
    localStorage.setItem('finanzas_transacciones', JSON.stringify(transactions));
    init();
};

// Buscador
dom.searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderTransactions();
});

// --- Lógica del Calendario ---
const renderCalendar = () => {
    dom.calGrid.innerHTML = '';
    const date = new Date(currentYear, currentMonth, 1);
    const firstDay = date.getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    
    dom.calMonthYear.innerText = `${monthNames[currentMonth]} ${currentYear}`;

    // Espacios vacíos al inicio
    for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-day empty';
        dom.calGrid.appendChild(empty);
    }

    const todayStr = new Date().toISOString().split('T')[0];

    for (let i = 1; i <= daysInMonth; i++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'cal-day';
        dayDiv.innerText = i;
        
        // Formato de fecha YYYY-MM-DD
        const monthStr = String(currentMonth + 1).padStart(2, '0');
        const dayStr = String(i).padStart(2, '0');
        const fullDateStr = `${currentYear}-${monthStr}-${dayStr}`;

        if (fullDateStr === todayStr) dayDiv.classList.add('today');
        if (fullDateStr === filterDate) dayDiv.classList.add('selected');

        // ¿Hay transacciones este día?
        if (transactions.some(t => t.date === fullDateStr)) {
            const dot = document.createElement('div');
            dot.className = 'cal-dot';
            dayDiv.appendChild(dot);
        }

        dayDiv.onclick = () => {
            if (filterDate === fullDateStr) {
                filterDate = null; // Deseleccionar
                document.getElementById('calendar-filter-info').classList.add('hidden');
            } else {
                filterDate = fullDateStr;
                document.getElementById('calendar-filter-info').classList.remove('hidden');
                document.getElementById('calendar-filter-date').innerText = `Movimientos del ${dayStr}/${monthStr}/${currentYear}`;
            }
            renderCalendar();
            renderTransactions();
        };

        dom.calGrid.appendChild(dayDiv);
    }
};

document.getElementById('cal-prev').onclick = () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar();
};

document.getElementById('cal-next').onclick = () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar();
};

dom.btnToggleView.onclick = () => {
    const isHidden = dom.calContainer.classList.contains('hidden');
    if (isHidden) {
        dom.calContainer.classList.remove('hidden');
        dom.btnToggleView.innerHTML = '<i class="fa-solid fa-list"></i>';
        renderCalendar();
    } else {
        dom.calContainer.classList.add('hidden');
        dom.btnToggleView.innerHTML = '<i class="fa-solid fa-calendar"></i>';
        filterDate = null;
        document.getElementById('calendar-filter-info').classList.add('hidden');
        renderTransactions();
    }
};

document.getElementById('btn-clear-date-filter').onclick = () => {
    filterDate = null;
    document.getElementById('calendar-filter-info').classList.add('hidden');
    renderCalendar();
    renderTransactions();
};

// Cerrar modal click afuera
window.onclick = (e) => { if (e.target === dom.modal) closeModal(); };

// Init
const init = () => {
    updateMotivosDatalist();
    updateValues();
    renderTransactions();
    if (!dom.calContainer.classList.contains('hidden')) renderCalendar();
};

fetchBCV();
init();
