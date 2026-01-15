
declare const jspdf: any;

export const downloadAsPDF = (content: string, filename: string) => {
  const { jsPDF } = (window as any).jspdf;
  const doc = new jsPDF();
  
  const margin = 20;
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - (margin * 2);
  
  // Clean up markdown markers for PDF if any
  const cleanContent = content
    .replace(/#{1,6}\s?/g, '') // Remove headers
    .replace(/\*\*/g, '')      // Remove bold
    .replace(/\*/g, '')        // Remove italics
    .trim();

  const lines = doc.splitTextToSize(cleanContent, contentWidth);
  
  let cursorY = margin;
  
  // Set default font
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  
  // Logic to handle professional letter spacing
  // We split by double newlines to treat as paragraphs
  const paragraphs = cleanContent.split(/\n\s*\n/);
  
  paragraphs.forEach((para, index) => {
    // Check if paragraph is likely the header (first 2-3 lines usually contain name/contact)
    if (index === 0 && para.length < 200) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
    } else {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
    }

    const paraLines = doc.splitTextToSize(para.trim(), contentWidth);
    
    // Check for page overflow
    if (cursorY + (paraLines.length * 7) > 280) {
      doc.addPage();
      cursorY = margin;
    }
    
    doc.text(paraLines, margin, cursorY);
    cursorY += (paraLines.length * 6) + 8; // Line height + paragraph spacing
  });

  doc.save(`${filename}.pdf`);
};

export const downloadAsWord = (content: string, filename: string) => {
  // Simple blob export as .doc with basic CSS for better layout in Word
  const header = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>Export</title>
      <style>
        body { font-family: 'Arial', sans-serif; line-height: 1.5; padding: 1in; }
        p { margin-bottom: 12pt; text-align: justify; }
        .header { font-weight: bold; font-size: 14pt; margin-bottom: 20pt; }
      </style>
    </head>
    <body>
  `;
  const footer = "</body></html>";
  
  // Format paragraphs for Word
  const formattedBody = content
    .split(/\n\s*\n/)
    .map((p, i) => `<p class="${i === 0 ? 'header' : ''}">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
    
  const sourceHTML = header + formattedBody + footer;
  
  const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
  const fileDownload = document.createElement("a");
  document.body.appendChild(fileDownload);
  fileDownload.href = source;
  fileDownload.download = `${filename}.doc`;
  fileDownload.click();
  document.body.removeChild(fileDownload);
};
