/** EMESSA Phase 2: owner-only read API. Install in a dedicated staging project.
 * This file deliberately does not import or invoke the legacy write/migration code.
 * Required Script Properties: ADMIN_EMAIL, SALES_SPREADSHEET_ID.
 * Optional until its connection test: INVESTMENT_SPREADSHEET_ID.
 */
function emessaRead(request) {
  try {
    var config = PropertiesService.getScriptProperties().getProperties();
    var owner = String(config.ADMIN_EMAIL || '').trim().toLowerCase();
    var effective = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
    if (!owner || !effective || owner !== effective) return emessaFailure_('FORBIDDEN');
    if (!request || request.version !== 1 || ['health', 'workspace.read'].indexOf(request.operation) === -1)
      return emessaFailure_('FORBIDDEN');
    if (!emessaId_(config.SALES_SPREADSHEET_ID)) return emessaFailure_('SETUP_REQUIRED');
    if (request.operation === 'health') return { ok: true, data: emessaHealth_(config) };
    return { ok: true, data: emessaWorkspace_(config) };
  } catch (error) {
    var message = String(error && error.message || '');
    if (message.indexOf('EMESSA_SCHEMA') >= 0) return emessaFailure_('SCHEMA_MISMATCH');
    if (/quota|too many|rate limit/i.test(message)) return emessaFailure_('QUOTA_EXCEEDED');
    return emessaFailure_('GOOGLE_EXECUTION_FAILED');
  }
}
function emessaFailure_(code) { return { ok: false, error: { code: code } }; }
function emessaId_(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{10,180}$/.test(id); }
function emessaNorm_(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
function emessaText_(value, max) { return emessaNorm_(value).slice(0, max || 200); }
function emessaNumber_(value) {
  if (value === '' || value == null || typeof value === 'boolean') return null;
  var n = Number(value); return isFinite(n) ? n : null;
}
function emessaTable_(values, required) {
  var headers = values && values[0] || [];
  var map = {};
  headers.forEach(function (v, i) {
    var label = emessaNorm_(v);
    if (label && Object.prototype.hasOwnProperty.call(map, label)) throw new Error('EMESSA_SCHEMA duplicate header');
    if (label) map[label] = i;
  });
  required.forEach(function (label) { if (!Object.prototype.hasOwnProperty.call(map, label)) throw new Error('EMESSA_SCHEMA missing header'); });
  return { map: map, rows: (values || []).slice(1) };
}
function emessaField_(row, map, labels) {
  for (var i = 0; i < labels.length; i++) if (Object.prototype.hasOwnProperty.call(map, labels[i])) return row[map[labels[i]]];
  return '';
}
function emessaDate_(value) {
  if (typeof value === 'number') {
    var d = new Date(Math.round((value - 25569) * 86400000));
    return isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
  }
  var text = emessaText_(value, 40);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}
function emessaRanges_(id, ranges) {
  var result = Sheets.Spreadsheets.Values.batchGet(id, {
    ranges: ranges, valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER'
  });
  return (result.valueRanges || []).map(function (x) { return x.values || []; });
}
function emessaWorkspace_(config) {
  // Deliberately preserve Phase 1's reviewed capacities. Schema expansion is a later migration.
  var blocks = emessaRanges_(config.SALES_SPREADSHEET_ID, ["'Product Inventory'!A5:AB205", "'Invoice Tracker'!A5:AI1005"]);
  var productTable = emessaTable_(blocks[0], ['Product ID', 'Product Name', 'Current Stock (PCS)']);
  var invoiceTable = emessaTable_(blocks[1], ['Invoice No', 'Date', 'Invoice Total (BDT)', 'Payment Status', 'Delivery Status']);
  var p = productTable.map, it = invoiceTable.map;
  var products = productTable.rows.filter(function (row) { return emessaNorm_(row[p['Product ID']]); }).map(function (row) {
    var sku = emessaText_(row[p['Product ID']], 100);
    return { id: sku, sku: sku, name: emessaText_(row[p['Product Name']]), category: emessaText_(row[p.Category], 100),
      openingStock: emessaNumber_(row[p['Initial Stock (PCS)']]), stock: emessaNumber_(row[p['Current Stock (PCS)']]),
      price: emessaNumber_(emessaField_(row, p, ['Selling Price / unit (BDT)', 'Selling Price (BDT)'])),
      cost: emessaNumber_(emessaField_(row, p, ['Total Investment / unit (BDT)', 'Total Investment'])) };
  });
  var invoices = invoiceTable.rows.filter(function (row) { return emessaNorm_(row[it['Invoice No']]); }).map(function (row) {
    var number = emessaText_(row[it['Invoice No']], 100);
    return { id: number, number: number, date: emessaDate_(row[it.Date]),
      customer: emessaText_(row[it['Customer Name']]), phone: emessaText_(row[it['Customer Phone']], 30),
      total: emessaNumber_(row[it['Invoice Total (BDT)']]), paymentStatus: emessaText_(row[it['Payment Status']], 60),
      deliveryStatus: emessaText_(row[it['Delivery Status']], 60), tracking: emessaText_(row[it['Tracking Number']], 100),
      expectedCredit: emessaNumber_(emessaField_(row,it,['Expected Bank Credit','Expected Bank Credit (BDT)'])),
      actualCredit: emessaNumber_(row[it['Actual Bank Credit']]) };
  });
  invoices.sort(function (a,b) { return b.date.localeCompare(a.date) || b.number.localeCompare(a.number); });
  var warnings = [];
  if (products.some(function (x) { return x.stock == null || x.price == null; })) warnings.push('Some source stock or price cells are blank. Totals include available numbers.');
  if (invoices.some(function (x) { return x.total == null || !x.date || x.expectedCredit == null; })) warnings.push('Some invoice dates or amounts are incomplete. Review the source before relying on totals.');
  if (products.length !== Object.keys(products.reduce(function (m,x) { m[x.id.toUpperCase()]=1; return m; },{})).length) warnings.push('Repeated product IDs were found. Resolve source identity before enabling edits.');
  if (invoices.length !== Object.keys(invoices.reduce(function (m,x) { m[x.id.toUpperCase()]=1; return m; },{})).length) warnings.push('Repeated invoice numbers were found. Review the source identity before enabling edits.');
  return { mode:'google', asOf:new Date().toISOString(), timezone:config.BUSINESS_TIMEZONE || 'Asia/Dhaka', products:products, invoices:invoices, warnings:warnings, limits:{products:200,invoices:1000} };
}
function emessaTimezoneCheck_(metadata, label, expected) {
  var actual = emessaText_(metadata && metadata.properties && metadata.properties.timeZone, 100);
  return { label:label, status:!actual?'not_run':actual===expected?'passed':'failed',
    detail:!actual?'The source timezone could not be verified.':actual===expected?'Source timezone matches '+expected+'.':'Source timezone is '+actual+'; the application expects '+expected+'. Review date boundaries before relying on reports.' };
}
function emessaHealth_(config) {
  var checks = [{label:'Admin sign-in',status:'passed',detail:'The read API is executing under the configured owner.'}];
  var expectedZone = config.BUSINESS_TIMEZONE || 'Asia/Dhaka';
  var sales = Sheets.Spreadsheets.get(config.SALES_SPREADSHEET_ID,{fields:'properties(timeZone),sheets(properties(title))'});
  var salesNames = (sales.sheets || []).map(function (x) { return x.properties.title; });
  var salesOk = ['Product Inventory','Invoice Tracker','Sales Record','Invoice Line Items','Returns','Sales Archive'].every(function (x) { return salesNames.indexOf(x)>=0; });
  var headers = emessaRanges_(config.SALES_SPREADSHEET_ID,["'Product Inventory'!A5:AB5","'Invoice Tracker'!A5:AI5"]);
  emessaTable_(headers[0],['Product ID','Product Name','Current Stock (PCS)']);
  emessaTable_(headers[1],['Invoice No','Date','Invoice Total (BDT)','Payment Status','Delivery Status']);
  checks.push({label:'Sales and inventory Sheet',status:salesOk?'passed':'failed',detail:salesOk?'Expected tabs and core read headers are available.':'One or more expected source tabs are missing.'});
  var salesZone = emessaTimezoneCheck_(sales,'Sales Sheet timezone',expectedZone);
  checks.push(salesZone);
  var timezonesOk = salesZone.status === 'passed';
  var investmentOk = false;
  if (emessaId_(config.INVESTMENT_SPREADSHEET_ID)) {
    try {
      var investment = Sheets.Spreadsheets.get(config.INVESTMENT_SPREADSHEET_ID,{fields:'properties(timeZone),sheets(properties(title))'});
      var names = (investment.sheets || []).map(function(x){return x.properties.title;});
      investmentOk = ['Batch Master','Product Entry','Weight & Shipping','Marketing & Packing','Other Expenses'].every(function(x){return names.indexOf(x)>=0;});
      var invHeaders = emessaRanges_(config.INVESTMENT_SPREADSHEET_ID,["'Batch Master'!A4:J4","'Product Entry'!A4:L4"]);
      emessaTable_(invHeaders[0],['Batch ID','Initial Investment (BDT)','RMB Received']);
      emessaTable_(invHeaders[1],['Batch ID','Product ID / SKU','Quantity']);
      checks.push({label:'Investment Sheet',status:investmentOk?'passed':'failed',detail:investmentOk?'Expected investment tabs and core headers are readable.':'Investment source tabs need review.'});
      var investmentZone = emessaTimezoneCheck_(investment,'Investment Sheet timezone',expectedZone);
      checks.push(investmentZone);
      timezonesOk = timezonesOk && investmentZone.status === 'passed';
    } catch (error) {investmentOk=false;checks.push({label:'Investment Sheet',status:'failed',detail:'The investment Sheet could not be verified. Check its ID, permissions and headers.'});}
  } else checks.push({label:'Investment Sheet',status:'needs_setup',detail:'The private investment Sheet ID has not been configured.'});
  checks.push({label:'Business changes',status:'passed',detail:'This API is read-only. No invoices, stock, payments or source cells are changed.'});
  return {state:!salesOk||!investmentOk?'setup_required':timezonesOk?'connected':'attention',checkedAt:new Date().toISOString(),readOnly:true,checks:checks};
}
