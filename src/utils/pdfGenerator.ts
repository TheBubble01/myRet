import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Retirement, DailyRecord, SupplementaryEntry } from '../types';
import { formatNaira } from './currency';
import { loadPDFFonts } from './pdfFonts';

export interface PDFExportOptions {
  retirement: Retirement;
  dailyRecords: DailyRecord[];
  supplementary: SupplementaryEntry[];
  startDate?: string;
  endDate?: string;
  connectedRetirements?: {
    retirement: Retirement;
    dailyRecords: DailyRecord[];
    supplementary: SupplementaryEntry[];
  }[];
}

interface RetirementReportGroup {
  retirement: Retirement;
  dailyRecords: DailyRecord[];
  supplementary: SupplementaryEntry[];
  isMain: boolean;
}

export async function generateRetirementPDF(options: PDFExportOptions): Promise<jsPDF> {
  const { retirement, dailyRecords, supplementary, startDate, endDate, connectedRetirements } = options;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Load Unicode-compliant font (Noto Sans) supporting Nigerian Naira (₦ U+20A6)
  const fonts = await loadPDFFonts();
  let fontName = 'helvetica';

  if (fonts) {
    try {
      doc.addFileToVFS('NotoSans-Regular.ttf', fonts.regular);
      doc.addFileToVFS('NotoSans-Bold.ttf', fonts.bold);

      // Explicitly register 'NotoSans-Regular.ttf' for all text output
      doc.addFont('NotoSans-Regular.ttf', 'NotoSans-Regular.ttf', 'normal');
      doc.addFont('NotoSans-Bold.ttf', 'NotoSans-Regular.ttf', 'bold');

      // Also register aliases for full font compatibility across jsPDF and plugins
      doc.addFont('NotoSans-Regular.ttf', 'NotoSans-Regular', 'normal');
      doc.addFont('NotoSans-Bold.ttf', 'NotoSans-Regular', 'bold');
      doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
      doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');

      fontName = 'NotoSans-Regular.ttf';
    } catch (e) {
      console.warn('Failed to register NotoSans in jsPDF, falling back to helvetica:', e);
      fontName = 'helvetica';
    }
  }

  doc.setFont(fontName, 'normal');

  const pageWidth = doc.internal.pageSize.getWidth();
  let currentY = 18;

  // Filter helper for date range
  const filterRecords = (records: DailyRecord[]): DailyRecord[] => {
    let result = records;
    if (startDate) {
      result = result.filter((r) => r.date >= startDate);
    }
    if (endDate) {
      result = result.filter((r) => r.date <= endDate);
    }
    return result;
  };

  // Build report groups: Main retirement first, then direct connected retirements (1-level only)
  const hasConnected = !!(connectedRetirements && connectedRetirements.length > 0);

  const reportGroups: RetirementReportGroup[] = [
    {
      retirement,
      dailyRecords: filterRecords(dailyRecords),
      supplementary,
      isMain: true,
    },
    ...(hasConnected
      ? connectedRetirements!.map((c) => ({
          retirement: c.retirement,
          dailyRecords: filterRecords(c.dailyRecords),
          supplementary: c.supplementary,
          isMain: false,
        }))
      : []),
  ];

  // Header Banner Background
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(14, currentY, pageWidth - 28, 24, 'F');

  // Title
  doc.setTextColor(245, 158, 11); // Amber-500
  doc.setFontSize(15);
  doc.setFont(fontName, 'bold');
  doc.text('myRet', 20, currentY + 9.5);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.setFont(fontName, 'normal');
  doc.text(
    hasConnected
      ? 'COMBINED SITE EXPENDITURE & RETIREMENT REPORT'
      : 'CONSTRUCTION SITE EXPENDITURE & RETIREMENT REPORT',
    40,
    currentY + 9.5
  );

  doc.setTextColor(148, 163, 184); // slate-400
  doc.setFontSize(7.5);
  doc.text(
    hasConnected
      ? `Consolidated Statement (${reportGroups.length} Connected Milestones) | Official Audit Record`
      : 'Your Site Expenditure, Digitized. | Official Audit Record',
    20,
    currentY + 18
  );

  // Status/Code badge on right
  doc.setFillColor(245, 158, 11);
  doc.roundedRect(pageWidth - 62, currentY + 5.5, 44, 13, 2, 2, 'F');
  doc.setTextColor(15, 23, 42);
  doc.setFont(fontName, 'bold');
  doc.setFontSize(8.5);
  doc.text(retirement.code, pageWidth - 40, currentY + 14, { align: 'center' });

  currentY += 29;

  // Metadata Box
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(203, 213, 225); // slate-300
  doc.roundedRect(14, currentY, pageWidth - 28, 26, 2, 2, 'FD');

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.setFont(fontName, 'bold');
  doc.text('RETIREMENT:', 18, currentY + 6.5);
  doc.text('PROJECT / SITE:', 18, currentY + 13.5);
  doc.text('PERIOD:', 18, currentY + 20.5);

  doc.setFont(fontName, 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(retirement.title, 55, currentY + 6.5);
  doc.text(retirement.project, 55, currentY + 13.5);

  // Determine span period across all records
  const allDates = reportGroups.flatMap((g) => g.dailyRecords.map((r) => r.date)).sort();
  let periodText = 'Entire Retirement Duration';
  if (startDate && endDate) {
    periodText = `${formatDisplayDate(startDate)} to ${formatDisplayDate(endDate)}`;
  } else if (startDate) {
    periodText = `From ${formatDisplayDate(startDate)}`;
  } else if (endDate) {
    periodText = `Up to ${formatDisplayDate(endDate)}`;
  } else if (allDates.length > 0) {
    periodText = `${formatDisplayDate(allDates[0])} to ${formatDisplayDate(allDates[allDates.length - 1])}`;
  }
  doc.text(periodText, 55, currentY + 20.5);

  // Right column of Metadata
  doc.setFont(fontName, 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('SITE ENGINEER / OWNER:', pageWidth / 2 + 10, currentY + 6.5);
  doc.text('DESIGNATION:', pageWidth / 2 + 10, currentY + 13.5);
  doc.text('DATE GENERATED:', pageWidth / 2 + 10, currentY + 20.5);

  doc.setFont(fontName, 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(retirement.ownerName || 'Site Engineer', pageWidth / 2 + 54, currentY + 6.5);
  doc.text(retirement.ownerDesignation || 'Field Engineer', pageWidth / 2 + 54, currentY + 13.5);
  doc.text(new Date().toLocaleDateString('en-GB'), pageWidth / 2 + 54, currentY + 20.5);

  currentY += 31;

  // --- DETAILED RECORDS ---
  // The report flows naturally from the metadata box directly into retirement records.
  // Large section headings like "DAILY RETIREMENT RECORDS" and "DETAILED DAILY RETIREMENT RECORDS"
  // are removed per requirements. The report flows cleanly directly into retirement records.

  let totalDailyExpenditure = 0;
  const categorySummaryMap = new Map<string, { displayName: string; total: number }>();
  const dailyDateMap = new Map<string, number>();

  // Process each retirement group sequentially
  reportGroups.forEach((group) => {
    let groupDailyTotal = 0;

    // Check page space for retirement heading
    if (currentY > 240) {
      doc.addPage();
      currentY = 20;
    }

    // Simplified retirement heading: ONLY "Title - Retirement Code"
    // No "[MAIN RETIREMENT]" or "[CONNECTED RETIREMENT]" labels per requirements.
    doc.setTextColor(15, 23, 42); // slate-900
    doc.setFont(fontName, 'bold');
    doc.setFontSize(10);
    doc.text(`${group.retirement.title} - ${group.retirement.code}`, 14, currentY + 3.5);

    // Subtle clean divider line under retirement title
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(14, currentY + 5.5, pageWidth - 14, currentY + 5.5);

    currentY += 9;

    if (group.dailyRecords.length === 0) {
      doc.setTextColor(100, 116, 139);
      doc.setFont(fontName, 'normal');
      doc.setFontSize(7.5);
      doc.text(`No daily expense entries recorded for this retirement.`, 14, currentY + 2);
      currentY += 7;
    } else {
      group.dailyRecords.forEach((record) => {
        if (currentY > 240) {
          doc.addPage();
          currentY = 20;
        }

        // Clean Date Header Bar: shows the date clearly with NO daily total beside it
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(14, currentY, pageWidth - 28, 6.5, 1, 1, 'FD');

        doc.setTextColor(30, 41, 59);
        doc.setFont(fontName, 'bold');
        doc.setFontSize(8);
        doc.text(`Date: ${formatDisplayDate(record.date)}`, 18, currentY + 4.5);

        currentY += 8.5;

        record.categories.forEach((cat) => {
          if (currentY > 245) {
            doc.addPage();
            currentY = 20;
          }

          // Category Subheader
          doc.setTextColor(180, 83, 9); // amber-700
          doc.setFont(fontName, 'bold');
          doc.setFontSize(7.5);
          doc.text(`Category: ${cat.name}`, 14, currentY + 3);
          currentY += 5;

          // Table for line items
          const tableBody = cat.items.map((item) => [
            item.description,
            item.quantity.toString(),
            formatNaira(item.rate),
            formatNaira(item.amount),
          ]);

          // Category Subtotal row (kept per requirement #6)
          tableBody.push([
            {
              content: `${cat.name} Subtotal:`,
              colSpan: 3,
              styles: { halign: 'right', fontStyle: 'bold', font: fontName },
            },
            {
              content: formatNaira(cat.subtotal),
              styles: { halign: 'right', fontStyle: 'bold', font: fontName, textColor: [15, 23, 42] },
            },
          ] as any);

          autoTable(doc, {
            startY: currentY,
            margin: { left: 14, right: 14, bottom: 20 },
            head: [['Description', 'Quantity', 'Rate', 'Amount']],
            body: tableBody,
            theme: 'grid',
            styles: {
              font: fontName,
              fontSize: 7.5,
              cellPadding: 2,
              textColor: [30, 41, 59],
              lineColor: [226, 232, 240],
              lineWidth: 0.1,
            },
            headStyles: {
              font: fontName,
              fillColor: [51, 65, 85],
              textColor: [255, 255, 255],
              fontSize: 7.5,
              fontStyle: 'bold',
              cellPadding: 2,
            },
            columnStyles: {
              0: { cellWidth: 'auto' },
              1: { cellWidth: 22, halign: 'center' },
              2: { cellWidth: 34, halign: 'right' },
              3: { cellWidth: 38, halign: 'right' },
            },
          });

          currentY = (doc as any).lastAutoTable.finalY + 3.5;

          // Aggregate category amounts into overall categorySummaryMap
          const catKey = cat.name.trim().toLowerCase();
          const existingCat = categorySummaryMap.get(catKey);
          if (existingCat) {
            existingCat.total += cat.subtotal;
          } else {
            categorySummaryMap.set(catKey, {
              displayName: cat.name.trim(),
              total: cat.subtotal,
            });
          }
        });

        // Exactly ONE overall daily total at the end of each day (per requirement #7)
        if (currentY > 255) {
          doc.addPage();
          currentY = 20;
        }

        doc.setFillColor(241, 245, 249); // slate-100
        doc.setDrawColor(203, 213, 225); // slate-300
        doc.roundedRect(pageWidth - 78, currentY, 64, 6.5, 1, 1, 'FD');

        doc.setFont(fontName, 'bold');
        doc.setFontSize(8);
        doc.setTextColor(15, 23, 42);
        doc.text('Total:', pageWidth - 74, currentY + 4.5);
        doc.text(formatNaira(record.dailyTotal), pageWidth - 16.5, currentY + 4.5, { align: 'right' });

        currentY += 9;

        // Add to daily total tallies
        groupDailyTotal += record.dailyTotal;
        totalDailyExpenditure += record.dailyTotal;

        const currentDailySum = dailyDateMap.get(record.date) || 0;
        dailyDateMap.set(record.date, currentDailySum + record.dailyTotal);
      });
    }
  });

  // --- SUPPLEMENTARY PAYMENTS SECTION ---
  let totalSupplementary = 0;
  let hasAnySupplementary = false;

  reportGroups.forEach((g) => {
    if (g.supplementary.length > 0) {
      hasAnySupplementary = true;
      totalSupplementary += g.supplementary.reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
    }
  });

  if (hasAnySupplementary) {
    if (currentY > 230) {
      doc.addPage();
      currentY = 20;
    }

    doc.setTextColor(15, 23, 42);
    doc.setFont(fontName, 'bold');
    doc.setFontSize(9.5);
    doc.text('Supplementary', 14, currentY + 4);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(14, currentY + 6, pageWidth - 14, currentY + 6);
    currentY += 9;

    reportGroups.forEach((group) => {
      if (group.supplementary.length > 0) {
        if (currentY > 240) {
          doc.addPage();
          currentY = 20;
        }

        if (hasConnected) {
          doc.setTextColor(71, 85, 105);
          doc.setFont(fontName, 'bold');
          doc.setFontSize(8);
          doc.text(`${group.retirement.title} - ${group.retirement.code}`, 14, currentY + 3);
          currentY += 5;
        }

        const groupSuppTotal = group.supplementary.reduce(
          (acc, s) => acc + (Number(s.amount) || 0),
          0
        );

        const suppBody = group.supplementary.map((s) => [s.description, formatNaira(s.amount)]);

        if (hasConnected) {
          suppBody.push([
            {
              content: `Subtotal (${group.retirement.code}):`,
              styles: { halign: 'right', fontStyle: 'bold', font: fontName },
            },
            {
              content: formatNaira(groupSuppTotal),
              styles: { halign: 'right', fontStyle: 'bold', font: fontName, textColor: [15, 23, 42] },
            },
          ] as any);
        }

        autoTable(doc, {
          startY: currentY,
          margin: { left: 14, right: 14, bottom: 20 },
          head: [['Description', 'Amount']],
          body: suppBody,
          theme: 'grid',
          styles: {
            font: fontName,
            fontSize: 7.5,
            cellPadding: 2,
            textColor: [30, 41, 59],
            lineColor: [226, 232, 240],
            lineWidth: 0.1,
          },
          headStyles: {
            font: fontName,
            fillColor: [51, 65, 85],
            textColor: [255, 255, 255],
            fontSize: 7.5,
            fontStyle: 'bold',
            cellPadding: 2,
          },
          columnStyles: {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 45, halign: 'right' },
          },
        });

        currentY = (doc as any).lastAutoTable.finalY + 6;
      }
    });
  }

  // --- RETIREMENT SUMMARY & RECONCILIATION SECTION ---
  if (currentY > 185) {
    doc.addPage();
    currentY = 20;
  }

  doc.setTextColor(15, 23, 42);
  doc.setFont(fontName, 'bold');
  doc.setFontSize(9.5);
  doc.text(
    hasConnected
      ? 'COMBINED RETIREMENT SUMMARY & RECONCILIATION'
      : 'RETIREMENT SUMMARY & RECONCILIATION',
    14,
    currentY + 4
  );
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(14, currentY + 6, pageWidth - 14, currentY + 6);
  currentY += 9;

  // Category Summary Rows (Aggregated across main + connected retirements)
  const categoryRows = Array.from(categorySummaryMap.values()).map((c) => [
    c.displayName,
    formatNaira(c.total),
  ]);
  if (totalSupplementary > 0) {
    categoryRows.push(['Supplementary', formatNaira(totalSupplementary)]);
  }

  // Daily Summary Rows
  const sortedSummaryDates = Array.from(dailyDateMap.keys()).sort();
  const dailyRows = sortedSummaryDates.map((date) => [
    formatDisplayDate(date),
    formatNaira(dailyDateMap.get(date) || 0),
  ]);

  const colWidth = (pageWidth - 28 - 6) / 2;
  const tableStartY = currentY + 6;

  // Categories Summary Table (Left Column)
  doc.setTextColor(15, 23, 42);
  doc.setFont(fontName, 'bold');
  doc.setFontSize(8);
  doc.text('Categories Summary', 14, currentY + 4);

  // Daily Summary Table (Right Column)
  doc.text('Daily Summary', 14 + colWidth + 6, currentY + 4);

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: 14, right: pageWidth - 14 - colWidth, bottom: 20 },
    head: [['Category', 'Total']],
    body: categoryRows.length > 0 ? categoryRows : [['No categories', '₦0']],
    theme: 'grid',
    styles: {
      font: fontName,
      fontSize: 7.5,
      cellPadding: 2,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
    },
    headStyles: {
      font: fontName,
      fillColor: [51, 65, 85],
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: 'bold',
      cellPadding: 2,
    },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 35, halign: 'right' },
    },
  });

  const catTableY = (doc as any).lastAutoTable.finalY;

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: 14 + colWidth + 6, right: 14, bottom: 20 },
    head: [['Date', 'Daily Total']],
    body: dailyRows.length > 0 ? dailyRows : [['No records', '₦0']],
    theme: 'grid',
    styles: {
      font: fontName,
      fontSize: 7.5,
      cellPadding: 2,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
    },
    headStyles: {
      font: fontName,
      fillColor: [51, 65, 85],
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: 'bold',
      cellPadding: 2,
    },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 35, halign: 'right' },
    },
  });

  const dailyTableY = (doc as any).lastAutoTable.finalY;
  currentY = Math.max(catTableY, dailyTableY) + 8;

  // --- FINAL GRAND TOTALS CALLOUT BOX ---
  if (currentY > 230) {
    doc.addPage();
    currentY = 20;
  }

  const generalTotal = totalDailyExpenditure + totalSupplementary;
  const boxX = 14;
  const boxWidth = pageWidth - 28;
  const boxHeight = 25;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.roundedRect(boxX, currentY, boxWidth, boxHeight, 2, 2, 'FD');

  // Amber left accent bar
  doc.setFillColor(245, 158, 11);
  doc.rect(boxX, currentY, 3, boxHeight, 'F');

  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.setFont(fontName, 'bold');
  doc.text(
    hasConnected ? 'Combined Daily Retirement Total:' : 'Daily Retirement Total:',
    boxX + 8,
    currentY + 6.5
  );
  doc.text(
    hasConnected ? 'Combined Supplementary Total:' : 'Supplementary Total:',
    boxX + 8,
    currentY + 13.5
  );
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('General Total Expenditure:', boxX + 8, currentY + 21);

  // Values aligned cleanly to right margin of the box
  const valueRightX = boxX + boxWidth - 8;
  doc.setFontSize(8.5);
  doc.setFont(fontName, 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(formatNaira(totalDailyExpenditure), valueRightX, currentY + 6.5, { align: 'right' });
  doc.text(formatNaira(totalSupplementary), valueRightX, currentY + 13.5, { align: 'right' });

  doc.setFontSize(10.5);
  doc.setTextColor(217, 119, 6); // amber-600
  doc.text(formatNaira(generalTotal), valueRightX, currentY + 21, { align: 'right' });

  currentY += boxHeight + 10;

  // --- SIGN-OFF / SIGNATURE BLOCKS FOR AUDIT ---
  if (currentY > 240) {
    doc.addPage();
    currentY = 20;
  }

  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.setFont(fontName, 'bold');
  doc.text('PREPARED & SUBMITTED BY (SITE ENGINEER):', 14, currentY);
  doc.text('REVIEWED & APPROVED BY (SUPERVISOR / AUDITOR):', pageWidth / 2 + 10, currentY);

  currentY += 14;
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.line(14, currentY, pageWidth / 2 - 10, currentY);
  doc.line(pageWidth / 2 + 10, currentY, pageWidth - 14, currentY);

  currentY += 5;
  doc.setFont(fontName, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `Name: ${retirement.ownerName || 'Site Engineer'} (${retirement.ownerDesignation || 'Engineer'})`,
    14,
    currentY
  );
  doc.text('Name / Designation / Stamp:', pageWidth / 2 + 10, currentY);

  currentY += 5;
  doc.setTextColor(100, 116, 139);
  doc.text('Sign & Date: ____________________', 14, currentY);
  doc.text('Sign & Date: ____________________', pageWidth / 2 + 10, currentY);

  // Footer & Page numbers across all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(14, 285, pageWidth - 14, 285);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.setFont(fontName, 'normal');
    doc.text(
      `myRet | Official Construction Expenditure Report | ${retirement.code}${hasConnected ? ' [Combined]' : ''}`,
      14,
      290
    );
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - 14, 290, { align: 'right' });
  }

  return doc;
}

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}
