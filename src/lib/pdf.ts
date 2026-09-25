// Gerador minimalista de PDF (sem dependências) — Helvetica core fonts, WinAnsi
// Cores do sistema: verde #059669 (brand), ink #0F172A, azul #2563EB, âmbar #D97706, rosa #E11D48

const A4_W = 595.28;
const A4_H = 841.89;

type Rgb = [number, number, number];

const hex2rgb = (h: string): Rgb => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];

export const PDF_COLORS = {
  brand: '#059669',
  ink: '#0F172A',
  sub: '#64748B',
  blue: '#2563EB',
  amber: '#D97706',
  rose: '#E11D48',
  bg: '#F1F5F9',
  line: '#E2E8F0',
};

const latin1 = (s: string) =>
  s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x00-\xFF]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

const esc = (s: string) => latin1(s);

// largura aproximada do texto em Helvetica (para alinhar à direita)
const CHAR_W: Record<string, number> = { default: 0.5 };
function textWidth(s: string, size: number, bold: boolean): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (/[iljt.,:;'|!()\[\]]/.test(ch)) w += 0.28;
    else if (/[fIL(){}\/\\-]/.test(ch)) w += 0.34;
    else if (/[mwMW@]/.test(ch)) w += 0.85;
    else if (/[A-Z0-9RDOIKNBEDHPUXNTC]/.test(ch)) w += 0.67;
    else if (ch === ' ') w += 0.28;
    else w += 0.53;
    void c;
  }
  void CHAR_W;
  return w * size * (bold ? 1.02 : 1);
}

export class PdfDoc {
  private pages: string[] = [];
  private cur = '';
  y = 0;
  readonly W = A4_W;
  readonly H = A4_H;

  constructor() {
    this.addPage();
  }

  addPage() {
    if (this.cur) this.pages.push(this.cur);
    this.cur = '';
    this.y = A4_H - 48;
  }

  private col(hex: string) {
    const [r, g, b] = hex2rgb(hex);
    return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
  }

  text(x: number, y: number, size: number, s: string, opts: { bold?: boolean; color?: string; align?: 'left' | 'right' | 'center' } = {}) {
    const { bold = false, color = PDF_COLORS.ink, align = 'left' } = opts;
    const w = textWidth(s, size, bold);
    let tx = x;
    if (align === 'right') tx = x - w;
    else if (align === 'center') tx = x - w / 2;
    this.cur += `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${this.col(color)} rg 1 0 0 1 ${tx.toFixed(2)} ${(A4_H - y).toFixed(2)} Tm (${esc(s)}) Tj ET\n`;
  }

  rect(x: number, y: number, w: number, h: number, color: string) {
    this.cur += `${this.col(color)} rg ${x.toFixed(2)} ${(A4_H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f\n`;
  }

  // Retângulo com cantos arredondados (preenchido)
  roundRect(x: number, y: number, w: number, h: number, r: number, color: string) {
    const rr = Math.min(r, w / 2, h / 2);
    const k = 0.5523 * rr;
    const Y = (yy: number) => (A4_H - yy).toFixed(2);
    this.cur += `${this.col(color)} rg ${x + rr} ${Y(y + h)} m `
      + `${x + w - rr} ${Y(y + h)} l ${x + w - rr + k} ${Y(y + h)} ${x + w} ${Y(y + h - rr + k)} ${x + w} ${Y(y + h - rr)} c `
      + `${x + w} ${Y(y + rr)} l ${x + w} ${Y(y + rr - k)} ${x + w - rr + k} ${Y(y)} ${x + w - rr} ${Y(y)} c `
      + `${x + rr} ${Y(y)} l ${x + rr - k} ${Y(y)} ${x} ${Y(y + rr - k)} ${x} ${Y(y + rr)} c `
      + `${x} ${Y(y + h - rr)} l ${x} ${Y(y + h - rr + k)} ${x + rr - k} ${Y(y + h)} ${x + rr} ${Y(y + h)} c h f\n`;
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 0.75) {
    this.cur += `${this.col(color)} RG ${width} w ${x1.toFixed(2)} ${(A4_H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(A4_H - y2).toFixed(2)} l S\n`;
  }

  space(h: number) {
    this.y += h;
  }

  ensure(h: number, onPageBreak?: () => void) {
    if (this.y + h > A4_H - 56) {
      this.addPage();
      onPageBreak?.();
    }
  }

  build(): Blob {
    this.pages.push(this.cur);
    this.cur = '';
    const objs: string[] = [];
    const nPages = this.pages.length;
    // 1 catalog, 2 pages, 3 F1, 4 F2, then per page: page obj + content obj
    const pageObjIds = this.pages.map((_, i) => 5 + i * 2);

    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[2] = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${nPages} >>`;
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

    this.pages.forEach((content, i) => {
      const pid = pageObjIds[i];
      const cid = pid + 1;
      objs[pid] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W.toFixed(2)} ${A4_H.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cid} 0 R >>`;
      objs[cid] = `<< /Length ${content.length} >>\nstream\n${content}endstream`;
    });

    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xrefStart = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++) {
      out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }
}

export const brlPdf = (v: number) =>
  'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const downloadPdf = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};
