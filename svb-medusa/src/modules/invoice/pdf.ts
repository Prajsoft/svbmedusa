import PDFDocument from "pdfkit"
import type { InvoiceData } from "./generator"

// ── Constants ─────────────────────────────────────────────────────────────────

const ML = 40       // margin left
const MR = 40       // margin right
const PW = 595      // A4 width in points
const CW = PW - ML - MR  // content width = 515

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number): string {
  // Use "Rs." prefix - standard Helvetica font doesn't include the rupee glyph
  return "Rs." + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

function hline(doc: PDFKit.PDFDocument, y: number): void {
  doc
    .save()
    .strokeColor("#CCCCCC")
    .moveTo(ML, y)
    .lineTo(PW - MR, y)
    .stroke()
    .restore()
}

type ColDef = { header: string; w: number; align?: "left" | "center" | "right" }

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  y: number,
  cols: ColDef[],
  totalW: number = CW
): number {
  const H = 16
  doc.save().rect(ML, y, totalW, H).fill("#E8E8E8").restore()
  doc.fillColor("black").font("Helvetica-Bold").fontSize(7)
  let cx = ML + 2
  for (const col of cols) {
    doc.text(col.header, cx, y + 4, {
      width: col.w - 3,
      align: col.align ?? "center",
      lineBreak: false,
    })
    cx += col.w
  }
  return y + H
}

/** Split a comma-separated address string into lines of ~maxChars each. */
function wrapAddress(text: string, maxChars: number): string[] {
  if (!text) return []
  const parts = text.split(", ")
  const lines: string[] = []
  let cur = ""
  for (const part of parts) {
    const candidate = cur ? `${cur}, ${part}` : part
    if (candidate.length > maxChars && cur) {
      lines.push(cur)
      cur = part
    } else {
      cur = candidate
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : [text]
}

// ── PDF generator ─────────────────────────────────────────────────────────────

export function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true })
    const chunks: Buffer[] = []
    doc.on("data", (c: Buffer) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)

    let y = 40

    // ── Title bar ─────────────────────────────────────────────────────────────
    doc.save().rect(ML, y, CW, 26).fill("#1A56DB").restore()
    doc
      .fillColor("white")
      .font("Helvetica-Bold")
      .fontSize(13)
      .text("TAX INVOICE", ML, y + 7, { width: CW, align: "center" })
    y += 34

    // ── Seller | Buyer block ───────────────────────────────────────────────────
    const half = Math.floor(CW / 2)
    const blockStartY = y

    // LEFT — seller
    let sy = blockStartY
    doc.fillColor("#666666").font("Helvetica-Bold").fontSize(7).text("SOLD BY", ML, sy)
    sy += 11
    doc
      .fillColor("black")
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .text(data.seller.name, ML, sy, { width: half - 10, lineBreak: false })
    sy += 13
    doc.font("Helvetica").fontSize(7.5)
    for (const line of wrapAddress(data.seller.address, 42)) {
      doc.text(line, ML, sy, { width: half - 10, lineBreak: false })
      sy += 11
    }
    if (data.seller.gstin) {
      doc.text(`GSTIN: ${data.seller.gstin}`, ML, sy, { lineBreak: false })
      sy += 11
    }
    if (data.seller.pan) {
      doc.text(`PAN: ${data.seller.pan}`, ML, sy, { lineBreak: false })
      sy += 11
    }
    if (data.seller.email) {
      doc.text(`Email: ${data.seller.email}`, ML, sy, { lineBreak: false })
      sy += 11
    }
    if (data.seller.phone) {
      doc.text(`Phone: ${data.seller.phone}`, ML, sy, { lineBreak: false })
      sy += 11
    }

    // RIGHT — buyer
    const bx = ML + half + 5
    const bw = half - 5
    let by = blockStartY
    doc.fillColor("#666666").font("Helvetica-Bold").fontSize(7).text("BILL TO", bx, by)
    by += 11
    doc
      .fillColor("black")
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .text(data.buyer.name, bx, by, { width: bw, lineBreak: false })
    by += 13
    doc.font("Helvetica").fontSize(7.5)
    for (const line of wrapAddress(data.buyer.address, 42)) {
      doc.text(line, bx, by, { width: bw, lineBreak: false })
      by += 11
    }
    if (data.buyer.gstin) {
      doc.text(`GSTIN: ${data.buyer.gstin}`, bx, by, { lineBreak: false })
      by += 11
    }
    if (data.buyer.phone) {
      doc.text(`Phone: ${data.buyer.phone}`, bx, by, { lineBreak: false })
      by += 11
    }

    y = Math.max(sy, by) + 10

    // ── Invoice meta ──────────────────────────────────────────────────────────
    hline(doc, y)
    y += 6
    doc
      .fillColor("black")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(`Invoice No: ${data.invoiceNumber}`, ML, y, { lineBreak: false })
      .text(`Date: ${data.invoiceDate}`, ML + half, y, { lineBreak: false })
    y += 18

    // ── Line items table ──────────────────────────────────────────────────────
    hline(doc, y)
    y += 6

    // Column widths sum to 500 (fits within CW=515 with 2px left padding)
    const itemCols: ColDef[] = [
      { header: "#",           w: 20,  align: "center" },
      { header: "Description", w: 140, align: "left"   },
      { header: "HSN",         w: 40,  align: "center" },
      { header: "Qty",         w: 25,  align: "center" },
      { header: "Unit Price",  w: 58,  align: "right"  },
      { header: "Taxable Amt", w: 55,  align: "right"  },
      { header: "CGST %",      w: 32,  align: "center" },
      { header: "CGST Amt",    w: 50,  align: "right"  },
      { header: "SGST %",      w: 32,  align: "center" },
      { header: "SGST Amt",    w: 48,  align: "right"  },
    ]

    y = drawTableHeader(doc, y, itemCols)

    doc.font("Helvetica").fontSize(7.5).fillColor("black")
    for (const item of data.lineItems) {
      const rowData = [
        String(item.sno),
        item.description,
        item.hsn,
        String(item.qty),
        fmt(item.unitPrice),
        fmt(item.taxableAmount),
        `${item.cgstRate}%`,
        fmt(item.cgstAmount),
        `${item.sgstRate}%`,
        fmt(item.sgstAmount),
      ]

      const descLineCount = Math.ceil(item.description.length / 24)
      const rowH = Math.max(16, descLineCount * 10 + 6)

      doc.save().rect(ML, y, CW, rowH).stroke("#DDDDDD").restore()
      let cx = ML + 2
      for (let i = 0; i < itemCols.length; i++) {
        doc.text(rowData[i], cx, y + Math.floor((rowH - 8) / 2), {
          width: itemCols[i].w - 3,
          align: itemCols[i].align ?? "left",
          lineBreak: false,
        })
        cx += itemCols[i].w
      }
      y += rowH
    }

    hline(doc, y)
    y += 12

    // ── Totals block (right-aligned) ──────────────────────────────────────────
    const totValW = 160
    const totLblW = 80
    const totValX = PW - MR - totValW
    const totLblX = totValX - totLblW - 5

    const totRows: [string, string][] = [
      ["Subtotal", fmt(data.subtotal)],
      ...(data.discountTotal > 0
        ? [["Discount", `- ${fmt(data.discountTotal)}`] as [string, string]]
        : []),
      ["Shipping", fmt(data.shippingTotal)],
      ["CGST", fmt(data.cgstTotal)],
      ["SGST", fmt(data.sgstTotal)],
    ]

    doc.font("Helvetica").fontSize(8).fillColor("black")
    for (const [label, value] of totRows) {
      doc.text(label, totLblX, y, { width: totLblW, align: "right", lineBreak: false })
      doc.text(value, totValX, y, { width: totValW, align: "right", lineBreak: false })
      y += 14
    }

    y += 3
    const totRowW = totLblW + 10 + totValW
    doc.save().rect(totLblX - 5, y, totRowW, 20).fill("#1A56DB").restore()
    doc
      .fillColor("white")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text("TOTAL", totLblX, y + 5, { width: totLblW, align: "right", lineBreak: false })
      .text(fmt(data.total), totValX, y + 5, { width: totValW, align: "right", lineBreak: false })
    y += 28

    // ── Amount in words ───────────────────────────────────────────────────────
    doc
      .fillColor("black")
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text("Amount in Words: " + data.amountInWords, ML, y, { width: CW })
    y += 20

    // ── GST tax summary table ─────────────────────────────────────────────────
    hline(doc, y)
    y += 6
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("black").text("GST TAX SUMMARY", ML, y)
    y += 12

    const taxTableW = 480
    const taxCols: ColDef[] = [
      { header: "GST Rate",       w: 70,  align: "center" },
      { header: "Taxable Amount", w: 130, align: "right"  },
      { header: "CGST Amount",    w: 100, align: "right"  },
      { header: "SGST Amount",    w: 100, align: "right"  },
      { header: "Total Tax",      w: 80,  align: "right"  },
    ]

    y = drawTableHeader(doc, y, taxCols, taxTableW)

    // Aggregate by GST rate
    const rateMap = new Map<
      number,
      { taxable: number; cgst: number; sgst: number }
    >()
    for (const item of data.lineItems) {
      const rate = item.cgstRate + item.sgstRate
      const prev = rateMap.get(rate) ?? { taxable: 0, cgst: 0, sgst: 0 }
      rateMap.set(rate, {
        taxable: prev.taxable + item.taxableAmount,
        cgst: prev.cgst + item.cgstAmount,
        sgst: prev.sgst + item.sgstAmount,
      })
    }

    doc.font("Helvetica").fontSize(7.5).fillColor("black")
    for (const [rate, amounts] of rateMap.entries()) {
      const tRow = [
        `${rate}%`,
        fmt(amounts.taxable),
        fmt(amounts.cgst),
        fmt(amounts.sgst),
        fmt(amounts.cgst + amounts.sgst),
      ]
      doc.save().rect(ML, y, taxTableW, 15).stroke("#DDDDDD").restore()
      let cx = ML + 2
      for (let i = 0; i < taxCols.length; i++) {
        doc.text(tRow[i], cx, y + 4, {
          width: taxCols[i].w - 3,
          align: taxCols[i].align ?? "center",
          lineBreak: false,
        })
        cx += taxCols[i].w
      }
      y += 15
    }

    y += 20

    // ── Footer ────────────────────────────────────────────────────────────────
    hline(doc, y)
    y += 6
    doc
      .fillColor("#888888")
      .font("Helvetica")
      .fontSize(7)
      .text(
        "This is a computer-generated invoice. No signature required.",
        ML,
        y,
        { width: CW, align: "center" }
      )

    doc.end()
  })
}
