(() => {
 'use strict';
 const STORAGE_KEY='advance-request-form-v1', model=window.AdvanceModel, recordsApi=window.AdvanceRecords;
 const recordStore=new recordsApi.RecordStore();
 let state=model.normalizeSnapshot({}),activeRecord=null,savedFingerprint=null,recordLabel='',recordVersionNumber=0;
 let operationQueue=Promise.resolve(),pendingOperations=0,printSession=null,historyRecords=[],historyPage=0;
 const HISTORY_PAGE_SIZE=20;
 const elements={form:document.querySelector('#voucherForm'),printOverlay:document.querySelector('#printOverlay'),saveStatus:document.querySelector('#saveStatus'),toast:document.querySelector('#toast')};
 // Keep legacy receiverName data compatible with old versions/backups, but never expose a control or print binding.
 const EDITABLE_FIELDS=Object.keys(model.FIELDS).filter(key=>key!=='receiverName');
 const numberFormatter=new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2});
 let saveTimer=0,toastTimer=0;
 function showToast(message,duration=3500){clearTimeout(toastTimer);elements.toast.textContent=message;elements.toast.classList.add('show');toastTimer=setTimeout(()=>elements.toast.classList.remove('show'),duration);}
 function persist(){clearTimeout(saveTimer);elements.saveStatus.textContent='草稿儲存中…';saveTimer=setTimeout(()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify({...state,recordRef:activeRecord}));elements.saveStatus.textContent='草稿已自動儲存';}catch{elements.saveStatus.textContent='草稿儲存失敗，請匯出備份';}},220);}
 function restore(){try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(saved){state=model.normalizeSnapshot(saved);if(typeof saved.recordRef?.id==='string'&&typeof saved.recordRef?.versionId==='string')activeRecord={id:saved.recordRef.id,versionId:saved.recordRef.versionId};}}catch{showToast('草稿無法讀取，請由備份或紀錄庫載入');}}
 function syncControlsFromState(){for(const key of EDITABLE_FIELDS)document.getElementById(key).value=state[key];elements.form.querySelectorAll('[data-check]').forEach(n=>n.checked=state.checks[n.dataset.check]);}
 function fieldActive(key){
  const payment=model.PAYMENTS.find(x=>x[2]===key);if(payment)return state.checks[payment[0]];
  if(['bankName','bankCode','bankAccount','accountName'].includes(key))return state.checks.transfer;
  if(['vendor','dueDate','chequeTitle'].includes(key))return state.checks.cheque||state.checks.draft;
  if(key==='proofOtherText')return state.checks.proofOther;
  if(key==='basisNote')return ['basisBudget','basisApproval','basisContract'].some(k=>state.checks[k]);return true;
 }
 function updateOptionInputs(){for(const key of EDITABLE_FIELDS)document.getElementById(key).disabled=Boolean(printSession)||!fieldActive(key);document.querySelector('#bankEditor').hidden=!state.checks.transfer;document.querySelector('#chequeEditor').hidden=!(state.checks.cheque||state.checks.draft);}
 function setPrintedText(node,value){const child=document.createElement('span');child.className='printed-text';const content=document.createElement('span');content.className='printed-content';content.textContent=value;child.append(content);node.replaceChildren(child);}
 function fitPrintedText(){elements.printOverlay.querySelectorAll('.printed-field').forEach(node=>{
  node.style.setProperty('--fit-ratio','1');const text=node.querySelector('.printed-content');if(!text)return;text.style.transform='';if(!text.textContent)return;
  if(node.classList.contains('multiline')){
   let ratio=1;for(let i=0;i<35&&(text.getBoundingClientRect().height>node.clientHeight+.5||text.scrollWidth>node.clientWidth+.5);i++){ratio*=.94;node.style.setProperty('--fit-ratio',String(ratio));}
  }else{
   const available=node.getBoundingClientRect().width,natural=text.getBoundingClientRect().width;
   if(natural>available&&available>0){
    node.style.setProperty('--fit-ratio',String(Math.max(.01,(available-2)/natural)));
    const actual=text.getBoundingClientRect().width;
    // CJK glyph rounding or a browser minimum font size can still exceed the cell.
    // Scale only the text content, with its wrapper constrained to the cell width.
    if(actual>available-1)text.style.transform=`scaleX(${Math.max(.01,(available-1)/actual)})`;
   }
  }
 });}
 function renderPreview(){
  updateOptionInputs();elements.printOverlay.querySelectorAll('[data-value]').forEach(node=>{
   const key=node.dataset.value;let value=fieldActive(key)?state[key]:'';
   if(model.DATES.includes(key))value=model.rocDate(value);
   else if(model.MONEY.includes(key))value=model.formatMoney(value);
   setPrintedText(node,value);
  });
  elements.printOverlay.querySelectorAll('[data-print-check]').forEach(node=>{const checked=state.checks[node.dataset.printCheck];node.textContent='';node.classList.toggle('is-selected',checked);node.setAttribute('aria-label',node.getAttribute('aria-label').replace(/(?:已勾選|未勾選)$/,'')+(checked?'已勾選':'未勾選'));});
  const digits=document.querySelector('#amountDigits');digits.replaceChildren(...model.amountDigits(state.advanceAmount).map(value=>{const span=document.createElement('span');span.textContent=value;return span;}));
  const result=model.paymentSummary(state),summary=document.querySelector('#paymentSummary');summary.classList.remove('warning');
  if(result.invalid)summary.textContent='請確認金額格式。';
  else if(!result.selected)summary.textContent='請選擇付款方式，可同時勾選多項。';
  else{summary.textContent=`已選付款合計：新台幣 ${numberFormatter.format(result.total/100)}`;
   if(result.missing){summary.textContent+='；尚有勾選項目未填金額。';summary.classList.add('warning');}
   else if(result.comparable){summary.textContent+=result.match?'，與暫借金額一致。':'，與暫借金額不一致，請確認。';summary.classList.toggle('warning',!result.match);}
   else if(!['新台幣','新臺幣','TWD','NTD','NT$'].includes(state.currency.trim().toUpperCase()))summary.textContent+='；幣別不同，請自行核對換算。';
  }
  const errors=model.validation(state);document.querySelector('#validationMessage').textContent=errors.join('；');fitPrintedText();renderRecordContext();
 }
 function validateForAction(){const errors=model.validation(state);if(errors.length){showToast(errors[0],6500);return false;}return true;}
 function clearForm(){if(printSession||pendingOperations||!allowReplaceDraft('新增申請單'))return;state=model.normalizeSnapshot({});activeRecord=null;savedFingerprint=null;recordLabel='';recordVersionNumber=0;syncControlsFromState();renderPreview();persist();showToast('已新增申請單，歷史紀錄仍保留');}
 function bindFormEvents(){
  for(const key of EDITABLE_FIELDS)document.getElementById(key).addEventListener('input',e=>{state[key]=e.currentTarget.value;renderPreview();persist();});
  elements.form.querySelectorAll('[data-check]').forEach(n=>n.addEventListener('change',e=>{state.checks[e.currentTarget.dataset.check]=e.currentTarget.checked;renderPreview();persist();}));
  elements.form.addEventListener('submit',e=>e.preventDefault());
  document.querySelector('#clearButton').addEventListener('click',clearForm);document.querySelector('#printButton').addEventListener('click',saveAndPrint);
 }
  function renderRecordContext() {
    const node = document.querySelector("#recordContext");
    if (!activeRecord) node.textContent = "新申請單・尚未存入紀錄庫";
    else if (!recordLabel) node.textContent = "正在讀取原紀錄…";
    else {
      const changed = savedFingerprint !== recordsApi.fingerprint(state);
      node.textContent = `${recordLabel}・第 ${recordVersionNumber} 版${changed ? "・已修改，儲存後保留為新版本" : "・已存入紀錄庫"}`;
    }
  }

  function allowReplaceDraft(action) {
    const snapshot = recordsApi.normalizeSnapshot(state);
    const hasContent = Object.entries(snapshot).some(([key,value]) => key === "checks" ? Object.values(value).some(Boolean) : key !== "currency" && Boolean(value));
    if (!hasContent || recordsApi.fingerprint(snapshot) === savedFingerprint) return true;
    return window.confirm(`目前尚未存入紀錄的內容會被取代。確定要${action}嗎？`);
  }

  function storageError(error) {
    const message = error?.name === "QuotaExceededError" ? "本機儲存空間不足，尚未存入紀錄。請先匯出備份，再整理舊紀錄。" : `紀錄操作未完成：${error?.message || "請重新整理後再試"}`;
    showToast(message, 6500);
    return message;
  }

  function updateBusy() {
    const printing = Boolean(printSession);
    for (const id of ["saveRecordButton", "printButton", "clearButton", "exportBackupButton", "importBackupButton"]) document.querySelector(`#${id}`).disabled = pendingOperations > 0 || printing;
    for (const control of elements.form.elements) control.disabled = printing;
    updateOptionInputs();

  }

  function queueOperation(work) {
    pendingOperations++;
    updateBusy();
    const result = operationQueue.then(work);
    operationQueue = result.catch(() => {});
    return result.finally(() => { pendingOperations--; updateBusy(); });
  }

  function saveCurrent(printRequested = false) {
    const snapshot = recordsApi.normalizeSnapshot(state);
    return queueOperation(async () => {
      const result = await recordStore.save(snapshot, activeRecord, printRequested);
      activeRecord = { id: result.record.id, versionId: result.version.id };
      recordLabel = result.record.number;
      recordVersionNumber = result.version.number;
      savedFingerprint = recordsApi.fingerprint(result.version.snapshot);
      renderRecordContext();
      persist();
      showToast(printRequested ? `${recordLabel} 已儲存，已記錄本次開啟列印` : `${recordLabel} 第 ${recordVersionNumber} 版已儲存`);
      if (document.querySelector("#historyDialog").open) await refreshHistory();
      return result;
    });
  }

  async function saveAndPrint() {
    if (printSession || pendingOperations) return;
    const session = {};
    printSession = session;
    updateBusy();
    try {
      if (!validateForAction()) return;
      await saveCurrent(true);
      if (document.fonts) await document.fonts.ready;
      fitPrintedText();
      window.print();
    } catch (error) { storageError(error); }
    finally { if (printSession === session) printSession = null; updateBusy(); }
  }

  function handleBeforePrint() {
    fitPrintedText();
    if (printSession || !validateForAction()) return;
    const session = {};
    printSession = session;
    updateBusy();
    // Also retain a snapshot when the browser's Ctrl+P/menu starts printing.
    // Browser print completion is not proof of a successful paper print.
    saveCurrent(true).catch(storageError);
  }

  const displayTime = value => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  function makeNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function recordButton(text, action, danger = false) {
    const button = makeNode("button", `button button-secondary${danger ? " record-delete" : ""}`, text);
    button.type = "button";
    button.addEventListener("click", () => {
      if (pendingOperations || printSession) { showToast("請稍候，紀錄正在儲存或列印"); return; }
      Promise.resolve().then(action).catch(storageError);
    });
    return button;
  }

  async function loadRecord(id, versionId) {
    const record = await queueOperation(() => recordStore.get(id));
    const version = record?.versions.find(v => v.id === versionId);
    if (!version) throw new Error("這份紀錄已不存在，請重新開啟紀錄庫");
    if (!allowReplaceDraft("載入此紀錄")) return false;
    Object.assign(state, recordsApi.normalizeSnapshot(version.snapshot));
    activeRecord = { id, versionId };
    recordLabel = record.number;
    recordVersionNumber = version.number;
    savedFingerprint = recordsApi.fingerprint(version.snapshot);
    syncControlsFromState();
    
    renderPreview();
    persist();
    document.querySelector("#historyDialog").close();
    showToast(`已載入 ${record.number} 第 ${version.number} 版`);
    return true;
  }

  function renderHistory() {
    const query = document.querySelector("#historySearch").value.trim().toLocaleLowerCase();
    const start = document.querySelector("#historyStart").value.replace(/-/g, "");
    const end = document.querySelector("#historyEnd").value.replace(/-/g, "");
    const filtered = historyRecords.filter(record => {
      // A date matches any saved version; older revisions remain searchable.
      const matchesDate = record.versions.some(version => {
        const stamp = recordsApi.dayStamp(new Date(version.savedAt));
        return (!start || stamp >= start) && (!end || stamp <= end);
      });
      const searchable = [record.number, ...record.versions.flatMap(version => Object.values(recordsApi.normalizeSnapshot(version.snapshot)).filter(value => typeof value === "string"))].join(" ").toLocaleLowerCase();
      return matchesDate && (!query || searchable.includes(query));
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.number.localeCompare(a.number));
    const pageCount = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));
    historyPage = Math.max(0, Math.min(historyPage, pageCount - 1));
    const list = document.querySelector("#historyList");
    list.replaceChildren();
    document.querySelector("#historySummary").textContent = `共 ${historyRecords.length} 張申請單・符合篩選 ${filtered.length} 張。修改後儲存會保留舊版本；「標記已列印」由你確認紙張已印出。`;
    if (!filtered.length) list.append(makeNode("p", "history-empty", historyRecords.length ? "沒有符合條件的紀錄，請調整搜尋或日期。" : "目前尚無紀錄。填寫完成後，按「儲存紀錄」或「儲存並列印」即可加入。"));
    for (const record of filtered.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE)) {
      const article = makeNode("article", "record-card");
      article.dataset.recordId = record.id;
      const header = makeNode("div", "record-card-header");
      const number = makeNode("strong", "", record.number);
      const amount = makeNode("span", "record-card-amount");
      header.append(number, amount);
      const title = makeNode("p", "record-card-title");
      const meta = makeNode("p", "record-card-meta");
      const status = makeNode("p", "record-card-meta");
      const actions = makeNode("div", "record-actions");
      const select = makeNode("select", "record-version-select");
      select.setAttribute("aria-label", `${record.number} 版本`);
      for (const version of record.versions.slice().reverse()) {
        const option = makeNode("option", "", `第 ${version.number} 版・${displayTime(version.savedAt)}`);
        option.value = version.id;
        select.append(option);
      }
      const chosen = () => record.versions.find(version => version.id === select.value);
      const confirm = recordButton("標記已列印", async () => {
        const version = chosen();
        const event = version.printEvents.slice().reverse().find(e => !e.confirmedAt);
        if (!event) return;
        await queueOperation(() => recordStore.confirmPrint(record.id, version.id, event.id));
        await refreshHistory();
        showToast("已標記這次列印完成");
      });
      function updateCard() {
        const version = chosen();
        const snapshot = recordsApi.normalizeSnapshot(version.snapshot);
        title.textContent = `${snapshot.unit || "未填單位"} / ${snapshot.purpose || "未填用途"}`;
        amount.textContent = `${snapshot.currency || "新台幣"} ${model.formatMoney(snapshot.advanceAmount)}`;
        const paymentText = model.PAYMENTS.filter(([key]) => snapshot.checks[key]).map(([, label]) => label).join("、") || "未勾選";
        meta.textContent = `請款日期：${model.rocDate(snapshot.requestDate) || "—"}・廠商：${snapshot.vendor || "—"}・付款：${paymentText}・首次儲存：${displayTime(record.createdAt)}`;
        const confirmed = version.printEvents.filter(event => event.confirmedAt).length;
        const lastPrint = version.printEvents.at(-1);
        status.textContent = `${record.versions.length} 個版本・本版開啟列印 ${version.printEvents.length} 次・已確認 ${confirmed} 次${lastPrint ? `・最近開啟列印：${displayTime(lastPrint.requestedAt)}` : ""}${record.originalNumber ? `・匯入前編號：${record.originalNumber}` : ""}`;
        confirm.disabled = version.printEvents.every(event => event.confirmedAt);
      }
      select.addEventListener("change", updateCard);
      actions.append(select,
        recordButton("載入修改", () => loadRecord(record.id, chosen().id)),
        recordButton("重新列印", async () => { if (await loadRecord(record.id, chosen().id)) await saveAndPrint(); }),
        confirm,
        recordButton("刪除", async () => {
          if (!window.confirm(`刪除 ${record.number} 的全部版本與列印紀錄？此操作無法復原，請先匯出備份。`)) return;
          await queueOperation(() => recordStore.remove(record.id));
          if (activeRecord?.id === record.id) { activeRecord = null; savedFingerprint = null; recordLabel = ""; renderRecordContext(); persist(); }
          await refreshHistory();
          showToast("已刪除此申請單紀錄");
        }, true));
      article.append(header, title, meta, status, actions);
      updateCard();
      list.append(article);
    }
    document.querySelector("#previousHistoryPage").disabled = historyPage === 0;
    document.querySelector("#nextHistoryPage").disabled = historyPage >= pageCount - 1;
    document.querySelector("#historyPageLabel").textContent = `第 ${historyPage + 1} / ${pageCount} 頁`;
  }

  async function refreshHistory() {
    const [records, lastExport] = await Promise.all([recordStore.list(), recordStore.lastExport()]);
    historyRecords = records;
    document.querySelector("#backupStatus").textContent = lastExport ? `最近匯出：${displayTime(lastExport)}` : "尚未匯出備份";
    renderHistory();
  }

  async function exportBackup() {
    await queueOperation(async () => {
      const backup = await recordStore.exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = makeNode("a");
      link.href = url;
      link.download = `申請單備份_${recordsApi.dayStamp(new Date(backup.exportedAt))}_${backup.exportedAt.replace(/[:.]/g, "-")}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      await recordStore.noteExport(backup.exportedAt);
      await refreshHistory();
      showToast(`已匯出 ${backup.records.length} 張申請單，包含所有版本與列印紀錄`);
    });
  }

  async function importBackup(file) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) throw new Error("備份檔超過 25 MB，請分批整理後再匯入");
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { throw new Error("備份檔不是有效的 JSON，請選擇由紀錄庫匯出的備份檔"); }
    const backup = recordsApi.validateBackup(parsed);
    if (!window.confirm(`備份含 ${backup.records.length} 張申請單。匯入會合併版本與列印紀錄，不會刪除現有資料。確定匯入？`)) return;
    const stats = await queueOperation(() => recordStore.importBackup(backup));
    await refreshHistory();
    showToast(`匯入完成：新增 ${stats.added} 張、合併 ${stats.merged} 張、略過 ${stats.skipped} 張${stats.renumbered ? `；${stats.renumbered} 張同號紀錄已重新編號` : ""}`);
  }

  function bindRecordEvents() {
    document.querySelector("#saveRecordButton").addEventListener("click", () => { if (validateForAction()) saveCurrent().catch(storageError); });
    document.querySelector("#historyButton").addEventListener("click", async () => {
      document.querySelector("#historySummary").textContent = "正在載入紀錄…";
      document.querySelector("#historyList").replaceChildren();
      document.querySelector("#historyDialog").showModal();
      try { await refreshHistory(); } catch (error) { document.querySelector("#historySummary").textContent = storageError(error); }
    });
    document.querySelector("#closeHistoryButton").addEventListener("click", () => document.querySelector("#historyDialog").close());
    document.querySelector("#exportBackupButton").addEventListener("click", () => exportBackup().catch(storageError));
    document.querySelector("#importBackupButton").addEventListener("click", () => document.querySelector("#backupFile").click());
    document.querySelector("#backupFile").addEventListener("change", event => {
      const file = event.currentTarget.files[0];
      event.currentTarget.value = "";
      importBackup(file).catch(storageError);
    });
    for (const id of ["historySearch", "historyStart", "historyEnd"]) document.querySelector(`#${id}`).addEventListener("input", () => { historyPage = 0; renderHistory(); });
    document.querySelector("#resetHistoryFilters").addEventListener("click", () => {
      for (const id of ["historySearch", "historyStart", "historyEnd"]) document.querySelector(`#${id}`).value = "";
      historyPage = 0;
      renderHistory();
    });
    document.querySelector("#previousHistoryPage").addEventListener("click", () => { historyPage--; renderHistory(); });
    document.querySelector("#nextHistoryPage").addEventListener("click", () => { historyPage++; renderHistory(); });
    window.addEventListener("storage", event => { if (event.key === STORAGE_KEY) showToast("另一個分頁更新了草稿；此頁的填寫內容仍保留，請避免同時編輯同一張單。"); });
    window.addEventListener("focus", () => { if (document.querySelector("#historyDialog").open) refreshHistory().catch(storageError); });
    recordStore.open().then(async () => {
      if (!activeRecord) return;
      const reference = { ...activeRecord };
      const record = await recordStore.get(reference.id);
      if (activeRecord?.id !== reference.id || activeRecord?.versionId !== reference.versionId) return;
      const version = record?.versions.find(v => v.id === reference.versionId);
      if (!version) { activeRecord = null; savedFingerprint = null; persist(); }
      else { recordLabel = record.number; recordVersionNumber = version.number; savedFingerprint = recordsApi.fingerprint(version.snapshot); }
      renderRecordContext();
    }).catch(storageError);
  }

 restore();syncControlsFromState();renderPreview();bindFormEvents();bindRecordEvents();
 window.addEventListener('beforeprint',handleBeforePrint);
 window.addEventListener('afterprint',()=>{printSession=null;updateBusy();fitPrintedText();});
 window.addEventListener('resize',fitPrintedText);
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(fitPrintedText).observe(document.querySelector('#paper'));
 if(document.fonts)document.fonts.ready.then(fitPrintedText);
})();
