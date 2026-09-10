import { FileBlob, PresentationFile } from '@oai/artifact-tool';
const src='D:/My App/newApp/Tuyển Dụng 4.0 - Đề Xuất Số Hóa Vận Hành Nhân Sự.pptx';
const p=await PresentationFile.importPptx(await FileBlob.load(src));
for (const id of ['sh/pcz254na','sh/4bq1wzmp','sh/rq9g7mhs','tb/upozutcf']) {
 const o=p.resolve(id);
 console.log('\nID',id,'keys',Object.keys(o));
 console.log('text',o.text?.text, 'style', o.text?.style);
 console.log('frame',o.frame, 'geometry', o.geometry);
}
