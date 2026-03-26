import PDFDocument from "pdfkit";

interface SubjectRow {
  subjectName: string;
  mark: string;
  dev: string;
  classAvg: string;
  grade: string;
  rank: string;
  comment: string;
  teacher: string;
}

interface Summary {
  totalMark: string;
  avgMark: string;
  subjectsPassed: string;
  points: string;
  classPosition?: string;
  overallPosition: string;
}

interface EcdPdfSection {
  code: string;
  name: string;
  items: Array<{ itemText: string; rating: string | null }>;
}

interface SchoolInfo {
  name: string;
  logo?: string | null;
  stamp?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  principalName?: string | null;
  principalPhone?: string | null;
}

const ECD_DISPLAY_RATINGS = [
  { value: 'YES', label: 'YES' },
  { value: 'ALMOST', label: 'ALMOST' },
  { value: 'NO', label: 'NO' },
] as const;

function drawEcdSectionTable(
  doc: PDFDocument,
  section: EcdPdfSection,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const headerHeight = 13;
  const availableBodyHeight = Math.max(height - headerHeight, section.items.length * 12);
  const rowHeight = availableBodyHeight / Math.max(section.items.length, 1);
  const sectionTitle = `${section.code}. ${section.name.toUpperCase()}`;
  const cols = [
    { header: `${sectionTitle} (checklist items)`, width: width * 0.64, align: 'left' as const },
    ...ECD_DISPLAY_RATINGS.map((rating) => ({ header: rating.label, width: width * 0.12, align: 'center' as const, value: rating.value })),
  ];

  let currentX = x;
  let currentY = y;

  doc.fontSize(7.4).font('Helvetica-Bold');
  for (const col of cols) {
    doc.rect(currentX, currentY, col.width, headerHeight).fillAndStroke('#f3f4f6', '#d1d5db');
    doc.fillColor('#000').text(col.header, currentX + 3, currentY + 3.5, {
      width: col.width - 6,
      align: col.align,
      lineBreak: false,
    });
    currentX += col.width;
  }

  currentY += headerHeight;
  doc.fontSize(7.5).font('Helvetica');

  for (const item of section.items) {
    currentX = x;
    const cells = [
      item.itemText,
      item.rating === 'YES' ? '✓' : '',
      item.rating === 'ALMOST' ? '✓' : '',
      item.rating === 'NO' ? '✓' : '',
    ];

    cols.forEach((col, index) => {
      doc.rect(currentX, currentY, col.width, rowHeight).stroke('#d1d5db');
      doc.text(cells[index], currentX + 3, currentY + Math.max(3, rowHeight * 0.25), {
        width: col.width - 6,
        height: rowHeight - 4,
        align: col.align,
        lineBreak: false,
      });
      currentX += col.width;
    });

    currentY += rowHeight;
  }

  return y + height;
}

function drawEcdAssessmentPage(doc: PDFDocument, data: ReportCardPdfData, leftMargin: number, pageWidth: number) {
  if (!data.ecdSections || data.ecdSections.length === 0) return;

  doc.addPage();
  const topY = 40;
  const bottomMargin = 40;
  const sectionGap = 6;

  doc.fontSize(14).font('Helvetica-Bold').fillColor('#000')
    .text('ECD Assessment', leftMargin, topY, { align: 'center', width: pageWidth });

  doc.fontSize(8).font('Helvetica').fillColor('#444')
    .text(
      `Name: ${data.studentName}    Reg No: ${data.admissionNo}    Class: ${data.className}    Exam: ${data.examName}`,
      leftMargin,
      doc.y + 4,
      { align: 'center', width: pageWidth }
    );

  const startY = doc.y + 8;
  const availableHeight = doc.page.height - bottomMargin - startY;
  const totalWeight = data.ecdSections.reduce((sum, section) => sum + Math.max(section.items.length + 2, 6), 0);
  const totalGap = sectionGap * Math.max(data.ecdSections.length - 1, 0);
  const usableHeight = Math.max(availableHeight - totalGap, 120);

  let currentY = startY;
  data.ecdSections.forEach((section, index) => {
    const weight = Math.max(section.items.length + 2, 6);
    const isLast = index === data.ecdSections!.length - 1;
    const sectionHeight = isLast
      ? doc.page.height - bottomMargin - currentY
      : (usableHeight * weight) / totalWeight;

    drawEcdSectionTable(doc, section, leftMargin, currentY, pageWidth, Math.max(sectionHeight, 48));
    currentY += Math.max(sectionHeight, 48) + (isLast ? 0 : sectionGap);
  });

  doc.fillColor('#000');
}

export interface ReportCardPdfData {
  school: SchoolInfo & { showClassPositionOnReports?: boolean };
  studentName: string;
  admissionNo: string;
  className: string;
  examName: string;
  termName?: string;
  subjects: SubjectRow[];
  summary: Summary;
  ecdSections?: EcdPdfSection[];
  principalComment?: string;
  classTeacherComment?: string;
}

export async function generateReportCardPdf(data: ReportCardPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        size: 'A4', 
        margin: 40,
        bufferPages: true,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - 80;
      const leftMargin = 40;

      doc.fontSize(16).font('Helvetica-Bold')
        .text(data.school.name, leftMargin, 40, { align: 'center', width: pageWidth });
      
      if (data.school.phone) {
        doc.fontSize(9).font('Helvetica')
          .text(`Call Centre: ${data.school.phone}`, leftMargin, doc.y + 2, { align: 'center', width: pageWidth });
      }
      if (data.school.email) {
        doc.fontSize(9).font('Helvetica')
          .text(`Email: ${data.school.email}`, leftMargin, doc.y + 1, { align: 'center', width: pageWidth });
      }
      if (data.school.address) {
        doc.fontSize(9).font('Helvetica')
          .text(`Address: ${data.school.address}`, leftMargin, doc.y + 1, { align: 'center', width: pageWidth });
      }

      doc.moveDown(0.5);
      const lineY = doc.y;
      doc.moveTo(leftMargin, lineY).lineTo(leftMargin + pageWidth, lineY).dash(3, { space: 3 }).stroke();
      doc.undash();
      doc.moveDown(0.5);

      doc.fontSize(12).font('Helvetica-Bold')
        .text('Academic Results Slip', leftMargin, doc.y, { align: 'center', width: pageWidth });
      doc.moveDown(0.3);

      const infoY = doc.y;
      doc.fontSize(10).font('Helvetica');
      doc.font('Helvetica-Bold').text('Name: ', leftMargin, infoY, { continued: true });
      doc.font('Helvetica').text(`${data.studentName}   `, { continued: true });
      doc.fontSize(9).fillColor('#666').text(`(Reg No: ${data.admissionNo})`);
      doc.fillColor('#000');

      doc.fontSize(10).font('Helvetica-Bold').text('Class: ', leftMargin, doc.y + 2, { continued: true });
      doc.font('Helvetica').text(data.className);

      doc.font('Helvetica-Bold').text('Exam: ', leftMargin, doc.y + 2, { continued: true });
      doc.font('Helvetica').text(data.examName);

      if (data.termName) {
        doc.font('Helvetica-Bold').text('Term: ', leftMargin, doc.y + 2, { continued: true });
        doc.font('Helvetica').text(data.termName);
      }

      doc.moveDown(0.8);

      const summaryBoxY = doc.y;
      const summaryHeaders = ['Total Marks', 'Average', 'Passed', 'Points'];
      const summaryValues = [
        data.summary.totalMark || '-',
        data.summary.avgMark || '-',
        data.summary.subjectsPassed || '-',
        data.summary.points || '-',
      ];
      if (data.school.showClassPositionOnReports) {
        summaryHeaders.push('Class Position');
        summaryValues.push(data.summary.classPosition || '-');
      }
      summaryHeaders.push('Overall Position');
      summaryValues.push(data.summary.overallPosition || '-');
      const summaryColWidth = pageWidth / summaryHeaders.length;

      doc.fontSize(8).font('Helvetica-Bold');
      for (let i = 0; i < summaryHeaders.length; i++) {
        const x = leftMargin + i * summaryColWidth;
        doc.rect(x, summaryBoxY, summaryColWidth, 16).fillAndStroke('#f3f4f6', '#d1d5db');
        doc.fillColor('#000').text(summaryHeaders[i], x + 2, summaryBoxY + 4, { 
          width: summaryColWidth - 4, align: 'center' 
        });
      }

      const valY = summaryBoxY + 16;
      doc.fontSize(9).font('Helvetica');
      for (let i = 0; i < summaryValues.length; i++) {
        const x = leftMargin + i * summaryColWidth;
        doc.rect(x, valY, summaryColWidth, 16).stroke('#d1d5db');
        doc.text(summaryValues[i], x + 2, valY + 4, { 
          width: summaryColWidth - 4, align: 'center' 
        });
      }

      doc.y = valY + 24;

      const cols = [
        { header: 'Subject', width: pageWidth * 0.20, align: 'left' as const },
        { header: 'Mark', width: pageWidth * 0.08, align: 'center' as const },
        { header: 'Dev.', width: pageWidth * 0.08, align: 'center' as const },
        { header: 'Class Avg', width: pageWidth * 0.10, align: 'center' as const },
        { header: 'Grade', width: pageWidth * 0.08, align: 'center' as const },
        { header: 'Rank', width: pageWidth * 0.08, align: 'center' as const },
        { header: 'Comment', width: pageWidth * 0.23, align: 'left' as const },
        { header: 'Teacher', width: pageWidth * 0.15, align: 'left' as const },
      ];

      const tableY = doc.y;
      const rowHeight = 18;
      const headerHeight = 18;

      doc.fontSize(8).font('Helvetica-Bold');
      let colX = leftMargin;
      for (const col of cols) {
        doc.rect(colX, tableY, col.width, headerHeight).fillAndStroke('#f9fafb', '#d1d5db');
        doc.fillColor('#000').text(col.header, colX + 3, tableY + 5, { 
          width: col.width - 6, align: col.align 
        });
        colX += col.width;
      }

      doc.fontSize(8).font('Helvetica');
      let currentY = tableY + headerHeight;

      if (data.subjects.length === 0) {
        doc.rect(leftMargin, currentY, pageWidth, rowHeight).stroke('#d1d5db');
        doc.fillColor('#999').text('No marks found for this student under this exam.', leftMargin + 3, currentY + 5, {
          width: pageWidth - 6, align: 'center',
        });
        doc.fillColor('#000');
        currentY += rowHeight;
      } else {
        for (const subj of data.subjects) {
          if (currentY + rowHeight > doc.page.height - 80) {
            doc.addPage();
            currentY = 40;
          }

          const values = [
            subj.subjectName,
            subj.mark,
            subj.dev,
            subj.classAvg,
            subj.grade,
            subj.rank,
            subj.comment,
            subj.teacher,
          ];

          colX = leftMargin;
          for (let i = 0; i < cols.length; i++) {
            doc.rect(colX, currentY, cols[i].width, rowHeight).stroke('#d1d5db');
            const textVal = (values[i] || '').toString();
            const truncated = textVal.length > 30 ? textVal.slice(0, 28) + '..' : textVal;
            doc.text(truncated, colX + 3, currentY + 5, {
              width: cols[i].width - 6,
              align: cols[i].align,
              lineBreak: false,
            });
            colX += cols[i].width;
          }
          currentY += rowHeight;
        }
      }

      doc.y = currentY + 8;

      doc.fontSize(8).font('Helvetica');
      doc.fillColor('#16a34a').text('+ Positive Performance   ', leftMargin, doc.y, { continued: true });
      doc.fillColor('#dc2626').text('- Negative Performance   ', { continued: true });
      doc.fillColor('#2563eb').text('= Constant Performance');
      doc.fillColor('#000');

      doc.moveDown(1);

      doc.fontSize(9).font('Helvetica');
      const ctComment = data.classTeacherComment || '_______________________________________________';
      doc.text(`Class Teacher's comment: ${ctComment}`, leftMargin, doc.y);
      doc.moveDown(0.5);
      const pComment = data.principalComment || '_______________________________________________';
      doc.text(`Head/Principal's comment: ${pComment}`, leftMargin, doc.y);

      doc.moveDown(1);

      if (data.school.principalName || data.school.principalPhone || data.school.phone || data.school.email) {
        doc.font('Helvetica-Bold').fontSize(9).text('School Principal', leftMargin, doc.y);
        doc.font('Helvetica').fontSize(9);
        if (data.school.principalName) doc.text(data.school.principalName, leftMargin, doc.y + 2);
        if (data.school.principalPhone) doc.text(`Mobile: ${data.school.principalPhone}`, leftMargin, doc.y + 1);
        if (data.school.phone) doc.text(`Call Centre: ${data.school.phone}`, leftMargin, doc.y + 1);
        if (data.school.email) doc.text(`Email: ${data.school.email}`, leftMargin, doc.y + 1);
      }

      doc.moveDown(1.5);
      doc.fontSize(9).font('Helvetica-Oblique').fillColor('#555')
        .text('Hardwork - Discipline - Changing Lives', leftMargin, doc.y, { align: 'center', width: pageWidth });
      doc.fillColor('#000');

      doc.moveDown(0.5);
      doc.fontSize(8).font('Helvetica').fillColor('#888')
        .text('www.firstchoicegroup.co.zw', leftMargin, doc.y, { align: 'center', width: pageWidth });
      doc.fillColor('#000');

      drawEcdAssessmentPage(doc, data, leftMargin, pageWidth);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
