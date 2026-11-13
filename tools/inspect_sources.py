#!/usr/bin/env python3
"""Read-only structural audit of EMESSA XLSX/Apps Script snapshots.

No workbook is changed or recalculated. Outputs omit customer/product row values.
Formula samples are limited to trusted tab schemas and redact URL/email literals.
"""
from __future__ import annotations
import argparse
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
SCHEMAS = {
 'Product Inventory': (5, 'Product ID'), 'Sales Record': (5, 'Invoice No'),
 'Invoice Tracker': (5, 'Invoice No'), 'Invoice Line Items': (4, 'Invoice No'),
 'Sales Archive': (5, 'Invoice No'), 'Returns': (4, 'Invoice No'),
 'Shipping Cost': (4, 'Product ID'), 'Audit Log': (1, None),
 'Invoice Email Log': (3, 'Invoice No'), 'Payment Matching': (14, None),
 'Batch Investment': (18, None),
 'Batch Master': (4, 'Batch ID'), 'Product Entry': (4, 'Product ID / SKU'),
 'Carton & CBM': (4, 'Product ID / SKU'),
 'Weight & Shipping': (4, 'Product ID / SKU'),
 'Marketing & Packing': (4, None), 'Other Expenses': (4, None),
 'Top Selling Products Data': (4, None), 'Stock Alert Data': (4, None),
 'Recent Sales Data': (4, None),
}
CORE_REQUIRED = {
 'Product Inventory': ['Product ID', 'Product Name', 'Initial Stock (PCS)', 'Current Stock (PCS)'],
 'Sales Record': ['Invoice No', 'Product ID', 'Quantity Sold', 'Active Qty', 'Line ID'],
 'Invoice Tracker': ['Invoice No', 'Invoice Total (BDT)', 'Payment Status', 'Delivery Status'],
 'Invoice Line Items': ['Invoice No', 'Product ID', 'Quantity'],
 'Sales Archive': ['Invoice No', 'Product ID', 'Active Qty', 'Line ID'],
 'Returns': ['Invoice No', 'Product ID', 'Qty Returned', 'Event ID', 'Idempotency Key'],
 'Batch Master': ['Batch ID', 'Initial Investment (BDT)', 'RMB Received'],
}

def norm(value):
 return re.sub(r'\s+', ' ', str(value or '')).strip()

def scalar(cell, strings):
 if cell is None: return ''
 v = cell.find('s:v', NS)
 value = v.text if v is not None and v.text is not None else ''
 if cell.get('t') == 's': return strings[int(value)] if value else ''
 if cell.get('t') == 'inlineStr':
  return ''.join(t.text or '' for t in cell.findall('s:is//s:t', NS))
 return value

def redacted_formula(text):
 return re.sub(r'"[^"\n]*(?:https?://|@)[^"\n]*"', '"<REDACTED_REFERENCE>"', text)

def workbook_report(path):
 """Return structural metadata and aggregate counts, never business row values."""
 output = {'file': path.name, 'image_objects': 0, 'tabs': []}
 with zipfile.ZipFile(path) as z:
  output['image_objects'] = sum(n.startswith('xl/media/') and not n.endswith('/') for n in z.namelist())
  strings = []
  if 'xl/sharedStrings.xml' in z.namelist():
   for si in ET.fromstring(z.read('xl/sharedStrings.xml')):
    strings.append(''.join(t.text or '' for t in si.findall('.//s:t', NS)))
  relations = {x.get('Id'): x.get('Target') for x in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
  wb = ET.fromstring(z.read('xl/workbook.xml'))
  for sh in wb.find('s:sheets', NS):
   name = sh.get('name')
   target = relations[sh.get(RID)]
   target = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
   root = ET.fromstring(z.read(target))
   dim = root.find('s:dimension', NS)
   merged_root = root.find('s:mergeCells', NS)
   merges = [x.get('ref') for x in merged_root] if merged_root is not None else []
   header_row, key = SCHEMAS.get(name, (None, None))
   cells = {c.get('r'): c for c in root.findall('s:sheetData/s:row/s:c', NS)}
   header = {}
   if header_row:
    for address, cell in cells.items():
     if int(re.search(r'\d+$', address).group()) == header_row:
      text = norm(scalar(cell, strings))
      if text: header[re.match('[A-Z]+', address).group()] = text
   normalized = list(header.values())
   duplicates = [v for v, n in Counter(normalized).items() if n > 1]
   key_col = next((c for c, label in header.items() if label == key), None)
   rows = []
   if key_col:
    for address, cell in cells.items():
     if re.match('[A-Z]+', address).group() == key_col and int(re.search(r'\d+$', address).group()) > header_row:
      value = norm(scalar(cell, strings))
      if value: rows.append(value.upper())
   formulas = [(a, c.find('s:f', NS)) for a, c in cells.items() if c.find('s:f', NS) is not None]
   families = Counter()
   samples = []
   shared_missing = 0
   for address, f in formulas:
    if not f.text:
     shared_missing += 1
     continue
    formula = f.text
    family = re.sub(r'(\$?[A-Z]{1,3}\$?)\d+', r'\1#', formula)
    families[family] += 1
    col = re.match('[A-Z]+', address).group()
    if name in SCHEMAS and len(samples) < 12 and header.get(col) and not any(x['field'] == header[col] for x in samples):
     samples.append({'cell': address, 'field': header[col], 'formula': redacted_formula(formula)[:2400]})
   errors = [(a, scalar(c, strings)) for a, c in cells.items() if c.get('t') == 'e']
   # Shared-string values, SKU keys and customer data are deliberately discarded.
   secondary = {}
   for hr in {'Marketing & Packing': [34], 'Payment Matching': [29, 33]}.get(name, []):
    secondary[str(hr)] = {re.match('[A-Z]+', a).group(): norm(scalar(c, strings))
       for a,c in cells.items() if int(re.search(r'\d+$', a).group()) == hr and scalar(c,strings)}
   output['tabs'].append({
    'name': name, 'range': dim.get('ref') if dim is not None else None,
    'merged_range_count': len(merges), 'merged_range_examples': merges[:20],
    'header_row': header_row, 'headers': header, 'secondary_header_blocks': secondary,
    'duplicate_header_labels': duplicates,
    'missing_core_headers': [h for h in CORE_REQUIRED.get(name, []) if h not in normalized],
    'key_field': key, 'populated_key_rows': len(rows) if key_col else None,
    'repeated_key_groups': sum(n > 1 for n in Counter(rows).values()) if key_col else None,
    'key_repeat_note': 'Invoice No repeats are expected in line/event tables; not automatically duplicate records.',
    'formula_cells': len(formulas), 'explicit_formula_families': len(families),
    'shared_formula_dependents_without_text': shared_missing,
    'formula_samples': samples,
    'cached_error_count': len(errors), 'cached_error_types': dict(Counter(e for _, e in errors)),
    'cached_error_cell_examples': [a for a, _ in errors[:8]],
    'cached_error_note': 'XLSX snapshot caches are not proof of current live Google Sheets errors.'
   })
 return output

def classify(name):
 if name in {'onOpen', 'onSelectionChange', 'onEdit'}: return 2, 'Replace entrypoint; route existing behavior through shared services'
 if re.search('migrat|repair|force|audit|lockFormula|unlockFormula|protect|stripSr', name, re.I): return 8, 'Maintenance-only, with preview and recovery'
 if re.search('Payment|Settlement|CumulativeReceived|Receipt', name, re.I): return 6, 'Refactor receipt/allocation service'
 if re.search('Return|Lifecycle|Reversal|ActiveLines|ActiveSale|deleteSelectedInvoice|fullyDelete|purgeInvoice', name, re.I): return 5, 'Refactor immutable lifecycle and line identity'
 if re.search('Tracking|DeliveryStatus|StatusBundle|LineItemsStatus|colorInvoice|archive', name, re.I): return 5, 'Refactor tracking/lifecycle/archive'
 if re.search('Snapshot|Reporting|Dashboard', name, re.I): return 7, 'Refactor/reporting basis reconciliation'
 if re.search('Invoice|Picker|SelectedProducts|SalesRecord|Share|Email|Pdf|Phone|WhatsApp|whatsapp|Customer|Sale', name, re.I): return 4, 'Refactor invoice/customer/document workflow'
 if re.search('Product|Stock|PICache|piFormula', name, re.I): return 3, 'Refactor product/inventory service'
 return 2, 'Reuse or refactor shared helper after compatibility review'

def script_report(path, html_paths):
 source = path.read_text(encoding='utf-8')
 matches = list(re.finditer(r'^function\s+(\w+)\s*\(([^)]*)\)', source, re.M))
 names = {m.group(1) for m in matches}
 flags = ['SpreadsheetApp.getUi', 'getActiveSpreadsheet', 'getActiveSheet', 'getActiveCell',
          'getDocumentProperties', 'getDocumentCache', 'getDocumentLock', 'CacheService',
          'MailApp.sendEmail', 'deleteRow', 'clearContent', 'setFormula']
 functions = []
 for i, m in enumerate(matches):
  end = matches[i+1].start() if i+1 < len(matches) else len(source)
  body = source[m.start():end]
  phase, disposition = classify(m.group(1))
  calls = sorted(set(re.findall(r'\b(\w+)\s*\(', body)) & names - {m.group(1)})
  functions.append({'function': m.group(1), 'line': source[:m.start()].count('\n')+1,
   'parameters': norm(m.group(2)), 'target_phase': phase, 'disposition': disposition,
   'context_flags': [f for f in flags if f in body], 'candidate_dependencies': calls})
 menus = [{'label': a, 'function': b, 'target_phase': classify(b)[0]} for a, b in re.findall(r'\.addItem\("([^"]+)",\s*"([^"]+)"\)', source)]
 html = []
 for p in html_paths:
  text = p.read_text(encoding='utf-8')
  method_calls = set(re.findall(r'\.\s*(\w+)\s*\(', text))
  html.append({'file': p.name, 'server_calls': sorted(method_calls & names),
    'html_service_bridge': 'google.script.run' in text,
    'is_pdf_template': p.stem == 'InvoicePDF'})
 constants = dict(re.findall(r'\b(PI_FIRST_ROW|PI_LAST_ROW|PI_HEADER_ROW|SR_FIRST_ROW|SR_LAST_ROW|SR_HEADER_ROW|IT_FIRST_ROW|IT_LAST_ROW|IT_HEADER_ROW|LI_FIRST_ROW|LI_LAST_ROW|LI_HEADER_ROW|RET_FIRST_ROW|PM_RESULT_START|PM_LOG_START)\s*=\s*(\d+)', source))
 return {'functions': functions, 'menu_actions': menus, 'html_files': html,
  'row_constants': {k:int(v) for k,v in constants.items()},
  'web_entrypoints': [n for n in ['doGet','doPost'] if n in names],
  'scan_limitations': 'Top-level functions and literal method references are a structural scan, not a JavaScript call-graph proof.'}

def inspect(source_dir, output_dir):
 source_dir = Path(source_dir).resolve()
 output_dir = Path(output_dir).resolve()
 if output_dir == source_dir or source_dir in output_dir.parents:
  raise ValueError('Choose an output directory outside the source directory.')
 inputs = sorted(p for p in source_dir.iterdir() if p.suffix in {'.gs','.html','.xlsx'})
 if not inputs: raise ValueError('No .gs, .html or .xlsx source files found.')
 output_dir.mkdir(parents=True, exist_ok=True)
 manifest = [{'file':p.name, 'bytes':p.stat().st_size, 'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in inputs]
 workbooks = [workbook_report(p) for p in inputs if p.suffix == '.xlsx']
 script = script_report(source_dir/'Code.gs', [p for p in inputs if p.suffix == '.html']) if (source_dir/'Code.gs').exists() else None
 report = {'read_only':True, 'privacy':'No customer/product row values or credentials are exported.',
   'source_manifest':manifest, 'workbooks':workbooks, 'script':script}
 (output_dir/'schema_report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False)+'\n')
 if script:
  with (output_dir/'function_parity.csv').open('w', newline='',encoding='utf-8') as f:
   cols = ['function','line','parameters','target_phase','disposition','context_flags','candidate_dependencies']
   writer=csv.DictWriter(f,fieldnames=cols);writer.writeheader()
   for record in script['functions']:
    writer.writerow({k:'; '.join(v) if isinstance(v,list) else v for k,v in record.items()})
  (output_dir/'ui_mapping.json').write_text(json.dumps({'menu_actions':script['menu_actions'],'html_files':script['html_files']},indent=2)+'\n')
 lines=['# Workbook schema inventory','','Read-only source snapshot. Formula caches have not been recalculated.','']
 for wb in workbooks:
  lines += [f"## {wb['file']}",'',f"Embedded media objects: {wb['image_objects']}",'', '| Tab | Range | Header row | Formula cells | Core headers missing |','| --- | --- | --- | --- | --- |']
  for tab in wb['tabs']:
   lines.append(f"| {tab['name']} | {tab['range']} | {tab['header_row'] or 'Form/view'} | {tab['formula_cells']} | {', '.join(tab['missing_core_headers']) or 'None checked/missing'} |")
  for tab in wb['tabs']:
   if tab['headers']:
    lines += ['',f"### {tab['name']} fields",'', '| Column | Normalized label |','| --- | --- |']
    lines += [f'| {c} | {label.replace(chr(124), chr(47))} |' for c,label in tab['headers'].items()]
 (output_dir/'SCHEMA_INVENTORY.md').write_text('\n'.join(lines)+'\n')
 return report

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--source-dir', required=True, type=Path)
 parser.add_argument('--output-dir', required=True, type=Path)
 args=parser.parse_args()
 report=inspect(args.source_dir,args.output_dir)
 print(json.dumps({'workbooks':len(report['workbooks']), 'tabs':sum(len(w['tabs']) for w in report['workbooks']),
  'functions':len(report['script']['functions']) if report['script'] else 0,
  'menu_actions':len(report['script']['menu_actions']) if report['script'] else 0,
  'input_files_unchanged':all(hashlib.sha256((args.source_dir/r['file']).read_bytes()).hexdigest()==r['sha256'] for r in report['source_manifest'])}))

if __name__ == '__main__': main()
