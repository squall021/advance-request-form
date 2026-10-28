const test=require('node:test'),assert=require('node:assert/strict'),m=require('../model.js');

test('money keeps cents and rejects overflow rather than truncating',()=>{
 assert.equal(m.cents('1,234.56'),123456);assert.equal(m.cents('0.29'),29);assert.equal(m.cents('99,999,999.99'),9999999999);
 for(const value of ['100000000','-1','1.234','12,34','x'])assert.throws(()=>m.cents(value));
 assert.deepEqual(m.amountDigits('123456.78'),['','','1','2','3','4','5','6','7','8']);assert.deepEqual(m.amountDigits(''),Array(10).fill(''));
});
test('ROC dates reject nonexistent leap days',()=>{assert.equal(m.rocDate('2026-10-28'),'115年10月28日');assert.equal(m.rocDate('2024-02-29'),'113年2月29日');assert.equal(m.rocDate('2026-02-29'),'');});
test('payment split uses selected amounts only and compares same currency',()=>{
 const s=m.normalizeSnapshot({currency:'新台幣',advanceAmount:'0.30',cashAmount:'0.1',transferAmount:'0.2',chequeAmount:'999',checks:{cash:true,transfer:true}});
 assert(m.paymentSummary(s).match);s.checks.transfer=false;assert.equal(m.paymentSummary(s).total,10);assert(!m.paymentSummary(s).match);assert.equal(s.transferAmount,'0.2');s.currency='USD';assert(!m.paymentSummary(s).comparable);
});
test('backup values retain leading zeros and reject invalid types',()=>{const s=m.normalizeSnapshot({bankCode:'004',bankAccount:'001234'});assert.equal(s.bankAccount,'001234');assert.equal(m.normalizeSnapshot(s,true).bankCode,'004');assert.throws(()=>m.normalizeSnapshot({...s,checks:{cash:'true'}},true));});
