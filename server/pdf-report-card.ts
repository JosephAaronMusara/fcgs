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

      if (data.ecdSections && data.ecdSections.length > 0) {
        doc.fontSize(9).font('Helvetica-Bold').text('ECD Development Assessment', leftMargin, doc.y, { align: 'center', width: pageWidth });
        doc.moveDown(0.4);
        for (const section of data.ecdSections) {
          if (doc.y > doc.page.height - 140) {
            doc.addPage();
            doc.y = 40;
          }
          doc.fontSize(8).font('Helvetica-Bold');
          doc.rect(leftMargin, doc.y, pageWidth, 14).fillAndStroke('#f3f4f6', '#d1d5db');
          doc.fillColor('#000').text(`${section.code}. ${section.name}`, leftMargin + 4, doc.y + 4, { width: pageWidth - 8 });
          doc.y += 14;

          const ecdCols = [
            { header: 'Checklist Item', width: pageWidth * 0.64, align: 'left' as const },
            { header: 'Yes', width: pageWidth * 0.12, align: 'center' as const },
            { header: 'No', width: pageWidth * 0.12, align: 'center' as const },
            { header: 'Almost', width: pageWidth * 0.12, align: 'center' as const },
          ];
          let x = leftMargin;
          const topY = doc.y;
          doc.fontSize(7).font('Helvetica-Bold');
          for (const col of ecdCols) {
            doc.rect(x, topY, col.width, 14).fillAndStroke('#fafafa', '#d1d5db');
            doc.fillColor('#000').text(col.header, x + 2, topY + 4, { width: col.width - 4, align: col.align });
            x += col.width;
          }
          let rowY = topY + 14;
          doc.fontSize(7).font('Helvetica');
          for (const item of section.items) {
            if (rowY > doc.page.height - 80) {
              doc.addPage();
              rowY = 40;
            }
            x = leftMargin;
            const cells = [
              item.itemText,
              item.rating === 'YES' ? '✓' : '',
              item.rating === 'NO' ? '✓' : '',
              item.rating === 'ALMOST' ? '✓' : '',
            ];
            for (let i = 0; i < ecdCols.length; i++) {
              doc.rect(x, rowY, ecdCols[i].width, 13).stroke('#d1d5db');
              doc.text(cells[i], x + 2, rowY + 3, { width: ecdCols[i].width - 4, align: ecdCols[i].align, lineBreak: false });
              x += ecdCols[i].width;
            }
            rowY += 13;
          }
          doc.y = rowY + 6;
        }
      }

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

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
