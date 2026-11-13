import type { ConnectionData, WorkspaceData } from '../shared/types';

export const sampleWorkspace: WorkspaceData = {
  mode: 'sample', asOf: '2026-11-05T14:00:00Z', timezone: 'Asia/Dhaka',
  warnings: [], limits: { products: 200, invoices: 1000 },
  products: [
    { id:'SAMPLE-01',sku:'EM-001',name:'Everyday canvas tote',category:'Bags',openingStock:40,stock:28,price:890,cost:530 },
    { id:'SAMPLE-02',sku:'EM-002',name:'Ceramic travel cup',category:'Home',openingStock:32,stock:18,price:1250,cost:780 },
    { id:'SAMPLE-03',sku:'EM-003',name:'Minimal desk organizer',category:'Home',openingStock:24,stock:6,price:750,cost:430 },
    { id:'SAMPLE-04',sku:'EM-004',name:'Everyday crossbody bag',category:'Bags',openingStock:25,stock:14,price:1690,cost:1050 },
    { id:'SAMPLE-05',sku:'EM-005',name:'Soft cotton scrunchies',category:'Accessories',openingStock:60,stock:42,price:250,cost:110 },
    { id:'SAMPLE-06',sku:'EM-006',name:'Glass storage jar',category:'Home',openingStock:20,stock:8,price:650,cost:390 },
    { id:'SAMPLE-07',sku:'EM-007',name:'Compact travel pouch',category:'Bags',openingStock:28,stock:17,price:590,cost:340 },
    { id:'SAMPLE-08',sku:'EM-008',name:'Classic hair clip',category:'Accessories',openingStock:45,stock:31,price:320,cost:150 },
    { id:'SAMPLE-09',sku:'EM-009',name:'Linen cushion cover',category:'Home',openingStock:18,stock:4,price:790,cost:480 },
    { id:'SAMPLE-10',sku:'EM-010',name:'Stainless steel flask',category:'Home',openingStock:15,stock:11,price:1490,cost:890 },
    { id:'SAMPLE-11',sku:'EM-011',name:'Foldable shopping bag',category:'Bags',openingStock:30,stock:0,price:390,cost:210 },
    { id:'SAMPLE-12',sku:'EM-012',name:'Essential jewelry tray',category:'Accessories',openingStock:22,stock:16,price:690,cost:390 },
  ],
  invoices: [
    {id:'SAMPLE-I08',number:'INV-00108',date:'2026-11-05',customer:'Sample customer A',phone:'',total:2580,paymentStatus:'Pending',deliveryStatus:'Processing',tracking:'DEMO-108',expectedCredit:2528.4,actualCredit:0},
    {id:'SAMPLE-I07',number:'INV-00107',date:'2026-11-04',customer:'Sample customer B',phone:'',total:1690,paymentStatus:'Pending',deliveryStatus:'In Transit',tracking:'DEMO-107',expectedCredit:1656.2,actualCredit:0},
    {id:'SAMPLE-I06',number:'INV-00106',date:'2026-11-03',customer:'Sample customer C',phone:'',total:2140,paymentStatus:'Received',deliveryStatus:'Delivered',tracking:'DEMO-106',expectedCredit:2097.2,actualCredit:2097.2},
    {id:'SAMPLE-I05',number:'INV-00105',date:'2026-11-02',customer:'Sample customer D',phone:'',total:1250,paymentStatus:'Partial',deliveryStatus:'Delivered',tracking:'DEMO-105',expectedCredit:1225,actualCredit:700},
    {id:'SAMPLE-I04',number:'INV-00104',date:'2026-11-01',customer:'Sample customer E',phone:'',total:3570,paymentStatus:'Received',deliveryStatus:'Delivered',tracking:'DEMO-104',expectedCredit:3498.6,actualCredit:3498.6},
    {id:'SAMPLE-I03',number:'INV-00103',date:'2026-10-30',customer:'Sample customer F',phone:'',total:890,paymentStatus:'Received',deliveryStatus:'Delivered',tracking:'DEMO-103',expectedCredit:872.2,actualCredit:872.2},
    {id:'SAMPLE-I02',number:'INV-00102',date:'2026-10-28',customer:'Sample customer G',phone:'',total:750,paymentStatus:'Returned',deliveryStatus:'Returned',tracking:'DEMO-102',expectedCredit:0,actualCredit:0},
    {id:'SAMPLE-I01',number:'INV-00101',date:'2026-10-25',customer:'Sample customer H',phone:'',total:1840,paymentStatus:'Received',deliveryStatus:'Delivered',tracking:'DEMO-101',expectedCredit:1803.2,actualCredit:1803.2},
  ],
};

export function sampleConnection(): ConnectionData {
  return { state:'sample',checkedAt:new Date().toISOString(),readOnly:true,checks:[
    {label:'Workspace preview',status:'passed',detail:'Synthetic records only. No Google account is accessed.'},
    {label:'Admin Google sign-in',status:'not_run',detail:'Requires your designated admin account and OAuth setup.'},
    {label:'Sales and inventory Sheet',status:'not_run',detail:'Waiting for the private Google Sheet link and owner authorization.'},
    {label:'Investment Sheet',status:'not_run',detail:'Waiting for the private Google Sheet link and owner authorization.'},
  ]};
}
