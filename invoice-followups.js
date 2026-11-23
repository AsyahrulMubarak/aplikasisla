(() => {
    const open = document.getElementById('invoice-followups-open');
    const dialog = document.getElementById('invoice-followups-dialog');
    const title = document.getElementById('invoice-followups-title');
    const status = document.getElementById('invoice-followups-status');
    const list = document.getElementById('invoice-followups-list');
    let session = null;

    function hasAccess() {
        return Boolean(penggunaAktif && API_URL_CABANG[cabangAktif] &&
            roleAdalahAdminOperasional_() && penggunaBolehMengaksesCabang(cabangAktif) &&
            (rolePengguna() !== 'admin_raha' || cabangAktif === 'Raha'));
    }

    window.perbaruiAksesTugasPembayaran_ = () => {
        open.hidden = !hasAccess();
        if (dialog.open && (open.hidden || session?.branch !== cabangAktif || session?.account !== penggunaAktif)) {
            dialog.close();
        }
    };

    function isCurrent(current) {
        return current && session === current && dialog.open && cabangAktif === current.branch &&
            penggunaAktif === current.account && hasAccess();
    }

    function renderTasks(tasks, completed) {
        list.replaceChildren();
        status.textContent = completed
            ? (tasks.length ? 'Tugas ditandai sudah ditindaklanjuti.' : 'Tugas ditandai sudah ditindaklanjuti. Tidak ada tugas tersisa.')
            : (tasks.length ? '' : 'Tidak ada tugas follow-up untuk cabang ini.');
        for (const task of tasks) {
            const row = document.createElement('article');
            const invoice = document.createElement('strong');
            const reference = document.createElement('p');
            const due = document.createElement('p');
            const complete = document.createElement('button');
            invoice.textContent = `Nota ${task.invoiceNumber}`;
            reference.textContent = `${task.ticketId}${task.client ? ' · ' + task.client : ''}`;
            due.textContent = 'Jatuh tempo ' + task.due.split('-').reverse().join('/');
            complete.type = 'button';
            complete.className = 'btn-action-primary';
            complete.textContent = 'Tandai Sudah Ditindaklanjuti';
            complete.addEventListener('click', () => loadTasks(session, task.id));
            row.append(invoice, reference, due, complete);
            list.append(row);
        }
    }

    async function loadTasks(current, taskId = null) {
        if (!isCurrent(current) || current.busy) return;
        current.busy = true;
        list.setAttribute('aria-busy', 'true');
        list.querySelectorAll('button').forEach(button => { button.disabled = true; });
        status.textContent = taskId ? 'Menyimpan tindak lanjut…' : 'Memuat tugas cabang…';
        try {
            const result = await kirimKeBackend_(API_URL_CABANG[current.branch], 'invoiceFollowups', { taskId });
            if (!isCurrent(current)) return;
            renderTasks(result.tasks, Boolean(taskId));
            if (taskId) title.focus();
        } catch (error) {
            if (isCurrent(current)) status.textContent = error.message;
        } finally {
            current.busy = false;
            if (isCurrent(current)) {
                list.setAttribute('aria-busy', 'false');
                list.querySelectorAll('button').forEach(button => { button.disabled = false; });
            }
        }
    }

    open.addEventListener('click', () => {
        if (!hasAccess() || dialog.open) return;
        session = { branch: cabangAktif, account: penggunaAktif };
        list.replaceChildren();
        dialog.showModal();
        loadTasks(session);
    });
})();
