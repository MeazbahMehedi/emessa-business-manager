import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from xml.sax.saxutils import escape
import zipfile

MODULE=Path(__file__).resolve().parents[1]/'tools'/'inspect_sources.py'
spec=importlib.util.spec_from_file_location('inspect_sources',MODULE)
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)

def text_cell(address,text):
 return f'<c r="{address}" t="inlineStr"><is><t>{escape(text)}</t></is></c>'

def make_book(path,rows,name='Product Inventory',shared=None):
 with zipfile.ZipFile(path,'w') as z:
  z.writestr('xl/workbook.xml',f'<workbook xmlns="{audit.NS["s"]}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{name}" sheetId="1" r:id="rId1"/></sheets></workbook>')
  z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
  z.writestr('xl/worksheets/sheet1.xml',f'<worksheet xmlns="{audit.NS["s"]}"><dimension ref="A1:F9"/><sheetData>{rows}</sheetData></worksheet>')
  if shared:z.writestr('xl/sharedStrings.xml',shared)

class InspectorTests(unittest.TestCase):
 def test_normalizes_header_newline(self):
  self.assertEqual(audit.norm(' Current Stock\n(PCS) '),'Current Stock (PCS)')

 def test_business_row_values_are_not_exported(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'source.xlsx'
   make_book(p,'<row r="5">'+text_cell('C5','Product ID')+'</row><row r="6">'+text_cell('C6','SENSITIVE_SKU')+text_cell('D6','SENSITIVE_PERSON')+'</row>')
   data=audit.workbook_report(p)
   self.assertEqual(data['tabs'][0]['populated_key_rows'],1)
   self.assertNotIn('SENSITIVE_',json.dumps(data))

 def test_reports_repeated_keys_without_identifiers(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'source.xlsx'
   make_book(p,'<row r="5">'+text_cell('C5','Product ID')+'</row><row r="6">'+text_cell('C6','PRIVATE_SKU')+'</row><row r="7">'+text_cell('C7','private_sku')+'</row>')
   t=audit.workbook_report(p)['tabs'][0]
   self.assertEqual(t['repeated_key_groups'],1)
   self.assertNotIn('PRIVATE_SKU',json.dumps(t))

 def test_shared_strings_and_missing_fields(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'source.xlsx'
   make_book(p,'<row r="5"><c r="F5" t="s"><v>0</v></c></row>',shared=f'<sst xmlns="{audit.NS["s"]}"><si><t>Current Stock\n(PCS)</t></si></sst>')
   t=audit.workbook_report(p)['tabs'][0]
   self.assertEqual(t['headers']['F'],'Current Stock (PCS)')
   self.assertIn('Product ID',t['missing_core_headers'])

 def test_url_formula_reference_is_redacted(self):
  self.assertNotIn('SECRET',audit.redacted_formula('IMAGE("https://example.invalid/SECRET")'))

 def test_output_inside_source_is_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaises(ValueError):audit.inspect(Path(d),Path(d)/'nested')

 def test_audit_leaves_source_bytes_unchanged(self):
  with tempfile.TemporaryDirectory() as d:
   source=Path(d)/'in';source.mkdir();p=source/'example.xlsx'
   make_book(p,'<row r="5">'+text_cell('C5','Product ID')+'</row>')
   before=hashlib.sha256(p.read_bytes()).hexdigest()
   result=audit.inspect(source,Path(d)/'out')
   self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),before)
   self.assertEqual(result['source_manifest'][0]['sha256'],before)

if __name__=='__main__':unittest.main()
