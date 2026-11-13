// Generated from shared/inventory.ts by npm run build:inventory. Do not edit.
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
class InventoryError extends Error {
  constructor(code) {
    super(code);
    __publicField(this, "code", code);
  }
}
const fail = (code) => {
  throw new InventoryError(code);
};
function text(value, max, required = false) {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return fail("INVALID_INPUT");
  const result = value.trim();
  if (required && !result) return fail("INVALID_INPUT");
  return result;
}
function money(value) {
  if (typeof value !== "string" || !/^\d{1,12}(?:\.\d{1,6})?$/.test(value) || value.replace(".", "").replace(/^0+/, "").replace(/0+$/, "").length > 15) return fail("INVALID_MONEY");
  return value.replace(/^0+(?=\d)/, "");
}
function keys(data, allowed) {
  if (Object.keys(data).some((key) => !allowed.includes(key))) fail("PROTECTED_OR_UNKNOWN_FIELD");
}
function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function validateInventoryCommand(raw) {
  if (!plainObject(raw)) return fail("INVALID_INPUT");
  keys(raw, ["requestId", "action", "expectedRevision", "productId", "data"]);
  if (typeof raw.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.requestId)) return fail("INVALID_REQUEST_ID");
  if (!["product.create", "product.update", "stock.adjust", "product.archive"].includes(String(raw.action))) return fail("INVALID_ACTION");
  if (!plainObject(raw.data)) return fail("INVALID_INPUT");
  const productId = text(raw.productId, 100, true);
  if (!/^[A-Za-z0-9_-]+$/.test(productId)) return fail("INVALID_PRODUCT_ID");
  const action = raw.action;
  if (action === "product.create" ? raw.expectedRevision !== null : !Number.isSafeInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 1) return fail("INVALID_REVISION");
  const input = raw.data, data = {};
  if (action === "product.create" || action === "product.update") {
    keys(input, ["sku", "name", "category", "buyingPrice", "desiredProfit", "imageAssetIds", ...action === "product.create" ? ["openingStock"] : []]);
    const originalSku = text(input.sku, 100, true), sku = action === "product.create" ? originalSku.toUpperCase() : originalSku;
    if (!/^[A-Z0-9][A-Z0-9._-]*$/i.test(sku)) return fail("INVALID_SKU");
    Object.assign(data, { sku, name: text(input.name, 200, true), category: text(input.category, 100), buyingPrice: money(input.buyingPrice), desiredProfit: action === "product.update" && input.desiredProfit === "" ? "" : money(input.desiredProfit) });
    if (!Array.isArray(input.imageAssetIds) || input.imageAssetIds.length > 8) return fail("INVALID_ASSETS");
    const ids = input.imageAssetIds.map((id) => text(id, 100, true));
    if (ids.some((id) => !/^[A-Za-z0-9_-]+$/.test(id)) || new Set(ids).size !== ids.length) return fail("INVALID_ASSETS");
    data.imageAssetIds = ids;
    if (action === "product.create") {
      if (!Number.isSafeInteger(input.openingStock) || Number(input.openingStock) < 0 || Number(input.openingStock) > 1e6) return fail("INVALID_QUANTITY");
      data.openingStock = input.openingStock;
    }
  } else if (action === "stock.adjust") {
    keys(input, ["delta", "reason"]);
    if (!Number.isSafeInteger(input.delta) || Number(input.delta) === 0 || Math.abs(Number(input.delta)) > 1e6) return fail("INVALID_QUANTITY");
    data.delta = input.delta;
    data.reason = text(input.reason, 500, true);
  } else keys(input, []);
  return { requestId: raw.requestId, action, expectedRevision: raw.expectedRevision, productId, data };
}
function canonicalInventoryValue(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalInventoryValue).join(",") + "]";
  if (plainObject(value)) return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalInventoryValue(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
function cloneInventoryValue(value) {
  return JSON.parse(JSON.stringify(value));
}
function planInventoryChange(command, existing, actor, now) {
  text(actor, 200, true);
  if (!Number.isFinite(now.getTime())) return fail("INVALID_TIME");
  const create = command.action === "product.create";
  if (create && existing) return fail("DUPLICATE_PRODUCT");
  if (!create && !existing) return fail("PRODUCT_NOT_FOUND");
  if (existing && existing.revision !== command.expectedRevision) return fail("STALE_REVISION");
  if (existing?.archived) return fail("PRODUCT_ARCHIVED");
  let product;
  if (create) {
    const d = command.data;
    product = { id: command.productId, revision: 1, sku: d.sku, name: d.name, category: d.category, buyingPrice: d.buyingPrice, desiredProfit: d.desiredProfit, imageAssetIds: d.imageAssetIds, openingStock: d.openingStock, stock: d.openingStock, archived: false };
  } else product = { ...cloneInventoryValue(existing), revision: existing.revision + 1 };
  if (command.action === "product.update") {
    if (command.data.sku !== existing.sku) return fail("SKU_LOCKED");
    Object.assign(product, command.data);
  }
  let movement;
  if (command.action === "stock.adjust") {
    const before = product.stock, after = before + Number(command.data.delta);
    if (!Number.isSafeInteger(after) || after < 0) return fail("OUT_OF_STOCK");
    product.stock = after;
    movement = { id: command.requestId, productId: product.id, delta: Number(command.data.delta), before, after, reason: String(command.data.reason), actor, recordedAt: now.toISOString() };
  } else if (create && product.openingStock) {
    movement = { id: command.requestId, productId: product.id, delta: product.openingStock, before: 0, after: product.openingStock, reason: "Opening stock", actor, recordedAt: now.toISOString() };
  }
  if (command.action === "product.archive") product.archived = true;
  const result = { product: cloneInventoryValue(product), ...movement ? { movementId: movement.id } : {} };
  return { result, movement };
}
async function applyInventoryCommand(store, raw, actor, now = /* @__PURE__ */ new Date()) {
  const command = validateInventoryCommand(raw);
  text(actor, 200, true);
  if (!Number.isFinite(now.getTime())) return fail("INVALID_TIME");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalInventoryValue({ command, actor })));
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return store.transaction(async (tx) => {
    const previous = await tx.operation(command.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return fail("REQUEST_KEY_CONFLICT");
      return cloneInventoryValue(previous.result);
    }
    const existing = await tx.product(command.productId);
    const { result, movement } = planInventoryChange(command, existing, actor, now);
    const product = result.product;
    if (command.action === "product.create" || command.action === "product.update") {
      const owner = await tx.skuOwner(product.sku);
      if (owner && owner !== product.id) return fail("DUPLICATE_SKU");
      for (const asset of product.imageAssetIds) if (!await tx.approvedAsset(asset)) return fail("ASSET_NOT_APPROVED");
    }
    await tx.commit(product, movement, command.requestId, fingerprint, result);
    return cloneInventoryValue(result);
  });
}
const MAX_SOURCE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_STORED_IMAGE_BYTES = 300 * 1024;
function jpegDimensionsWithLimits(bytes, maxBytes, maxDimension) {
  const invalid = () => {
    throw new Error("INVALID_IMAGE");
  };
  if (bytes.length < 20 || bytes.length > maxBytes || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) return invalid();
  let at = 2, width = 0, height = 0;
  while (at < bytes.length - 2) {
    if (bytes[at++] !== 255) return invalid();
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === 217) break;
    const length = bytes[at] << 8 | bytes[at + 1];
    if (length < 2 || at + length > bytes.length - 2) return invalid();
    if ([192, 193, 194].includes(marker)) {
      if (length < 8 || bytes[at + 2] !== 8) return invalid();
      height = bytes[at + 3] << 8 | bytes[at + 4];
      width = bytes[at + 5] << 8 | bytes[at + 6];
    }
    if (marker === 218) break;
    at += length;
  }
  if (width < 1 || height < 1 || width > maxDimension || height > maxDimension) return invalid();
  return { width, height };
}
function jpegDimensions(bytes) {
  return jpegDimensionsWithLimits(bytes, MAX_STORED_IMAGE_BYTES, 1600);
}
function sourceImageDimensions(bytes, mime) {
  if (bytes.length > MAX_SOURCE_IMAGE_BYTES || bytes.length < 20) throw new Error("INVALID_IMAGE");
  let width = 0, height = 0;
  if (mime === "image/jpeg") ({ width, height } = jpegDimensionsWithLimits(bytes, MAX_SOURCE_IMAGE_BYTES, 16e3));
  else if (mime === "image/png") {
    if ([137, 80, 78, 71, 13, 10, 26, 10].some((n, i) => bytes[i] !== n) || bytes.length < 33 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") throw new Error("INVALID_IMAGE");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (mime === "image/webp") {
    const ascii = (a, b) => String.fromCharCode(...bytes.subarray(a, b));
    if (bytes.length < 30 || ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WEBP") throw new Error("INVALID_IMAGE");
    const chunk = ascii(12, 16);
    if (chunk === "VP8X") {
      if (bytes[20] & 2) throw new Error("INVALID_IMAGE");
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (chunk === "VP8 ") {
      if (bytes[23] !== 157 || bytes[24] !== 1 || bytes[25] !== 42) throw new Error("INVALID_IMAGE");
      width = (bytes[26] | bytes[27] << 8) & 16383;
      height = (bytes[28] | bytes[29] << 8) & 16383;
    } else if (chunk === "VP8L") {
      if (bytes[20] !== 47) throw new Error("INVALID_IMAGE");
      width = 1 + bytes[21] + ((bytes[22] & 63) << 8);
      height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10);
    }
  }
  if (width < 1 || height < 1 || width * height > 16e6) throw new Error("INVALID_IMAGE");
  return { width, height };
}
// Reviewed source formulas; row 6 references are translated only by the server.
var EMESSA_FORMULAS = {
  "0": "=IF(Y6=\"\",\"\",IFERROR(image(Y6,4,200,200),\"\"))",
  "5": "=IF($C6=\"\",\"\",$E6-IFERROR(SUMPRODUCT((TRIM(UPPER('Sales Record'!$C$6:$C$1005))=TRIM(UPPER($C6)))*'Sales Record'!$Y$6:$Y$1005),0)-IFERROR(SUMPRODUCT((TRIM(UPPER('Sales Archive'!$C$6:$C$1005))=TRIM(UPPER($C6)))*'Sales Archive'!$Y$6:$Y$1005),0))",
  "6": "=IF($C6=\"\",\"\",IF(F6<0,\"⚠ Oversold!\",IF(F6=0,\"Restock\",IF(F6<=10,\"Low Stock\",\"In Stock\"))))",
  "9": "=IF($C6=\"\",\"\",IFERROR(H6*'Batch Settings'!$B$9,0))",
  "10": "=IF($C6=\"\",\"\",'Batch Settings'!$B$19)",
  "11": "=IF($C6=\"\",\"\",IFERROR(IF(OR(INDEX('Shipping Cost'!$E$5:$E$304,MATCH(TRIM($C6),'Shipping Cost'!$A$5:$A$304,0))=\"\",NOT(ISNUMBER(INDEX('Shipping Cost'!$E$5:$E$304,MATCH(TRIM($C6),'Shipping Cost'!$A$5:$A$304,0))))),'Batch Settings'!$B$20,INDEX('Shipping Cost'!$E$5:$E$304,MATCH(TRIM($C6),'Shipping Cost'!$A$5:$A$304,0))),'Batch Settings'!$B$20))",
  "12": "=IF($C6=\"\",\"\",'Batch Settings'!$B$21)",
  "13": "=IF($C6=\"\",\"\",'Batch Settings'!$B$22)",
  "14": "=IF($C6=\"\",\"\",'Batch Settings'!$B$24)",
  "15": "=IF($C6=\"\",\"\",J6+K6+L6+M6+N6+O6)",
  "16": "=IF($C6=\"\",\"\",(P6+I6)*(1+'Batch Settings'!$B$31/100))",
  "17": "=IF($C6=\"\",\"\",IFERROR(Q6/'Batch Settings'!$B$9,0))",
  "18": "=IF($C6=\"\",\"\",Q6-P6-AB6)",
  "19": "=IF($C6=\"\",\"\",IFERROR(S6/Q6*100,0))",
  "20": "=IF($C6=\"\",\"\",P6)",
  "21": "=IF($C6=\"\",\"\",S6*F6)",
  "22": "=IF($C6=\"\",\"\",P6*F6)",
  "23": "=IF($C6=\"\",\"\",IFERROR(SUMPRODUCT((TRIM(UPPER('Sales Record'!$C$6:$C$1005))=TRIM(UPPER($C6)))*'Sales Record'!$I$6:$I$1005*IF('Sales Record'!$E$6:$E$1005=0,0,'Sales Record'!$Y$6:$Y$1005/'Sales Record'!$E$6:$E$1005)),0)+IFERROR(SUMPRODUCT((TRIM(UPPER('Sales Archive'!$C$6:$C$1005))=TRIM(UPPER($C6)))*'Sales Archive'!$I$6:$I$1005*IF('Sales Archive'!$E$6:$E$1005=0,0,'Sales Archive'!$Y$6:$Y$1005/'Sales Archive'!$E$6:$E$1005)),0))",
  "25": "=IF(OR($C6=\"\",D6=\"\"),0,IF(COUNTIF($D$6:D6,D6)=1,1,0))",
  "27": "=IF($C6=\"\",\"\",(P6+I6)*('Batch Settings'!$B$31/100))"
};
var EMESSA_HEADERS = {
  "0": "Product Image",
  "1": "Product Name",
  "2": "Product ID",
  "3": "Category",
  "4": "Initial Stock (PCS)",
  "5": "Current Stock (PCS)",
  "6": "Stock Status",
  "7": "Buying Price (RMB)",
  "8": "Desired Profit Amount (BDT)",
  "9": "Buying Price / unit (BDT)",
  "10": "Boosting Cost / unit (BDT)",
  "11": "Delivery Cost / unit (BDT)",
  "12": "Packing Cost / unit (BDT)",
  "13": "Other Cost / unit (BDT)",
  "14": "Travel Cost / unit (BDT)",
  "15": "Total Investment / unit (BDT)",
  "16": "Selling Price / unit (BDT)",
  "17": "Selling Price / unit (RMB)",
  "18": "Profit Amount / unit (BDT)",
  "19": "Profit Margin %",
  "20": "Break-even / unit (BDT)",
  "21": "Expected Future Profit (BDT)",
  "22": "Remaining Stock Value (BDT)",
  "23": "Actual Profit to date (BDT)",
  "24": "img_url",
  "25": "cat_flag",
  "27": "Pathao Fee / unit (BDT)"
};

// Exact live legacy families reviewed during staging preflight; accepted only for preview-approved migration.
var EMESSA_LEGACY_FORMULAS = {
  "5": "=IF($C6=\"\",\"\",E6-SUMPRODUCT((TRIM(UPPER('Sales Record'!$C$6:$C$1005))=TRIM(UPPER($C6)))*'Sales Record'!$E$6:$E$1005)-IFERROR(SUMPRODUCT((TRIM(UPPER('Sales Archive'!$C$6:$C$5005))=TRIM(UPPER($C6)))*'Sales Archive'!$E$6:$E$5005),0))",
  "23": "=IF($C6=\"\",\"\",SUMIF('Sales Record'!$C$6:$C$1005,$C6,'Sales Record'!$I$6:$I$1005)+IFERROR(SUMIF('Sales Archive'!$C$6:$C$5005,$C6,'Sales Archive'!$I$6:$I$5005),0))"
};

/** Owner-only inventory API. Install in a SEPARATE Apps Script project from the read API. */
var EMESSA_META = '_EMESSA_Products';
var EMESSA_OPS = '_EMESSA_Operations';
var EMESSA_MOVES = '_EMESSA_Movements';
var EMESSA_ASSETS = '_EMESSA_Assets';
var EMESSA_MAX_JOURNAL = 10000;
function inventoryFail_(code,location) {var error=new InventoryError(code);if(location)error.location=location;throw error;}
function inventoryAddress_(col,row){var n=Number(col)+1,label='';while(n>0){n--;label=String.fromCharCode(65+n%26)+label;n=Math.floor(n/26);}return 'Product Inventory!'+label+row;}
function inventoryOwner_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  var email = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!p.ADMIN_EMAIL || email !== p.ADMIN_EMAIL.toLowerCase()) inventoryFail_('FORBIDDEN');
  if (!/^[A-Za-z0-9_-]{20,150}$/.test(p.INVENTORY_SPREADSHEET_ID || '') || !['staging','live'].includes(p.INVENTORY_MODE)) inventoryFail_('SETUP_REQUIRED');
  if(p.INVENTORY_MODE==='live'&&p.INVENTORY_LIVE_ACKNOWLEDGEMENT!=='staging-tested-and-other-writers-paused')inventoryFail_('LIVE_ACTIVATION_REQUIRED');
  if (p.INVENTORY_MODE === 'staging') {
    var originals = [p.SALES_SPREADSHEET_ID,p.INVESTMENT_SPREADSHEET_ID];
    if (!originals.every(function(id){return /^[A-Za-z0-9_-]{20,150}$/.test(id||'');}) ||
        p.INVENTORY_SPREADSHEET_ID !== p.INVENTORY_ALLOWED_STAGING_ID ||
        originals.includes(p.INVENTORY_SPREADSHEET_ID)) inventoryFail_('STAGING_TARGET_REQUIRED');
  }
  return p;
}
function inventoryLocked_(work) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) inventoryFail_('BUSY');
  try { return work(); } finally { lock.releaseLock(); }
}
function inventoryDigest_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonicalInventoryValue(value), Utilities.Charset.UTF_8).map(function(n){return ('0'+((n+256)%256).toString(16)).slice(-2);}).join('');
}
function inventoryFormula_(column,row,migrated) {
  var base = EMESSA_FORMULAS[column].replace(/(\$?[A-Z]{1,3})6\b/g,function(_,col){return col+row;});
  if (Number(column) === 5 && migrated) return '=IF($C'+row+'="","",('+base.slice(1)+')+SUMIF(\''+EMESSA_MOVES+'\'!$B$2:$B$10001,$C'+row+',\''+EMESSA_MOVES+'\'!$C$2:$C$10001))';
  return base;
}
function inventoryInputHash_(values,formulas) {
  var inputs=[1,2,3,4,7,8,24,26].map(function(col){return [values[col]===undefined?'':values[col],formulas[col]===undefined?'':formulas[col]];});
  inputs.push(['image',formulas[0]===undefined?'':formulas[0]]);return inventoryDigest_(inputs);
}
function inventoryReadState_(p,migrated) {
  var id=p.INVENTORY_SPREADSHEET_ID;
  var book=Sheets.Spreadsheets.get(id,{fields:'sheets.properties'});
  var sheets={};(book.sheets||[]).forEach(function(s){sheets[s.properties.title]=s.properties;});
  if (!sheets['Product Inventory']) inventoryFail_('SCHEMA_MISMATCH');
  var initialized=[EMESSA_META,EMESSA_OPS,EMESSA_MOVES,EMESSA_ASSETS].some(function(name){return !!sheets[name];});
  if(!migrated&&initialized)inventoryFail_('ALREADY_INITIALIZED');
  if(migrated&&[EMESSA_META,EMESSA_OPS,EMESSA_MOVES,EMESSA_ASSETS].some(function(name){return !sheets[name];}))inventoryFail_('NOT_INITIALIZED');
  var range="'Product Inventory'!A5:AB205";
  var values=Sheets.Spreadsheets.Values.get(id,range,{valueRenderOption:'UNFORMATTED_VALUE'}).values||[];
  var formulas=Sheets.Spreadsheets.Values.get(id,range,{valueRenderOption:'FORMULA'}).values||[];
  var header=values[0]||[];
  Object.keys(EMESSA_HEADERS).forEach(function(col){if(String(header[col]||'').replace(/\s+/g,' ').trim()!==EMESSA_HEADERS[col]) inventoryFail_('SCHEMA_MISMATCH',inventoryAddress_(col,5));});
  var rows=[],seen={},migrations=[],blankImages=0,formulaCount=0;
  for(var i=1;i<=200;i++) {
    var row=i+5,v=values[i]||[],f=formulas[i]||[];
    Object.keys(EMESSA_FORMULAS).forEach(function(col){
      var actual=String(f[col]||'').trim();
      if(col==='0'&&actual===''){blankImages++;return;}
      if(actual)formulaCount++;
      if(actual===inventoryFormula_(col,row,migrated))return;
      var legacy=EMESSA_LEGACY_FORMULAS[col];
      if(!migrated&&legacy&&actual===legacy.replace(/(\$?[A-Z]{1,3})6\b/g,function(_,label){return label+row;})){migrations.push({row:row,column:Number(col)});return;}
      inventoryFail_('FORMULA_MISMATCH',inventoryAddress_(col,row));
    });
    var sku=String(v[2]||'').trim();
    if(sku && (seen[sku.toUpperCase()] || !/^[A-Z0-9][A-Z0-9._-]{0,99}$/i.test(sku))) inventoryFail_('SOURCE_REVIEW_REQUIRED');
    if(sku) seen[sku.toUpperCase()]=true;
    // Protect every source-owned input, image URL and reserved AA cell from silent overwrites.
    rows.push({row:row,values:v,formulas:f,hash:inventoryInputHash_(v,f),formulaHash:inventoryDigest_(Object.keys(EMESSA_FORMULAS).map(function(col){return f[col]||'';})),sku:sku});
  }
  return {sheets:sheets,rows:rows,migrations:migrations,blankImages:blankImages,formulaCount:formulaCount};
}
function inventoryTable_(p,title) {
  var rows=Sheets.Spreadsheets.Values.get(p.INVENTORY_SPREADSHEET_ID,"'"+title+"'!A1:D10001",{valueRenderOption:'UNFORMATTED_VALUE'}).values||[];
  var entries={},order=[];
  if(String(rows[0]&&rows[0][0])!=='ID' || String(rows[0]&&rows[0][1])!==(title===EMESSA_MOVES?'SKU':'DATA')) inventoryFail_('SCHEMA_MISMATCH');
  for(var i=1;i<rows.length;i++) {
    if(!rows[i][0]) inventoryFail_('SCHEMA_MISMATCH');
    var key=String(rows[i][0]);if(entries[key]) inventoryFail_('SCHEMA_MISMATCH');
    var data;try{data=JSON.parse(rows[i][title===EMESSA_MOVES?3:1]);}catch(e){inventoryFail_('SCHEMA_MISMATCH');}
    entries[key]={row:i+1,data:data};order.push(key);
  }
  return {entries:entries,order:order,nextRow:rows.length+1};
}
function inventoryCell_(value) {
  return {userEnteredValue:typeof value==='number'?{numberValue:value}:typeof value==='boolean'?{boolValue:value}:{stringValue:String(value)}};
}
function inventoryCells_(sheet,row,col,values) {
  return {updateCells:{range:{sheetId:sheet,startRowIndex:row-1,endRowIndex:row,startColumnIndex:col,endColumnIndex:col+values.length},rows:[{values:values.map(inventoryCell_)}],fields:'userEnteredValue'}};
}
function inventoryJsonRow_(sheet,row,id,data) { return inventoryCells_(sheet,row,0,[id,JSON.stringify(data)]); }
function inventoryRecord_(entry,source) {
  if(!source || source.hash!==entry.hash || source.sku!==entry.product.sku) inventoryFail_('SOURCE_CHANGED');
  var product=cloneInventoryValue(entry.product);
  if(!Number.isSafeInteger(source.values[5])) inventoryFail_('STOCK_UNAVAILABLE');
  product.stock=source.values[5];
  return product;
}
function inventoryWorkspace_(p) {return inventoryDigest_({target:p.INVENTORY_SPREADSHEET_ID,mode:p.INVENTORY_MODE});}
function inventorySnapshot_(p) {
  var state=inventoryReadState_(p,true),meta=inventoryTable_(p,EMESSA_META),moves=inventoryTable_(p,EMESSA_MOVES);
  var mapped={},products=[];
  meta.order.forEach(function(id){
    var entry=meta.entries[id].data,source=state.rows[entry.row-6];
    if(mapped[entry.row]) inventoryFail_('SCHEMA_MISMATCH');mapped[entry.row]=true;
    var product=inventoryRecord_(entry,source);
    products.push(Object.assign(product,{price:typeof source.values[16]==='number'?source.values[16]:null,cost:typeof source.values[15]==='number'?source.values[15]:null,legacyImage:!!source.values[24]}));
  });
  state.rows.forEach(function(row){if(row.sku&&!mapped[row.row])inventoryFail_('SOURCE_CHANGED');});
  return {workspaceId:inventoryWorkspace_(p),mode:p.INVENTORY_MODE,enabled:p.INVENTORY_WRITE_ENABLED==='true',asOf:new Date().toISOString(),products:products,movements:moves.order.slice(-200).map(function(id){return moves.entries[id].data;}),capacity:200,remaining:200-products.length};
}
function inventoryLegacyProduct_(source,id) {
  var v=source.values,command;
  try{command=validateInventoryCommand({requestId:Utilities.getUuid(),action:'product.update',expectedRevision:1,productId:id,data:{sku:source.sku,name:String(v[1]||''),category:String(v[3]||''),buyingPrice:String(v[7]===undefined?'':v[7]),desiredProfit:String(v[8]===undefined?'':v[8]),imageAssetIds:[]}});}
  catch(error){inventoryFail_('SOURCE_REVIEW_REQUIRED',inventoryAddress_(1,source.row));}
  if(!Number.isSafeInteger(v[4])||v[4]<0||v[4]>1000000||!Number.isSafeInteger(v[5])||v[5]<0)inventoryFail_('SOURCE_REVIEW_REQUIRED',inventoryAddress_(4,source.row));
  return Object.assign({id:id,revision:1,openingStock:v[4],stock:v[5],archived:false},command.data);
}
/** Run in the editor. Returns a digest of the proposed migration; makes no changes. */
function emessaInventoryPlan() {
  return inventoryLocked_(function(){
    var p=inventoryOwner_(),state=inventoryReadState_(p,false);
    state.rows.filter(function(r){return !!r.sku;}).forEach(function(r){inventoryLegacyProduct_(r,'p_review');});
    [EMESSA_META,EMESSA_OPS,EMESSA_MOVES,EMESSA_ASSETS].forEach(function(name){if(state.sheets[name]) inventoryFail_('ALREADY_INITIALIZED');});
    var digest=inventoryDigest_({version:1,target:p.INVENTORY_SPREADSHEET_ID,rows:state.rows.map(function(r){return {row:r.row,hash:r.hash,formulaHash:r.formulaHash};})});
    return {version:1,mode:p.INVENTORY_MODE,products:state.rows.filter(function(r){return !!r.sku;}).length,capacity:200,formulaCellsReviewed:4000,formulaCellsPresent:state.formulaCount,blankImageCellsPreserved:state.blankImages,legacyStockFormulas:state.migrations.filter(function(m){return m.column===5;}).length,legacyProfitFormulas:state.migrations.filter(function(m){return m.column===23;}).length,blankProfitInputsPreserved:state.rows.filter(function(r){return r.sku&&(r.values[8]===undefined||r.values[8]==='');}).length,legacySkuCasePreserved:state.rows.filter(function(r){return r.sku&&r.sku!==r.sku.toUpperCase();}).length,requiresReconciliation:state.migrations.length>0,formulaChange:'Normalize only recognized legacy stock/profit formulas to reviewed active-quantity templates and add audited stock adjustments. Preserve source inputs and image cells.',planDigest:digest};
  });
}
/** Run only after setting INVENTORY_APPROVED_PLAN to the digest from emessaInventoryPlan. */
function emessaInventoryInitialize() {
  return inventoryLocked_(function(){
    var p=inventoryOwner_(),plan=emessaInventoryPlanUnlocked_(p);
    if(p.INVENTORY_WRITE_ENABLED==='true' || !p.INVENTORY_APPROVED_PLAN || p.INVENTORY_APPROVED_PLAN!==plan.digest) inventoryFail_('PLAN_APPROVAL_REQUIRED');
    var state=plan.state,requests=[],maxId=0;Object.keys(state.sheets).forEach(function(k){maxId=Math.max(maxId,state.sheets[k].sheetId);});
    var ids={};
    [EMESSA_META,EMESSA_OPS,EMESSA_MOVES,EMESSA_ASSETS].forEach(function(name){
      if(state.sheets[name]) inventoryFail_('ALREADY_INITIALIZED');
      var sid=++maxId;ids[name]=sid;
      requests.push({addSheet:{properties:{title:name,sheetId:sid,hidden:true,gridProperties:{rowCount:10001,columnCount:4}}}});
      requests.push(inventoryCells_(sid,1,0,name===EMESSA_MOVES?['ID','SKU','Adjustment delta','Evidence']:['ID','DATA']));
    });
    var metaRow=2;
    state.rows.forEach(function(source){
      if(source.sku){
        var v=source.values,id='p_'+Utilities.getUuid().replace(/-/g,'');
        var product=inventoryLegacyProduct_(source,id);
        requests.push(inventoryJsonRow_(ids[EMESSA_META],metaRow++,id,{row:source.row,hash:source.hash,product:product,migrationBaseline:{stock:v[5],actualProfit:typeof v[23]==='number'?v[23]:null,reviewedAt:new Date().toISOString()}}));
      }
      requests.push({updateCells:{range:{sheetId:state.sheets['Product Inventory'].sheetId,startRowIndex:source.row-1,endRowIndex:source.row,startColumnIndex:5,endColumnIndex:6},rows:[{values:[{userEnteredValue:{formulaValue:inventoryFormula_(5,source.row,true)}}]}],fields:'userEnteredValue'}});
    });
    state.migrations.filter(function(m){return m.column!==5;}).forEach(function(m){requests.push({updateCells:{range:{sheetId:state.sheets['Product Inventory'].sheetId,startRowIndex:m.row-1,endRowIndex:m.row,startColumnIndex:m.column,endColumnIndex:m.column+1},rows:[{values:[{userEnteredValue:{formulaValue:inventoryFormula_(m.column,m.row,false)}}]}],fields:'userEnteredValue'}});});
    Sheets.Spreadsheets.batchUpdate({requests:requests},p.INVENTORY_SPREADSHEET_ID);
    return {initialized:true,mode:p.INVENTORY_MODE,products:metaRow-2};
  });
}
function emessaInventoryPlanUnlocked_(p) {
  var state=inventoryReadState_(p,false);
  return {state:state,digest:inventoryDigest_({version:1,target:p.INVENTORY_SPREADSHEET_ID,rows:state.rows.map(function(r){return {row:r.row,hash:r.hash,formulaHash:r.formulaHash};})})};
}
function inventoryCommit_(p,raw) {
  if(p.INVENTORY_WRITE_ENABLED!=='true') inventoryFail_('WRITE_DISABLED');
  var command=validateInventoryCommand(raw),actor=p.ADMIN_EMAIL.toLowerCase();
  var fingerprint=inventoryDigest_({command:command,actor:actor});
  var ops=inventoryTable_(p,EMESSA_OPS),old=ops.entries[command.requestId];
  if(old){if(old.data.fingerprint!==fingerprint)inventoryFail_('REQUEST_KEY_CONFLICT');return old.data.result;}
  if(ops.nextRow>10001) inventoryFail_('JOURNAL_FULL');
  var state=inventoryReadState_(p,true),meta=inventoryTable_(p,EMESSA_META),moves=inventoryTable_(p,EMESSA_MOVES),assets=inventoryTable_(p,EMESSA_ASSETS);
  var found=meta.entries[command.productId],existing=found?inventoryRecord_(found.data,state.rows[found.data.row-6]):undefined;
  // Catch unregistered source additions and edits before any save, including SKU collisions.
  var occupied={};meta.order.forEach(function(id){var e=meta.entries[id].data;if(occupied[e.row])inventoryFail_('SCHEMA_MISMATCH');occupied[e.row]=id;inventoryRecord_(e,state.rows[e.row-6]);});
  state.rows.forEach(function(r){if(r.sku&&!occupied[r.row])inventoryFail_('SOURCE_CHANGED');});
  var planned=planInventoryChange(command,existing,actor,new Date()),product=planned.result.product;
  if(existing&&product.sku!==existing.sku) inventoryFail_('SKU_LOCKED');
  if(meta.order.some(function(id){return id!==product.id&&meta.entries[id].data.product.sku.toUpperCase()===product.sku.toUpperCase();})) inventoryFail_('DUPLICATE_SKU');
  product.imageAssetIds.forEach(function(id){var asset=assets.entries[id];if(!asset||!['ready','attached'].includes(asset.data.status))inventoryFail_('ASSET_NOT_APPROVED');});
  var row=found?found.data.row:0;
  if(!row){for(var i=0;i<state.rows.length;i++)if(!state.rows[i].sku&&!occupied[state.rows[i].row]){var rawValues=state.rows[i].values;if([1,2,3,4,7,8,24,26].some(function(c){return rawValues[c]!==''&&rawValues[c]!==undefined;}))continue;row=state.rows[i].row;break;}}
  if(!row) inventoryFail_('CAPACITY_REACHED');
  var requests=[],sid=state.sheets['Product Inventory'].sheetId,source=state.rows[row-6];
  var future=source.values.slice(),futureInputs=source.formulas.slice();
  if(command.action==='product.create'||command.action==='product.update') {
    [[1,product.name],[2,product.sku],[3,product.category],[7,Number(product.buyingPrice)],[8,product.desiredProfit===''?'':Number(product.desiredProfit)]].forEach(function(pair){requests.push(inventoryCells_(sid,row,pair[0],[pair[1]]));future[pair[0]]=pair[1];futureInputs[pair[0]]=pair[1];});
    if(command.action==='product.create'){requests.push(inventoryCells_(sid,row,4,[product.openingStock]));future[4]=product.openingStock;futureInputs[4]=product.openingStock;}
  }
  // Original image URL/formula remain intact. Website assets are private references in metadata.
  var hash=inventoryInputHash_(future,futureInputs);
  requests.push(inventoryJsonRow_(state.sheets[EMESSA_META].sheetId,found?found.row:meta.nextRow,product.id,{row:row,hash:hash,product:product}));
  if(planned.movement){
    if(moves.nextRow>10001) inventoryFail_('JOURNAL_FULL');
    // SKU/delta are formula inputs; full movement evidence is retained as JSON in column D.
    requests.push(inventoryCells_(state.sheets[EMESSA_MOVES].sheetId,moves.nextRow,0,[planned.movement.id,product.sku,command.action==='stock.adjust'?planned.movement.delta:0,JSON.stringify(planned.movement)]));
  }
  var ids=product.imageAssetIds.concat(existing?existing.imageAssetIds:[]);
  Array.from(new Set(ids)).forEach(function(id){var e=assets.entries[id];if(!e)return;var data=cloneInventoryValue(e.data);data.status=product.imageAssetIds.includes(id)?'attached':'ready';requests.push(inventoryJsonRow_(state.sheets[EMESSA_ASSETS].sheetId,e.row,id,data));});
  requests.push(inventoryJsonRow_(state.sheets[EMESSA_OPS].sheetId,ops.nextRow,command.requestId,{fingerprint:fingerprint,result:planned.result,actor:actor,recordedAt:new Date().toISOString()}));
  // A single atomic Sheets batch is the only commit point. A lost response is resolved by the same request ID.
  Sheets.Spreadsheets.batchUpdate({requests:requests},p.INVENTORY_SPREADSHEET_ID);
  return planned.result;
}
function emessaInventory(request) {
  try {
    var p=inventoryOwner_();
    if(!request||request.version!==1||!['inventory.read','inventory.command','inventory.status','asset.upload','asset.read','asset.discard'].includes(request.operation)) inventoryFail_('FORBIDDEN');
    return inventoryLocked_(function(){
      if(['inventory.command','asset.upload','asset.discard'].includes(request.operation)&&request.workspaceId!==inventoryWorkspace_(p))inventoryFail_('WORKSPACE_CHANGED');
      var data;
      if(request.operation==='inventory.read') data=inventorySnapshot_(p);
      else if(request.operation==='inventory.command') {if(request.workspaceId!==inventoryWorkspace_(p))inventoryFail_('WORKSPACE_CHANGED');data=inventoryCommit_(p,request.command);}
      else if(request.operation==='inventory.status') {
        if(!/^[0-9a-f-]{36}$/i.test(request.requestId||'')) inventoryFail_('INVALID_REQUEST_ID');
        var op=inventoryTable_(p,EMESSA_OPS).entries[request.requestId];data=op?{state:'committed',result:op.data.result}:{state:'not_found'};
      } else data=inventoryAssetOperation_(p,request);
      return {ok:true,data:data};
    });
  } catch(error) {
    var code=error instanceof InventoryError?error.code:'GOOGLE_EXECUTION_FAILED';
    return {ok:false,error:Object.assign({code:code},error instanceof InventoryError&&error.location?{location:error.location}:{})};
  }
}

/** Editor helpers print sanitized reports, since returned objects are not shown in its log. */
function emessaInventoryPrintPlan() {
  try{var report=emessaInventoryPlan();console.log(JSON.stringify(report,null,2));return report;}
  catch(e){throw new Error((e instanceof InventoryError?e.code:'GOOGLE_EXECUTION_FAILED')+(e.location?' ('+e.location+')':''));}
}
function emessaInventoryPrintStatus() {
  var result=emessaInventory({version:1,operation:'inventory.read'});
  var report=result.ok?{ok:true,mode:result.data.mode,enabled:result.data.enabled,products:result.data.products.length,remaining:result.data.remaining}:{ok:false,error:result.error};
  console.log(JSON.stringify(report,null,2));return report;
}
function emessaInventoryPrintCleanupPlan() {var report=emessaInventoryCleanupPlan();console.log(JSON.stringify(report,null,2));return report;}

/** All files remain owner-private. Upload intent is journaled before Drive side effects. */
function inventoryImageFolder_(p){var file=Drive.Files.get(p.INVENTORY_IMAGE_FOLDER_ID,{fields:EMESSA_FILE_FIELDS});inventoryPrivateFile_(file,p);if(file.appProperties&&file.appProperties.emessaFolder==='inventory-'+inventoryWorkspace_(p).slice(0,24))return file;inventoryFail_('IMAGE_SETUP_REQUIRED');}
function inventoryPrivateFile_(file,p,folder,allowTrashed) {
  if(!file||(!allowTrashed&&file.trashed)||!file.owners||file.owners.length!==1||String(file.owners[0].emailAddress).toLowerCase()!==p.ADMIN_EMAIL.toLowerCase()) inventoryFail_('ASSET_NOT_PRIVATE');
  if(!file.permissions||file.permissions.some(function(v){return v.type!=='user'||v.role!=='owner';})) inventoryFail_('ASSET_NOT_PRIVATE');
  if(folder&&(!file.parents||!file.parents.includes(folder))) inventoryFail_('ASSET_NOT_PRIVATE');
}
var EMESSA_FILE_FIELDS='id,mimeType,size,parents,owners(emailAddress),permissions(type,role),trashed,appProperties';
/** Run in the editor once, after initialization. App creates its own private folder. */
function emessaInventoryCreateImageFolder() {
  return inventoryLocked_(function(){
    var p=inventoryOwner_();
    if(p.INVENTORY_IMAGE_FOLDER_ID){var current=Drive.Files.get(p.INVENTORY_IMAGE_FOLDER_ID,{fields:EMESSA_FILE_FIELDS});inventoryPrivateFile_(current,p);if(current.appProperties&&current.appProperties.emessaFolder==='inventory-'+inventoryWorkspace_(p).slice(0,24))return {ready:true};}
    var existing=Drive.Files.list({q:"trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='emessaFolder' and value='inventory-"+inventoryWorkspace_(p).slice(0,24)+"' }",fields:'files('+EMESSA_FILE_FIELDS+')',pageSize:2}).files||[];
    if(existing.length>1)inventoryFail_('ASSET_REVIEW_REQUIRED');
    var folder=existing[0]||Drive.Files.create({name:'EMESSA Inventory Images ('+p.INVENTORY_MODE+')',mimeType:'application/vnd.google-apps.folder',appProperties:{emessaFolder:'inventory-'+inventoryWorkspace_(p).slice(0,24)}},null,{fields:EMESSA_FILE_FIELDS});
    inventoryPrivateFile_(folder,p);
    PropertiesService.getScriptProperties().setProperty('INVENTORY_IMAGE_FOLDER_ID',folder.id);
    return {ready:true};
  });
}
function inventoryAssetOperation_(p,request) {
  var state=Sheets.Spreadsheets.get(p.INVENTORY_SPREADSHEET_ID,{fields:'sheets.properties'}),sheets={};
  (state.sheets||[]).forEach(function(s){sheets[s.properties.title]=s.properties;});
  if(!sheets[EMESSA_ASSETS]||!p.INVENTORY_IMAGE_FOLDER_ID)inventoryFail_('IMAGE_SETUP_REQUIRED');
  var assets=inventoryTable_(p,EMESSA_ASSETS),entry,id;
  if(request.operation==='asset.upload') {
    if(p.INVENTORY_WRITE_ENABLED!=='true')inventoryFail_('WRITE_DISABLED');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.requestId||''))inventoryFail_('INVALID_REQUEST_ID');
    if(typeof request.base64!=='string'||request.base64.length>409600||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.base64))inventoryFail_('INVALID_IMAGE');
    inventoryImageFolder_(p);
    var bytes;try{bytes=Utilities.base64Decode(request.base64);jpegDimensions(new Uint8Array(bytes.map(function(n){return (n+256)%256;})));}catch(e){inventoryFail_('INVALID_IMAGE');}
    id='a_'+request.requestId.replace(/-/g,'');entry=assets.entries[id];
    var fingerprint=inventoryDigest_(request.base64);
    if(entry&&entry.data.fingerprint!==fingerprint)inventoryFail_('REQUEST_KEY_CONFLICT');
    if(entry&&entry.data.status==='discarded')inventoryFail_('ASSET_NOT_APPROVED');
    if(!entry){
      if(assets.nextRow>10001)inventoryFail_('JOURNAL_FULL');
      entry={row:assets.nextRow,data:{status:'pending',fingerprint:fingerprint,createdAt:new Date().toISOString(),bytes:bytes.length,mime:'image/jpeg'}};
      Sheets.Spreadsheets.batchUpdate({requests:[inventoryJsonRow_(sheets[EMESSA_ASSETS].sheetId,entry.row,id,entry.data)]},p.INVENTORY_SPREADSHEET_ID);
    }
    if(!entry.data.fileId){
      // A retry discovers an upload whose final registry write/response was lost.
      var files=Drive.Files.list({q:"trashed = false and '"+p.INVENTORY_IMAGE_FOLDER_ID+"' in parents and appProperties has { key='emessaAsset' and value='"+id+"' }",fields:'files('+EMESSA_FILE_FIELDS+')',pageSize:2}).files||[];
      if(files.length>1)inventoryFail_('ASSET_REVIEW_REQUIRED');
      var file=files[0]||Drive.Files.create({name:id+'.jpg',mimeType:'image/jpeg',parents:[p.INVENTORY_IMAGE_FOLDER_ID],appProperties:{emessaAsset:id,fingerprint:fingerprint}},Utilities.newBlob(bytes,'image/jpeg',id+'.jpg'),{fields:EMESSA_FILE_FIELDS});
      inventoryPrivateFile_(file,p,p.INVENTORY_IMAGE_FOLDER_ID);
      if(file.mimeType!=='image/jpeg'||Number(file.size)!==bytes.length||file.appProperties.fingerprint!==fingerprint)inventoryFail_('ASSET_REVIEW_REQUIRED');
      entry.data.fileId=file.id;entry.data.status='ready';
      Sheets.Spreadsheets.batchUpdate({requests:[inventoryJsonRow_(sheets[EMESSA_ASSETS].sheetId,entry.row,id,entry.data)]},p.INVENTORY_SPREADSHEET_ID);
    }
    return {assetId:id,status:entry.data.status};
  }
  id=String(request.assetId||'');if(!/^a_[0-9a-f]{32}$/i.test(id))inventoryFail_('INVALID_ASSETS');
  entry=assets.entries[id];if(!entry)inventoryFail_('ASSET_NOT_FOUND');
  if(entry.data.status==='discarded'){if(request.operation==='asset.discard')return {discarded:true};inventoryFail_('ASSET_NOT_FOUND');}
  var meta=inventoryTable_(p,EMESSA_META);
  var linked=meta.order.some(function(key){return meta.entries[key].data.product.imageAssetIds.includes(id);});
  if(request.operation==='asset.discard') {
    if(p.INVENTORY_WRITE_ENABLED!=='true')inventoryFail_('WRITE_DISABLED');
    if(linked||Date.now()-Date.parse(entry.data.createdAt)<86400000)inventoryFail_('ASSET_IN_USE');
    if(!entry.data.fileId){
      var pendingFiles=Drive.Files.list({q:"trashed = false and '"+p.INVENTORY_IMAGE_FOLDER_ID+"' in parents and appProperties has { key='emessaAsset' and value='"+id+"' }",fields:'files('+EMESSA_FILE_FIELDS+')',pageSize:2}).files||[];
      if(pendingFiles.length>1)inventoryFail_('ASSET_REVIEW_REQUIRED');if(pendingFiles[0])entry.data.fileId=pendingFiles[0].id;
    }
    if(entry.data.fileId){inventoryPrivateFile_(Drive.Files.get(entry.data.fileId,{fields:EMESSA_FILE_FIELDS}),p,p.INVENTORY_IMAGE_FOLDER_ID,true);
    Drive.Files.update({trashed:true},entry.data.fileId);}
    entry.data.status='discarded';entry.data.discardedAt=new Date().toISOString();entry.data.discardedBy=p.ADMIN_EMAIL;Sheets.Spreadsheets.batchUpdate({requests:[inventoryJsonRow_(sheets[EMESSA_ASSETS].sheetId,entry.row,id,entry.data)]},p.INVENTORY_SPREADSHEET_ID);
    return {discarded:true};
  }
  if(!entry.data.fileId)inventoryFail_('ASSET_NOT_FOUND');
  var file=Drive.Files.get(entry.data.fileId,{fields:EMESSA_FILE_FIELDS});inventoryPrivateFile_(file,p,p.INVENTORY_IMAGE_FOLDER_ID);
  if(file.mimeType!=='image/jpeg'||Number(file.size)!==entry.data.bytes)inventoryFail_('ASSET_REVIEW_REQUIRED');
  return {fileId:entry.data.fileId,mime:'image/jpeg',bytes:entry.data.bytes};
}

function inventoryCleanupCandidates_(p) {
  var meta=inventoryTable_(p,EMESSA_META),assets=inventoryTable_(p,EMESSA_ASSETS),referenced={};
  meta.order.forEach(function(id){meta.entries[id].data.product.imageAssetIds.forEach(function(asset){referenced[asset]=true;});});
  var ids=assets.order.filter(function(id){var a=assets.entries[id].data;return !referenced[id]&&a.status!=='discarded'&&Date.now()-Date.parse(a.createdAt)>=86400000;}).sort();
  return {assetIds:ids,planDigest:inventoryDigest_({workspaceId:inventoryWorkspace_(p),assetIds:ids})};
}
/** Owner maintenance: inspect first; linked and <24-hour uploads are excluded. */
function emessaInventoryCleanupPlan() {return inventoryLocked_(function(){return inventoryCleanupCandidates_(inventoryOwner_());});}
function emessaInventoryCleanup() {
  return inventoryLocked_(function(){
    var p=inventoryOwner_(),plan=inventoryCleanupCandidates_(p);
    if(p.INVENTORY_WRITE_ENABLED!=='true'||p.INVENTORY_APPROVED_CLEANUP!==plan.planDigest)inventoryFail_('PLAN_APPROVAL_REQUIRED');
    var results=[];
    plan.assetIds.forEach(function(id){try{inventoryAssetOperation_(p,{operation:'asset.discard',assetId:id});results.push({assetId:id,discarded:true});}catch(e){results.push({assetId:id,discarded:false,code:e instanceof InventoryError?e.code:'GOOGLE_EXECUTION_FAILED'});}});
    return {results:results};
  });
}
