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
