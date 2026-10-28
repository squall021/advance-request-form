(function(root){
  'use strict';
  const FIELDS={unit:40,receivedDate:10,requestDate:10,purpose:240,basisNote:150,exchangeRate:20,currency:12,advanceAmount:16,useDate:10,cashAmount:16,transferAmount:16,chequeAmount:16,draftAmount:16,bankName:60,bankCode:12,bankAccount:40,accountName:60,vendor:60,dueDate:10,chequeTitle:60,offsetDate:10,proofOtherText:80,notes:300,receiverName:30};
  const CHECK_FIELDS=['basisBudget','basisApproval','basisContract','cash','transfer','cheque','draft','proofInvoice','proofTicket','proofReceipt','proofAcknowledgment','proofOther'];
  const PAYMENTS=[['cash','現金','cashAmount'],['transfer','匯款','transferAmount'],['cheque','開票','chequeAmount'],['draft','銀行本票','draftAmount']];
  const DATES=['receivedDate','requestDate','useDate','dueDate','offsetDate'];
  const MONEY=['advanceAmount',...PAYMENTS.map(x=>x[2])];
  function cents(value){
    const s=String(value??'').trim();if(!s)return null;
    if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s))throw Error('金額須為非負數，最多兩位小數');
    const [a,b='']=s.replaceAll(',','').split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));
    if(!Number.isSafeInteger(n)||n>9999999999)throw Error('金額超過原表範圍，最多 99,999,999.99');return n;
  }
  function validDate(s){if(!/^\d{4}-\d\d-\d\d$/.test(s)||Number(s.slice(0,4))<1912)return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;}
  function rocDate(s){if(!validDate(s))return '';const[y,m,d]=s.split('-');return `${Number(y)-1911}年${Number(m)}月${Number(d)}日`;}
  function formatMoney(s){try{const n=cents(s);return n===null?'':new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2}).format(n/100);}catch{return '';}}
  function amountDigits(s){let n;try{n=cents(s);}catch{return Array(10).fill('');}if(n===null)return Array(10).fill('');return (String(Math.floor(n/100)).padStart(8,' ')+String(n%100).padStart(2,'0')).split('').map(x=>x.trim());}
  function normalizeSnapshot(value,strict=false){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('申請單內容格式不正確');const s={};
    for(const[key,max]of Object.entries(FIELDS)){
      if(strict&&value[key]!==undefined&&(typeof value[key]!=='string'||value[key].length>max))throw Error(`備份中的 ${key} 欄位不正確`);
      s[key]=String(value[key]??(key==='currency'?'新台幣':'')).slice(0,max);
    }
    const c=value.checks;if(strict&&(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!CHECK_FIELDS.includes(k))))throw Error('備份中的勾選資料不正確');
    s.checks=Object.fromEntries(CHECK_FIELDS.map(k=>{if(strict&&c[k]!==undefined&&typeof c[k]!=='boolean')throw Error('勾選值必須為 true 或 false');return[k,c?.[k]===true];}));
    if(strict){const errors=validation(s);if(errors.length)throw Error(errors[0]);}return s;
  }
  function validation(s){const errors=[];
    for(const k of MONEY){try{cents(s[k]);}catch(e){errors.push(`${k==='advanceAmount'?'暫借金額':PAYMENTS.find(x=>x[2]===k)[1]+'金額'}：${e.message}`);}}
    for(const k of DATES)if(s[k]&&!validDate(s[k]))errors.push('日期不正確，請使用有效的西元日期（1912 年起）');
    if(s.exchangeRate&&(!/^\d+(?:\.\d{1,9})?$/.test(s.exchangeRate)||Number(s.exchangeRate)<=0||Number(s.exchangeRate)>1e9))errors.push('匯率須為正數，最多九位小數');return errors;
  }
  function paymentSummary(s){let total=0;const selected=PAYMENTS.filter(([k])=>s.checks[k]);try{
    for(const[,,field]of selected)total+=cents(s[field])??0;
    const target=cents(s.advanceAmount);const missing=selected.some(([,,f])=>cents(s[f])===null);
    const twd=['新台幣','新臺幣','TWD','NTD','NT$'].includes(s.currency.trim().toUpperCase());
    return{total,selected:selected.length,missing,comparable:twd&&target!==null&&selected.length>0,match:target===total&&!missing};
  }catch{return{invalid:true};}}
  const api={FIELDS,CHECK_FIELDS,PAYMENTS,DATES,MONEY,cents,validDate,rocDate,formatMoney,amountDigits,normalizeSnapshot,validation,paymentSummary,fingerprint:s=>JSON.stringify(normalizeSnapshot(s))};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AdvanceModel=api;
})(typeof window!=='undefined'?window:globalThis);
