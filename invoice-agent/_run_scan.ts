import { scanInvoiceEmails } from "./tools/scan-invoice-emails.ts";

const result = await scanInvoiceEmails({ sinceHours: 240, maxResults: 50 });
console.log(JSON.stringify(result, null, 2));
