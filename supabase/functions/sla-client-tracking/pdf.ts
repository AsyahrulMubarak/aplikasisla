// Pinned dependency; all document data and logo are supplied from Supabase/the bundle.
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { LOGO } from './logo.ts';
const text = value => String(value ?? '').replace(/\r\n/g,'\n').replace(/[–—]/g,'-')
  .replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\u00a0/g,' ')
  .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g,'');
const bytes = base64 => Uint8Array.from(atob(base64), c=>c.charCodeAt(0));
export async function createPdf(ticket) {
  const missing = ['id_tiket','waktu_selesai','klien_lokasi','teknisi','deskripsi_pekerjaan_ba','nama_customer','tanda_tangan']
    .filter(key=>!String(ticket[key]||'').trim());
  if (missing.length || String(ticket.status||'').toLowerCase()!=='selesai') throw new Error('Data wajib Berita Acara belum lengkap.');
  const signature = String(ticket.tanda_tangan).match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!signature || signature[2].length>2800000) throw new Error('Tanda tangan klien tidak valid.');
  const pdf = await PDFDocument.create();
  pdf.setTitle('Berita Acara - '+ticket.id_tiket); pdf.setAuthor('CV. Alfacom Multi Solution');
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy=rgb(.12,.23,.54), muted=rgb(.35,.4,.48), ink=rgb(.13,.17,.23), pale=rgb(.95,.97,.99);
  const logo=await pdf.embedPng(bytes(LOGO));
  const sigBytes=bytes(signature[2]);
  // Prevent PNG images with unreasonable decoded dimensions from reaching the renderer.
  if(signature[1]==='png'){
    if(sigBytes.length<24)throw new Error('Tanda tangan tidak valid.');
    const view=new DataView(sigBytes.buffer), width=view.getUint32(16),height=view.getUint32(20);
    if(!width||!height||width>4000||height>4000||width*height>6000000)throw new Error('Ukuran tanda tangan tidak valid.');
  }
  const sig=signature[1]==='png'?await pdf.embedPng(sigBytes):await pdf.embedJpg(sigBytes);
  if(sig.width>4000||sig.height>4000||sig.width*sig.height>6000000)throw new Error('Ukuran tanda tangan tidak valid.');
  let page,y; const width=595.28,height=841.89,left=42,right=553.28,contentWidth=right-left;
  function draw(value,x,top,size=10,weight=font,color=ink){
    page.drawText(text(value),{x,y:top-size,size,font:weight,color});
  }
  function newPage(first=false){
    page=pdf.addPage([width,height]);y=height-42;
    if(first){
      const logoSize=logo.scaleToFit(150,70);
      page.drawImage(logo,{x:left,y:y-logoSize.height,width:logoSize.width,height:logoSize.height});
      draw('CV. ALFACOM MULTI SOLUTION',left+190,y+2,13,bold,navy);
      draw('BERITA ACARA PENYELESAIAN',left+190,y-23,11,bold,navy);
      draw('PEKERJAAN',left+190,y-40,11,bold,navy);
      y-=87;
    }else{draw('BERITA ACARA - '+ticket.id_tiket,left,y,11,bold,navy);y-=27;}
    page.drawLine({start:{x:left,y},end:{x:right,y},thickness:1.5,color:navy});y-=20;
  }
  function ensure(space){if(y-space<64)newPage();}
  function wrap(value,size,maxWidth,weight=font){
    const output=[];
    for(const paragraph of text(value).split('\n')){
      let line='';
      for(const word of paragraph.split(/\s+/).filter(Boolean)){
        const candidate=line?line+' '+word:word;
        if(weight.widthOfTextAtSize(candidate,size)<=maxWidth){line=candidate;continue;}
        if(line){output.push(line);line='';}
        let fragment='';
        for(const char of word){
          if(weight.widthOfTextAtSize(fragment+char,size)>maxWidth&&fragment){output.push(fragment);fragment='';}
          fragment+=char;
        }
        line=fragment;
      }
      output.push(line);
    }
    return output.length?output:['-'];
  }
  function paragraph(value,size=10,maxWidth=contentWidth,x=left){
    for(const line of wrap(value,size,maxWidth)){ensure(size+6);draw(line,x,y,size);y-=size+6;}
    y-=5;
  }
  function section(label){
    ensure(55);page.drawRectangle({x:left,y:y-25,width:contentWidth,height:25,color:pale});
    draw(label,left+9,y-5,10,bold,navy);y-=38;
  }
  newPage(true);
  const finished=new Date(ticket.waktu_selesai);
  const date=new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Makassar',dateStyle:'long',timeStyle:'short'}).format(finished)+' WITA';
  for(const [label,value] of [['ID Tiket SLA',ticket.id_tiket],['Tanggal Penyelesaian',date],
    ['Nama Klien / Lokasi',ticket.klien_lokasi],['Teknisi Pelaksana',ticket.teknisi]]){
    const lines=wrap(value,10,contentWidth-158);ensure(lines.length*16+9);
    draw(label,left,y,10,bold);for(const line of lines){draw(line,left+158,y,10);y-=16;}y-=6;
  }
  y-=5;section('RINCIAN PEKERJAAN');paragraph(ticket.deskripsi_pekerjaan_ba);
  section('CATATAN / KEPUASAN PELANGGAN');paragraph(ticket.kritik_saran||'-');
  ensure(190);y-=20;
  const column=contentWidth/2;
  draw('Klien / PIC',left+12,y,11,bold,navy);draw('Teknisi Alfacom',left+column+12,y,11,bold,navy);y-=28;
  const sigSize=sig.scaleToFit(column-28,95);
  page.drawImage(sig,{x:left+12,y:y-sigSize.height,width:sigSize.width,height:sigSize.height});
  draw('Disahkan melalui aplikasi SLA',left+column+12,y-8,9,font,muted);
  let techY=y-33;
  for(const name of text(ticket.teknisi).split(',').map(n=>n.trim()).filter(Boolean)){
    for(const line of wrap(name,10,column-24,bold)){draw(line,left+column+12,techY,10,bold);techY-=15;}
  }
  y-=110;
  paragraph(ticket.nama_customer,10,column-24,left+12);
  for(const [index,p] of pdf.getPages().entries()){
    p.drawLine({start:{x:left,y:45},end:{x:right,y:45},thickness:.5,color:rgb(.82,.85,.9)});
    p.drawText('Dokumen Berita Acara | '+ticket.id_tiket,{x:left,y:30,size:8,font,color:muted});
    p.drawText((index+1)+' / '+pdf.getPageCount(),{x:right-36,y:30,size:8,font,color:muted});
  }
  return pdf.save();
}

