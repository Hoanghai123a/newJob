import fs from 'node:fs/promises';
import { FileBlob, PresentationFile } from '@oai/artifact-tool';
const src = 'D:/My App/newApp/Tuyển Dụng 4.0 - Đề Xuất Số Hóa Vận Hành Nhân Sự.pptx';
const pres = await PresentationFile.importPptx(await FileBlob.load(src));
const snap = await pres.inspect({kind:'slide,textbox,shape,image,table,chart,notes,layout', maxChars:50000});
await fs.writeFile('D:/My App/newApp/.pptx-work/inspect.ndjson', snap.ndjson ?? String(snap));
console.log(snap.ndjson ?? snap);
