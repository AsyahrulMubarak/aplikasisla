(() => {
    const dialog = document.getElementById('invoice-reminder-dialog');
    const title = document.getElementById('invoice-reminder-title');
    const summary = document.getElementById('invoice-reminder-summary');
    const last = document.getElementById('invoice-reminder-last');
    const status = document.getElementById('invoice-reminder-status');
    const form = document.getElementById('invoice-reminder-form');
    const amountInput = document.getElementById('invoice-reminder-amount');
    const dueInput = document.getElementById('invoice-reminder-due');
    const preview = document.getElementById('invoice-reminder-preview');
    const submit = document.getElementById('invoice-reminder-submit');
    const approve = document.getElementById('invoice-reminder-approve');
    const rupiah = new Intl.NumberFormat('id-ID');
    const waktuWita = new Intl.DateTimeFormat('id-ID', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Makassar'
    });
    const statusPengiriman = {
        pending: 'Menunggu pengiriman pada jam kerja cabang.',
        sending: 'Sedang diproses untuk dikirim.',
        sent: 'Diterima penyedia WhatsApp.',
        uncertain: 'Hasil pengiriman belum pasti. Hubungi pengelola WhatsApp untuk memeriksa pesan ini.',
        failed: 'Pengiriman gagal. Periksa data sebelum menyetujui pengingat baru.',
        obsolete: 'Pengingat dibatalkan karena data berubah.'
    };
    let opened = null;

    window.htmlTombolPengingatNota_ = ticket => {
        if (!bolehChatAdminTiket_(ticket) || statusNotaTiket_(ticket) !== 'belum_lunas' ||
            String(ticket.Status || '').trim().toLowerCase() !== 'selesai') return '';
        const ticketId = idAman_(ticket['ID Tiket']);
        const invoice = normalisasiNoTransaksiNota_(
            ticket['No Transaksi'] || ticket['No. Transaksi'] || ticket['Nomor Transaksi']
        );
        if (!ticketId || !/^[A-Z0-9][A-Z0-9/._-]{0,119}$/.test(invoice)) return '';
        return `<button type="button" class="btn-action-primary" data-invoice-reminder="${ticketId}">Pengingat Pembayaran</button>`;
    };

    function resetPreview(current) {
        current.approval = null;
        preview.hidden = true;
        preview.replaceChildren();
        submit.hidden = false;
        approve.hidden = true;
    }

    function showRecipient(result) {
        summary.textContent = `Nota ${result.invoiceNumber} · ${result.client || 'Klien'} · WhatsApp +${result.phone}`;
        summary.hidden = false;
    }

    function showPreview(message) {
        preview.replaceChildren();
        message.split(/\*([^*\n]+)\*/).forEach((part, index) => {
            if (index % 2 === 0) {
                preview.append(document.createTextNode(part));
                return;
            }
            const strong = document.createElement('strong');
            strong.textContent = part;
            preview.append(strong);
        });
        preview.hidden = false;
    }

    function setBusy(current, busy) {
        current.busy = busy;
        amountInput.readOnly = dueInput.readOnly = submit.disabled = approve.disabled = busy;
        form.setAttribute('aria-busy', String(busy));
    }

    function request(current, mode, payload = {}) {
        return kirimKeBackend_(API_URL_CABANG[current.branch], 'invoiceReminder', {
            idTiket: current.ticketId, mode, ...payload
        });
    }

    document.addEventListener('click', async event => {
        const button = event.target.closest('[data-invoice-reminder]');
        if (!button || !cabangAktif || dialog.open) return;
        const current = { ticketId: button.dataset.invoiceReminder, branch: cabangAktif };
        opened = current;
        form.reset();
        form.hidden = summary.hidden = last.hidden = true;
        resetPreview(current);
        setBusy(current, false);
        status.textContent = 'Memuat data nota dan penerima WhatsApp…';
        dialog.showModal();
        try {
            const result = await request(current, 'detail');
            if (opened !== current || !dialog.open) return;
            showRecipient(result);
            const previous = result.lastReminder;
            if (previous) {
                const time = waktuWita.format(new Date(previous.sentAt || previous.createdAt));
                last.textContent = `Pengingat terakhir ${time} WITA · Saldo saat disetujui Rp${rupiah.format(previous.amount)} · Jatuh tempo ${previous.due.split('-').reverse().join('/')}. ${statusPengiriman[previous.state]}`;
                last.hidden = false;
                amountInput.value = rupiah.format(previous.amount);
                dueInput.value = previous.due;
            }
            status.textContent = '';
            form.hidden = result.blocked;
        } catch (error) {
            if (opened === current && dialog.open) status.textContent = error.message;
        }
    });

    form.addEventListener('input', () => {
        if (!opened) return;
        resetPreview(opened);
        status.textContent = '';
    });

    async function submitReminder(mode) {
        const current = opened;
        if (!current || current.busy || form.hidden) return;
        const approval = current.approval;
        if ((mode === 'approve') !== Boolean(approval)) return;
        const input = amountInput.value.trim().replace(/^rp\s*/i, '');
        const amount = Number(input.replace(/\./g, ''));
        if (!/^(?:\d{1,12}|\d{1,3}(?:\.\d{3}){1,3})$/.test(input) || amount < 1) {
            status.textContent = 'Masukkan sisa tagihan positif dalam rupiah, misalnya 250.000.';
            amountInput.focus();
            return;
        }
        const due = dueInput.value;
        setBusy(current, true);
        status.textContent = approval ? 'Menyimpan persetujuan…' : 'Menyiapkan pratinjau…';
        try {
            const result = await request(current, mode, { amount, due, approval });
            if (opened !== current || !dialog.open) return;
            if (approval) {
                form.hidden = true;
                status.textContent = statusPengiriman[result.state];
                title.focus();
            } else {
                current.approval = result.approval;
                showRecipient(result);
                showPreview(result.message);
                submit.hidden = true;
                approve.hidden = false;
                status.textContent = '';
                preview.focus();
            }
        } catch (error) {
            if (opened !== current || !dialog.open) return;
            resetPreview(current);
            status.textContent = error.message;
        } finally {
            if (opened === current && dialog.open) setBusy(current, false);
        }
    }

    form.addEventListener('submit', event => {
        event.preventDefault();
        submitReminder('preview');
    });
    approve.addEventListener('click', () => submitReminder('approve'));
})();
